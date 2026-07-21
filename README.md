# Recording Flow — Frontend → Backend

End-to-end trace of what happens from the moment the user **stops** a recording
through transcription, annotation, and SOP generation. Covers the Electron
desktop app (`apps/desktop`) and the WorkTrace API (`apps/api`).

---

## At a glance

```
 Desktop (Electron)                          API (FastAPI)                    Worker (Celery)
 ───────────────────                         ─────────────                    ───────────────

 [Stop]  → flush local files         ────────────────────────────────────────────────────────────
                                              (no network yet)
 [Save]  → POST /recordings          ─────►   create_recording ............. (status: recording)
         → PUT /chunks/{i} (events,   ─────►   upload_recording_chunk (sha256 + idempotency)
           screenshots, audio)                  validate, dedupe, write to disk
         → POST /recordings/{id}/     ─────►   complete_recording
           complete                              │
                                                 ▼  RecordingProcessor.process()  (SYNC, in request)
                                                   assemble audio → assembled/audio.webm
                                                   build screenshots + events
                                                   sanitize session, save SOP
                                                   status → ready_for_review
                                                   process_recording.delay(...) ──►  group:
                                                                                     ├─ transcribe_audio  (audio queue)
                                                                                     │    whisper → transcript
                                                                                     │    drop raw audio chunks
                                                                                     └─ annotate_screenshots (vision queue)
                                                                                          draw click/scroll boxes
 [poll] GET /recordings/{id}/status ◄──────  read-only stage list
```

---

## Phase A — Stop (local only, no network)

**Trigger:** user clicks Stop (`apps/desktop/src/components/RecorderCard.tsx:177`,
or the floating controls window `apps/desktop/src/pages/RecordingControlsPage.tsx:89`),
or presses `Cmd/Ctrl+Shift+R`.

Path: renderer `window.api.recording.stop()`
(`apps/desktop/preload/index.ts:42`) → IPC `recording:stop`
(`apps/desktop/main/recording/registerRecordingIpc.ts:27`)
→ **`RecordingManager.stop()`** (`apps/desktop/main/recording/RecordingManager.ts:205`):

1. State → `stopping`.
2. `inputEvents.stop()` — flush pending typing/scroll *bursts*, remove OS hooks,
   drain the serialized write queue
   (`apps/desktop/main/recording/InputEventService.ts:135`).
3. `screenCapture.stop()` — wait for any in-flight capture, **flush one final
   screenshot** if a visual change was pending
   (`apps/desktop/main/recording/ScreenCaptureService.ts:86`).
4. `audioCapture.stop()` — stop the `MediaRecorder` (hidden window), wait ≤2.5s
   for the last `dataavailable` blob
   (`apps/desktop/main/recording/AudioCaptureService.ts:86`).
5. `sessionWriter.setStatus('completed')`, state → `awaiting-save`.

During the whole recording, evidence was appended to **local files only**:

```
<userData>/recordings/<sessionId>/
├── manifest.json            # session metadata, counts, remote IDs (atomic rename)
├── events.jsonl             # one RecordedEvent JSON per line
├── screenshots.jsonl        # one ScreenshotRecord JSON per line
├── screenshots/<seq>.png    # actual PNGs
├── audio.jsonl              # one AudioChunkRecord JSON per line
└── audio/<seq>.webm         # actual audio blobs
```

Nothing has hit the network yet.

---

## Phase B — Save (the upload)

**Trigger:** user types a workflow name and clicks Save
(`apps/desktop/src/components/RecorderCard.tsx:240`)
→ `window.api.recording.save(name)` → **`RecordingManager.save()`**
(`apps/desktop/main/recording/RecordingManager.ts:229`)
→ **`RecordingUploader.uploadCompletedSession(sessionPath)`**
(`apps/desktop/main/recording/RecordingUploader.ts:21`):

1. **`POST /recordings`** `{ workflow_name, source_type: 'desktop', has_audio }`
   (`apps/desktop/main/api/WorkTraceApiClient.ts:97`)
   → backend `create_recording` (`apps/api/src/worktrace_api/main.py:213`)
   inserts a `RecordingRecord` (status `recording`), returns `id`.

2. **Sequential chunk uploads** via `PUT /recordings/{id}/chunks/{index}`,
   multipart form-data (`apps/desktop/main/api/WorkTraceApiClient.ts:113`).
   Each chunk carries `content_type`, `timestamp_start_ms`, `timestamp_end_ms`,
   `checksum_sha256`, `idempotency_key`, `payload_size`, `metadata_json`, `file`.
   Order (incrementing index):

   | index | content_type   | media type             | one per…                         |
   |-------|----------------|------------------------|----------------------------------|
   | 0     | `events`       | `application/x-ndjson` | the whole `events.jsonl`         |
   | 1..N  | `screenshots`  | `image/png`            | captured screenshot (on change)  |
   | N+1..M| `audio`        | `audio/webm`           | 2500ms mic timeslice             |

   Backend `upload_recording_chunk` (`apps/api/src/worktrace_api/main.py:222`):
   verifies sha256 + declared size (`ChunkStorage.validate`,
   `apps/api/src/worktrace_api/recordings.py:42`), dedupes by
   `(recording_id, chunk_index)` and idempotency key, writes bytes atomically
   (`.tmp` → rename, `ChunkStorage.write` `recordings.py:18`), inserts a
   `RecordingChunkRecord`.

3. **`POST /recordings/{id}/complete`** `{ expected_chunk_count: M+1 }`
   (`apps/desktop/main/api/WorkTraceApiClient.ts:140`).

### Idempotency keys & checksums
- Keys: `<sessionId>:events`, `<sessionId>:screenshot:<id>`,
  `<sessionId>:audio:<id>` (`RecordingUploader.ts:47,71,96`).
- sha256 computed per payload at upload (`RecordingUploader.ts:170`) **and** at
  capture time as `contentHash` (screenshots `ScreenCaptureService.ts:200`,
  audio `AudioCaptureService.ts:188`), embedded in `metadata_json`.

---

## Phase C — `/complete`: synchronous processing (in the request thread)

`complete_recording` (`apps/api/src/worktrace_api/main.py:303`) →
`repo.complete_recording` validates the chunk-index set is complete
(`apps/api/src/worktrace_api/repository.py:247`), status → `validating`, then
**`RecordingProcessor.process()` runs synchronously**
(`apps/api/src/worktrace_api/processing.py:30`) — the documented prototype
shortcut (slow work currently blocks the request):

| Step | Status set | What happens |
|---|---|---|
| `_transcript` (`processing.py:101`) | `transcribing_audio` | Concatenate audio chunks into **`assembled/audio.<ext>`** via `storage.assemble` (`recordings.py:74`); store path as `transcript.audio_reference`; transcript `status="pending_transcription"` |
| `_screenshots` (`processing.py:128`) | `processing_screenshots` | Validate each PNG (dimensions + declared hash); build `Screenshot` rows whose `storage_key` **points at the raw chunk file** |
| `_events` (`processing.py:215`) | `aligning_evidence` | Decode events NDJSON; normalize into `SessionEvent`s; attach click/scroll `evidenceAnnotation` bounds |
| build session | — | `sanitize_session` (privacy redaction, `privacy.py`); `save_session` + `save_screenshots` |
| `generate_sop` (`processing.py:87`) | `generating_sop` | Local deterministic SOP draft; `save_sop` |
| `link_recording_session` | **`ready_for_review`** | Link recording ↔ session |
| **dispatch async** (`processing.py:94`) | — | `process_recording.delay(recording_id, session_id, tenant_id)` |

The HTTP response returns to the frontend with `status: "ready_for_review"`.
Frontend persists the remote `recordingId`/`sessionId` and UI → `processing` →
`completed` (`RecordingManager.ts:250`).

---

## Phase D — Celery pipeline (async, parallel)

`process_recording` (`apps/api/src/worktrace_api/tasks/pipeline.py:8`) fans out a
**`group`** — two tasks run in parallel on separate queues:

### `transcribe_audio` → `audio` queue (`tasks/transcription.py:110`)
- Guard: skip if transcript already `completed`.
- `_resolve_audio_file` reads `transcript.audio_reference` (the **already
  assembled** file) — no chunk re-reading.
- `whisper.transcribe()` → `TranscriptSegment`s; transcript `status="completed"`,
  committed.
- `_cleanup_audio_chunks` → deletes raw **audio** chunk rows + files (gated on
  `ready_for_review`/`completed`, idempotent). **Keeps** the assembled audio
  file, the screenshot/event chunks, and the transcript.

### `annotate_screenshots` → `vision` queue (`tasks/annotation.py:36`)
- For each screenshot, find the matching event's `evidenceAnnotation.bounds`.
- Draw a red bounding box on the PNG (`_draw_annotation_box`); write
  `*-annotated.png` atomically.
- `update_screenshot_annotation` → `redaction_status="redacted"`.

> Both tasks connect to Redis broker/backend
> (`apps/api/src/worktrace_api/core/celery_app.py`). Queue routing is defined
> there; the worker must consume `default,audio,vision,llm,celery`.

---

## Phase E — Frontend polling

Meanwhile the renderer polls **`GET /recordings/{id}/status`**
(`apps/desktop/main/api/WorkTraceApiClient.ts:153` →
`apps/api/src/worktrace_api/main.py:322`, read-only) to surface stage
transitions and the final `ready_for_review` / `completed`. The endpoint also
verifies every chunk's file still exists and flips the recording to `failed`
if any are missing.

---

## Recording state machine

```
recording → uploading → validating → transcribing_audio → processing_screenshots
          → aligning_evidence → generating_sop → ready_for_review → completed
                                                              ↘ failed (any stage)
```

Frontend statuses (`apps/desktop/shared/recording.ts:1`):
`recording | paused | stopping | awaiting-save | uploading | processing | completed | error`.

---

## Storage layout on the API host

```
{recording_storage_path}/                         (WORKTRACE_RECORDING_STORAGE_PATH)
└── {tenant_id}/{recording_id}/
    ├── 00000000-audio.webm          ← raw audio chunks (deleted after transcription)
    ├── 00000001-screenshots.png     ← raw screenshots (KEPT; referenced by Screenshot rows)
    └── assembled/audio.webm         ← assembled artifact (KEPT; transcript.audio_reference)
```

- **Audio raw chunks**: disposable after the transcript is durable → removed by
  `_cleanup_audio_chunks`.
- **Screenshot/event chunks**: retained — `Screenshot.storage_key` references the
  raw PNG bytes used by walkthroughs and annotation.
- **Assembled audio**: the "processed" artifact; retained as the reprocessing
  source and referenced by the transcript.

---

## Known limitations / next steps

- **`RecordingProcessor.process()` runs synchronously in the `/complete`
  request** (`processing.py:30`). A large events/audio payload makes that HTTP
  call slow and can trip the client's 15s timeout
  (`WorkTraceApiClient.ts:171`). Moving `process()` fully behind the worker
  queue is the documented next step (see `apps/api/README.md` "Prototype
  Boundaries").
- **Resumability is partial.** Per-chunk PUTs are idempotent (deduped by index
  + key), but a failed `save()` re-runs `POST /recordings` (Phase B step 1),
  creating a *new* recording instead of resuming the old one.
- **No chunk-level retry / concurrency** in the uploader; uploads are strictly
  sequential `await`s.
- For multi-instance deployment: swap local `ChunkStorage` for S3/GCS with
  presigned multipart uploads, and run the processor behind a durable queue.
  The `RecordingChunkRecord` manifest and the route contracts already support
  this unchanged.

---

## File reference cheat sheet

### Desktop
| Concern | File | Lines |
|---|---|---|
| State machine / options | `apps/desktop/shared/recording.ts` | 1–12, 89–99 |
| **Stop (local finalize)** | `apps/desktop/main/recording/RecordingManager.ts` | 205–227 |
| **Save → upload trigger** | `apps/desktop/main/recording/RecordingManager.ts` | 229–267 |
| **Upload sequence** | `apps/desktop/main/recording/RecordingUploader.ts` | 21–117 |
| sha256 helper | `apps/desktop/main/recording/RecordingUploader.ts` | 170–172 |
| `POST /recordings` | `apps/desktop/main/api/WorkTraceApiClient.ts` | 97–111 |
| `PUT /chunks/{i}` (multipart) | `apps/desktop/main/api/WorkTraceApiClient.ts` | 113–138 |
| `POST /complete` | `apps/desktop/main/api/WorkTraceApiClient.ts` | 140–150 |
| `GET /status`, `DELETE` | `apps/desktop/main/api/WorkTraceApiClient.ts` | 152–159 |
| Request wrapper (auth, 15s timeout) | `apps/desktop/main/api/WorkTraceApiClient.ts` | 161–175 |
| Screen capture + change detection | `apps/desktop/main/recording/ScreenCaptureService.ts` | 39–100, 340–387 |
| Audio capture (main side) | `apps/desktop/main/recording/AudioCaptureService.ts` | 46–101, 163–193 |
| Audio MediaRecorder (renderer) | `apps/desktop/src/pages/AudioRecorderPage.tsx` | 35–69 |
| Input events + bursts | `apps/desktop/main/recording/InputEventService.ts` | 107–151, 232–298 |
| Local session files | `apps/desktop/main/recording/SessionWriter.ts` | 31–109 |

### API
| Concern | File | Lines |
|---|---|---|
| `POST /recordings` | `apps/api/src/worktrace_api/main.py` | 207–214 |
| `PUT /recordings/{id}/chunks/{i}` | `apps/api/src/worktrace_api/main.py` | 217–295 |
| `POST /recordings/{id}/complete` | `apps/api/src/worktrace_api/main.py` | 298–314 |
| `GET /recordings/{id}/status` | `apps/api/src/worktrace_api/main.py` | 317–344 |
| Sync processing | `apps/api/src/worktrace_api/processing.py` | 30–99 |
| Audio assembly | `apps/api/src/worktrace_api/recordings.py` | 74–96 |
| Chunk write/validate/delete | `apps/api/src/worktrace_api/recordings.py` | 18–72 |
| Celery app + routing | `apps/api/src/worktrace_api/core/celery_app.py` | 1–36 |
| Pipeline fan-out | `apps/api/src/worktrace_api/tasks/pipeline.py` | 7–14 |
| Transcription + audio cleanup | `apps/api/src/worktrace_api/tasks/transcription.py` | 109–195 |
| Screenshot annotation | `apps/api/src/worktrace_api/tasks/annotation.py` | 35–99 |
