from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import secrets

from fastapi import Depends, HTTPException, Request, status

from app.db.repository import civic_repo, now_utc, public_id

SESSION_COOKIE = "urbanfix_session"
SESSION_DAYS = 7


def hash_password(password: str, salt: bytes | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)
    return salt.hex(), digest.hex()


def verify_password(password: str, salt_hex: str, digest_hex: str) -> bool:
    _, candidate = hash_password(password, bytes.fromhex(salt_hex))
    return hmac.compare_digest(candidate, digest_hex)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def create_session(user: dict) -> tuple[str, dict]:
    token = secrets.token_urlsafe(48)
    csrf = secrets.token_urlsafe(24)
    session = {
        "session_id": public_id("SES"),
        "token_hash": token_hash(token),
        "csrf_token": csrf,
        "user_id": user["user_id"],
        "role": user["role"],
        "expires_at": now_utc() + timedelta(days=SESSION_DAYS),
        "created_at": now_utc(),
    }
    await civic_repo.insert_one("sessions", session)
    return token, session


async def optional_user(request: Request) -> dict | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    session = await civic_repo.find_one("sessions", "token_hash", token_hash(token))
    if not session:
        return None
    expires = session.get("expires_at")
    if isinstance(expires, str):
        expires = datetime.fromisoformat(expires)
    # MongoDB stores BSON datetimes in UTC but returns them as timezone-naive
    # unless tz_aware is enabled. Normalize both Mongo and memory values before
    # comparing so a valid persisted session never crashes after login.
    if expires and expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if not expires or expires < datetime.now(timezone.utc):
        await civic_repo.delete_one("sessions", "token_hash", token_hash(token))
        return None
    if session["role"] == "admin":
        user = {"user_id": "ADMIN", "name": "UrbanFix Administrator", "email": "admin", "role": "admin"}
    else:
        user = await civic_repo.find_one("users", "user_id", session["user_id"])
    if not user:
        return None
    return {**user, "csrf_token": session["csrf_token"], "session_id": session["session_id"]}


async def require_user(request: Request) -> dict:
    user = await optional_user(request)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Login required")
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        csrf = request.headers.get("x-csrf-token")
        if not csrf or not hmac.compare_digest(csrf, user["csrf_token"]):
            raise HTTPException(status_code=403, detail="Invalid CSRF token")
    return user


async def require_admin(user: dict = Depends(require_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Administrator access required")
    return user


def public_user(user: dict) -> dict:
    return {key: user.get(key) for key in ("user_id", "name", "email", "role")} | {"csrf_token": user.get("csrf_token")}
