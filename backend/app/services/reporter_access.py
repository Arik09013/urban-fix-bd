from __future__ import annotations

from datetime import timedelta
from datetime import datetime
import hashlib
import secrets

from app.db.repository import civic_repo, now_utc, public_id


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


async def create_reporter_access(complaint_id: str, contact: str, channel: str = "Portal") -> str:
    token = secrets.token_urlsafe(32)
    await civic_repo.insert_one("report_owners", {
        "owner_id": public_id("OWN"),
        "complaint_id": complaint_id,
        "contact_hash": _hash(contact.strip().lower()),
        "token_hash": _hash(token),
        "channel": channel,
        "created_at": now_utc(),
        "expires_at": now_utc() + timedelta(days=30),
        "verification_count": 0,
        "revoked": False,
    })
    return token


async def verify_reporter_access(complaint_id: str, token: str) -> dict | None:
    owner = await civic_repo.find_one("report_owners", "token_hash", _hash(token))
    if not owner or owner.get("complaint_id") != complaint_id or owner.get("revoked"):
        return None
    expires = owner.get("expires_at")
    if isinstance(expires, str):
        expires = datetime.fromisoformat(expires.replace("Z", "+00:00"))
    if expires and expires < now_utc():
        return None
    return owner
