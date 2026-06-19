import base64
import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from worktrace_api.database import AccessTokenRecord, TenantAccountRecord, UserRecord
from worktrace_api.schemas import Account, AccountRole, AuthSession, LoginRequest, SignUpRequest

SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1


class AuthenticationError(ValueError):
    pass


class EmailAlreadyRegisteredError(ValueError):
    pass


def sign_up(db: Session, payload: SignUpRequest, token_ttl_hours: int) -> AuthSession:
    now = datetime.now(UTC)
    tenant_id = uuid4()
    user_id = uuid4()
    db.add(
        TenantAccountRecord(
            id=str(tenant_id),
            name=payload.company_name,
            created_at=now,
        )
    )
    db.add(
        UserRecord(
            id=str(user_id),
            tenant_id=str(tenant_id),
            email=payload.email,
            password_hash=hash_password(payload.password),
            role=AccountRole.OWNER,
            is_active=True,
            created_at=now,
        )
    )
    try:
        db.flush()
        result = _issue_token(
            db,
            user_id=user_id,
            tenant_id=tenant_id,
            company_name=payload.company_name,
            email=payload.email,
            role=AccountRole.OWNER,
            token_ttl_hours=token_ttl_hours,
            now=now,
        )
        db.commit()
        return result
    except IntegrityError as exc:
        db.rollback()
        raise EmailAlreadyRegisteredError("An account with this email already exists") from exc


def log_in(db: Session, payload: LoginRequest, token_ttl_hours: int) -> AuthSession:
    user = db.scalar(select(UserRecord).where(UserRecord.email == payload.email))
    if not user or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise AuthenticationError("Invalid email or password")
    tenant = db.get(TenantAccountRecord, user.tenant_id)
    if not tenant:
        raise AuthenticationError("Invalid email or password")

    result = _issue_token(
        db,
        user_id=UUID(user.id),
        tenant_id=UUID(user.tenant_id),
        company_name=tenant.name,
        email=user.email,
        role=AccountRole(user.role),
        token_ttl_hours=token_ttl_hours,
        now=datetime.now(UTC),
    )
    db.commit()
    return result


def authenticate(db: Session, access_token: str) -> Account:
    token = db.scalar(
        select(AccessTokenRecord).where(
            AccessTokenRecord.token_hash == hash_access_token(access_token)
        )
    )
    now = datetime.now(UTC)
    if not token or token.revoked_at or _as_utc(token.expires_at) <= now:
        raise AuthenticationError("Invalid or expired access token")

    user = db.get(UserRecord, token.user_id)
    tenant = db.get(TenantAccountRecord, token.tenant_id)
    if not user or not user.is_active or not tenant:
        raise AuthenticationError("Invalid or expired access token")
    return Account(
        user_id=UUID(user.id),
        tenant_id=UUID(tenant.id),
        company_name=tenant.name,
        email=user.email,
        role=AccountRole(user.role),
    )


def log_out(db: Session, access_token: str) -> None:
    token = db.scalar(
        select(AccessTokenRecord).where(
            AccessTokenRecord.token_hash == hash_access_token(access_token)
        )
    )
    if token and not token.revoked_at:
        token.revoked_at = datetime.now(UTC)
        db.commit()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        dklen=32,
    )
    return "$".join(
        [
            "scrypt",
            str(SCRYPT_N),
            str(SCRYPT_R),
            str(SCRYPT_P),
            base64.urlsafe_b64encode(salt).decode("ascii"),
            base64.urlsafe_b64encode(derived).decode("ascii"),
        ]
    )


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, n, r, p, salt_value, expected_value = encoded.split("$", 5)
        if algorithm != "scrypt":
            return False
        salt = base64.urlsafe_b64decode(salt_value)
        expected = base64.urlsafe_b64decode(expected_value)
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(expected),
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def hash_access_token(access_token: str) -> str:
    return hashlib.sha256(access_token.encode("utf-8")).hexdigest()


def _issue_token(
    db: Session,
    *,
    user_id: UUID,
    tenant_id: UUID,
    company_name: str,
    email: str,
    role: AccountRole,
    token_ttl_hours: int,
    now: datetime,
) -> AuthSession:
    access_token = secrets.token_urlsafe(48)
    expires_at = now + timedelta(hours=token_ttl_hours)
    db.add(
        AccessTokenRecord(
            id=str(uuid4()),
            tenant_id=str(tenant_id),
            user_id=str(user_id),
            token_hash=hash_access_token(access_token),
            expires_at=expires_at,
            created_at=now,
        )
    )
    return AuthSession(
        access_token=access_token,
        expires_at=expires_at,
        account=Account(
            user_id=user_id,
            tenant_id=tenant_id,
            company_name=company_name,
            email=email,
            role=role,
        ),
    )


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)
