tenants
- id PK
- name
- created_at

users
- id PK
- tenant_id FK -> tenants.id
- email unique
- password_hash
- role
- is_active
- created_at

access_tokens
- id PK
- tenant_id FK -> tenants.id
- user_id FK -> users.id
- token_hash unique
- expires_at
- revoked_at
- created_at

workflows
- id PK
- tenant_id FK -> tenants.id
- name
- description nullable
- created_by nullable FK -> users.id
- created_at
- updated_at
- unique: tenant_id + name

recordings
- id PK
- tenant_id
- session_id nullable
- workflow_id nullable FK -> workflows.id
- source_type
- workflow_name                  -- denormalized display name
- reference nullable             -- optional human-entered label
- recorded_by nullable FK -> users.id
- status
- expected_chunk_count
- uploaded_chunk_count
- uploaded_bytes
- has_audio
- error_message
- created_at
- completed_at

recording_chunks
- recording_id PK/FK -> recordings.id
- chunk_index PK
- tenant_id
- content_type        -- events | screenshots | audio
- media_type          -- image/png, audio/webm, application/x-ndjson, etc.
- timestamp_start_ms
- timestamp_end_ms
- checksum_sha256
- idempotency_key
- payload_size
- storage_key         -- relative file path inside recording storage
- metadata_json
- created_at

screenshots
- id PK
- tenant_id
- recording_id FK -> recordings.id
- session_id nullable FK -> workflow_sessions.id
- sequence
- captured_at
- storage_key
- media_type
- width
- height
- change_score
- content_hash
- redaction_status
- created_at

workflow_sessions
- id PK
- tenant_id
- recording_id nullable FK -> recordings.id
- source_type
- workflow_name
- status
- typed_text_consent
- consent_actor
- consent_statement_version
- consented_at
- external_ai_approved
- external_ai_approved_at
- external_ai_payload_hash
- duration_ms
- transcript JSON
- events JSON
- created_at

sops
- id PK
- tenant_id
- source_session_id FK -> workflow_sessions.id
- parent_sop_id nullable FK -> sops.id    # approved SOP cloned into a new draft
- version
- revision                              # optimistic-concurrency revision
- status
- title
- document TEXT nullable        # optional supporting narrative (purpose/overview)
- steps JSON                   # each step: position, title, instruction, warning,
                               #   screenshot_reference, estimated_time_ms,
                               #   decision_branches[{condition,action}]
- created_at
- updated_at
- edited_by nullable FK -> users.id
- unique: tenant_id + source_session_id + version

sop_revisions
- id PK
- tenant_id FK -> tenants.id
- sop_id FK -> sops.id
- revision
- snapshot_json                 # immutable title/document/steps/status snapshot
- edited_by nullable FK -> users.id
- change_summary nullable
- created_at
- unique: tenant_id + sop_id + revision

analytics_runs
- id PK
- tenant_id FK -> tenants.id
- workflow_id FK -> workflows.id
- version
- mode                          # selected_comparison | workforce
- status                        # queued through completed/failed stages
- input_count
- embedding_model
- algorithm_version
- result_json nullable          # deterministic charts, clusters, friction and heatmap
- executive_summary nullable
- failure_stage nullable
- error_message nullable
- created_by nullable FK -> users.id
- supersedes_run_id nullable FK -> analytics_runs.id
- created_at
- started_at nullable
- completed_at nullable
- updated_at
- unique: tenant_id + workflow_id + version

analytics_run_inputs
- id PK
- tenant_id FK -> tenants.id
- run_id FK -> analytics_runs.id
- position
- recording_id
- session_id
- sop_id
- sop_version
- sop_content_hash
- sop_snapshot                  # immutable input used by this analytics version
- recording_reference nullable
- recorded_by nullable
- recorded_by_email nullable
- duration_ms
- created_at
- unique: run_id + position
- unique: run_id + recording_id

sop_step_embeddings
- id PK
- tenant_id FK -> tenants.id
- sop_id FK -> sops.id
- sop_step_id
- model
- dimensions
- content_hash
- embedding vector(1536)        # pgvector in PostgreSQL, JSON adapter in SQLite tests
- created_at
- unique: tenant_id + sop_id + sop_step_id + model + content_hash

feedback
- id PK
- tenant_id
- session_id FK -> workflow_sessions.id
- sop_step_id nullable
- transcript
- classification
- audio_reference
- created_at

ai_approvals
- id PK
- tenant_id
- session_id FK -> workflow_sessions.id
- actor
- payload_hash
- approved
- created_at
