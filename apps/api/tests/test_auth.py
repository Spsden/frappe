from sqlalchemy import select
from test_api import TEST_TENANT_ID, auth_headers

from worktrace_api.auth import hash_access_token
from worktrace_api.database import AccessTokenRecord, SessionLocal


def test_signup_creates_tenant_owner_and_access_token(client):
    response = client.post(
        "/auth/signup",
        json={
            "company_name": "Acme Operations",
            "email": "Owner@Acme.test",
            "password": "a-secure-password",
        },
    )

    assert response.status_code == 201
    session = response.json()
    assert session["token_type"] == "bearer"
    assert session["access_token"]
    assert session["account"]["company_name"] == "Acme Operations"
    assert session["account"]["email"] == "owner@acme.test"
    assert session["account"]["role"] == "owner"

    with SessionLocal() as db:
        stored = db.scalar(
            select(AccessTokenRecord).where(
                AccessTokenRecord.token_hash == hash_access_token(session["access_token"])
            )
        )
        assert stored is not None
        assert stored.token_hash != session["access_token"]

    me = client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {session['access_token']}"},
    )
    assert me.status_code == 200
    assert me.json() == session["account"]


def test_login_issues_new_token_and_logout_revokes_it(client):
    login = client.post(
        "/auth/login",
        json={"email": "OWNER@example.test", "password": "test-password-123"},
    )
    assert login.status_code == 200
    access_token = login.json()["access_token"]

    logout = client.post(
        "/auth/logout",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert logout.status_code == 204
    assert (
        client.get(
            "/auth/me",
            headers={"Authorization": f"Bearer {access_token}"},
        ).status_code
        == 401
    )


def test_rejects_duplicate_email_and_invalid_login(client):
    duplicate = client.post(
        "/auth/signup",
        json={
            "company_name": "Another Company",
            "email": "owner@example.test",
            "password": "another-password",
        },
    )
    assert duplicate.status_code == 409

    invalid = client.post(
        "/auth/login",
        json={"email": "owner@example.test", "password": "wrong-password"},
    )
    assert invalid.status_code == 401
    assert invalid.json()["detail"] == "Invalid email or password"


def test_tenant_is_derived_from_token(client):
    me = client.get("/auth/me", headers=auth_headers())
    assert me.status_code == 200
    assert me.json()["tenant_id"] == TEST_TENANT_ID

    mismatched = client.get(
        "/auth/me",
        headers={
            **auth_headers(),
            "X-Tenant-ID": "00000000-0000-4000-8000-000000000096",
        },
    )
    assert mismatched.status_code == 403
