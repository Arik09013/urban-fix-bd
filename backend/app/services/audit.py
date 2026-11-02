from __future__ import annotations

import hashlib
import json

from app.db.repository import civic_repo, now_utc, public_id


async def record_audit_event(
    entity_type: str,
    entity_id: str,
    action: str,
    actor: dict,
    before: dict | None = None,
    after: dict | None = None,
    reason: str | None = None,
    source: str = "human",
    session=None,
) -> dict:
    prior = [item for item in await civic_repo.list_all("audit_events") if item.get("entity_type") == entity_type and item.get("entity_id") == entity_id]
    prior.sort(key=lambda item: str(item.get("created_at")))
    previous_hash = prior[-1].get("event_hash") if prior else None
    event = {
        "event_id": public_id("AUD"),
        "entity_type": entity_type,
        "entity_id": entity_id,
        "action": action,
        "actor_id": actor.get("user_id", "SYSTEM"),
        "actor_role": actor.get("role", "system"),
        "source": source,
        "reason": reason,
        "before": before or {},
        "after": after or {},
        "created_at": now_utc(),
        "previous_hash": previous_hash,
    }
    canonical = json.dumps(event, sort_keys=True, default=str, separators=(",", ":")).encode()
    event["event_hash"] = "sha256:" + hashlib.sha256(canonical).hexdigest()
    return await civic_repo.insert_one("audit_events", event, session=session)
