from uuid import uuid4

TEST_TENANT_ID = "00000000-0000-4000-8000-000000000099"


def auth_headers():
    return {"X-Tenant-ID": TEST_TENANT_ID, "Authorization": "Bearer test-api-token"}


def session_payload(tenant_id):
    return {
        "schema_version": "1.0",
        "tenant_id": str(tenant_id),
        "workflow_name": "Approve invoice",
        "typed_text_consent": True,
        "consent_actor": "Test Operator",
        "consent_statement_version": "2026-06",
        "duration_ms": 1200,
        "events": [
            {
                "schema_version": "1.0",
                "tenant_id": str(tenant_id),
                "event_type": "input",
                "page_url": "https://example.test/pay?account=123",
                "safe_selector": "#account",
                "element_text": "Bank account",
                "consented_text": "123456789",
                "duration_ms": 1200,
            }
        ],
    }


def test_end_to_end_api_flow(client):
    tenant_id = TEST_TENANT_ID
    headers = auth_headers()

    created = client.post("/sessions", headers=headers, json=session_payload(tenant_id))
    assert created.status_code == 201
    session = created.json()
    assert session["events"][0]["consented_text"] is None

    preview = client.post(f"/sessions/{session['id']}/ai-preview", headers=headers)
    assert preview.status_code == 200
    assert preview.json()["approved"] is False
    assert "screenshot_reference" in preview.json()["excluded_fields"]

    ai_approval = client.post(
        f"/sessions/{session['id']}/ai-approval",
        headers=headers,
        json={
            "approved": True,
            "actor": "Test Operator",
            "payload_hash": preview.json()["payload_hash"],
        },
    )
    assert ai_approval.status_code == 200
    assert ai_approval.json()["external_ai_approved"] is True

    sop_response = client.post(f"/sessions/{session['id']}/sops", headers=headers)
    assert sop_response.status_code == 201
    sop = sop_response.json()
    assert sop["status"] == "draft"

    approval = client.post(f"/sops/{sop['id']}/approval", headers=headers, json={"approved": True})
    assert approval.status_code == 200
    assert approval.json()["status"] == "approved"

    walkthrough = client.get(f"/walkthroughs/{sop['id']}", headers=headers)
    assert walkthrough.status_code == 200

    feedback = client.post(
        "/feedback",
        headers=headers,
        json={
            "session_id": session["id"],
            "transcript": "This step is confusing and slow.",
            "audio_reference": str(uuid4()),
        },
    )
    assert feedback.status_code == 201
    assert feedback.json()["classification"] == "frustration_signal"

    export = client.get(f"/exports/{session['id']}", headers=headers)
    assert export.status_code == 200
    assert len(export.json()["sops"]) == 1
    assert len(export.json()["feedback"]) == 1

    second_sop = client.post(f"/sessions/{session['id']}/sops", headers=headers)
    assert second_sop.json()["version"] == 2

    deletion = client.delete(f"/sessions/{session['id']}", headers=headers)
    assert deletion.status_code == 204
    assert client.get(f"/sessions/{session['id']}", headers=headers).status_code == 404


def test_rejects_tenant_mismatch(client):
    payload_tenant = uuid4()
    response = client.post(
        "/sessions",
        headers=auth_headers(),
        json=session_payload(payload_tenant),
    )
    assert response.status_code == 403


def test_requires_auditable_typed_text_consent(client):
    tenant_id = TEST_TENANT_ID
    payload = session_payload(tenant_id)
    payload["consent_actor"] = None
    payload["consent_statement_version"] = None

    response = client.post(
        "/sessions",
        headers=auth_headers(),
        json=payload,
    )

    assert response.status_code == 422


def test_rejects_invalid_bearer_token(client):
    response = client.get(
        "/sessions",
        headers={"X-Tenant-ID": TEST_TENANT_ID, "Authorization": "Bearer wrong"},
    )
    assert response.status_code == 401
