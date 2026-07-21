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

recordings
- id PK
- tenant_id
- session_id nullable
- source_type
- workflow_name
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
- version
- status
- title
- document TEXT nullable        # optional supporting narrative (purpose/overview)
- steps JSON                   # each step: position, title, instruction, warning,
                               #   screenshot_reference, estimated_time_ms,
                               #   decision_branches[{condition,action}]
- created_at
- unique: tenant_id + source_session_id + version

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