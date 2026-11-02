from __future__ import annotations

from datetime import timedelta, timezone
from difflib import SequenceMatcher
from math import asin, cos, radians, sin, sqrt

from app.core.config import settings
from app.db.repository import now_utc


SPAM_SIGNAL_LIMIT = 1


def requires_review(analysis: dict, payload: dict) -> tuple[bool, str | None]:
    if analysis.get("confidence", 0) < settings.ai_min_confidence:
        return True, f"AI confidence below {round(settings.ai_min_confidence * 100)}%; officer review required before routing."
    if payload.get("image_quality") in {"blurry", "dark", "missing"}:
        return True, "Image quality is too low for confident classification."
    location = payload.get("location") or {}
    if not location.get("area"):
        return True, "Location is required before assigning field work."
    if analysis.get("multi_issue_detected"):
        return True, "Multiple civic issues detected; officer should split or confirm."
    return False, None


def sla_minutes_for(severity: str, safety_flag: bool = False) -> int:
    if safety_flag:
        return 120
    return {
        "Critical": 240,
        "High": 720,
        "Medium": 1440,
        "Low": 2880,
    }.get(severity, 1440)


def sla_state(created_at, sla_minutes: int) -> dict:
    if isinstance(created_at, str):
        from datetime import datetime
        created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    due_at = created_at + timedelta(minutes=sla_minutes)
    remaining = due_at - now_utc()
    overdue = remaining.total_seconds() < 0
    minutes = abs(int(remaining.total_seconds() // 60))
    return {
        "sla_due_at": due_at,
        "sla_status": "Overdue - Escalate" if overdue else "On Track",
        "sla_remaining_label": f"{minutes // 60}h {minutes % 60}m {'overdue' if overdue else 'remaining'}",
    }


def is_similar_text(left: str, right: str) -> bool:
    return SequenceMatcher(None, left.lower(), right.lower()).ratio() >= 0.58


def _distance_km(left: dict, right: dict) -> float | None:
    try:
        lat1, lon1 = float(left["latitude"]), float(left["longitude"])
        lat2, lon2 = float(right["latitude"]), float(right["longitude"])
    except (KeyError, TypeError, ValueError):
        return None
    radius = 6371.0
    dlat, dlon = radians(lat2 - lat1), radians(lon2 - lon1)
    value = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * radius * asin(sqrt(value))


def duplicate_assessment(payload: dict, analysis: dict, existing: list[dict]) -> dict | None:
    best = None
    now = now_utc()
    description = payload.get("description", "")
    location = payload.get("location") or {}
    area = location.get("area", "").strip().lower()
    for item in existing:
        if item.get("status") == "Resolved":
            continue
        text_score = SequenceMatcher(None, description.lower(), item.get("description", "").lower()).ratio()
        same_category = item.get("category") == analysis.get("category")
        same_area = bool(area and area == item.get("location", {}).get("area", "").strip().lower())
        distance = _distance_km(location, item.get("location") or {})
        geo_score = 1.0 if distance is not None and distance <= 0.15 else (0.75 if distance is not None and distance <= 0.75 else (0.60 if same_area else 0.0))
        created = item.get("created_at")
        if isinstance(created, str):
            from datetime import datetime
            created = datetime.fromisoformat(created.replace("Z", "+00:00"))
        if created and created.tzinfo is None:
            from datetime import timezone
            created = created.replace(tzinfo=timezone.utc)
        age_days = abs((now - created).total_seconds()) / 86400 if created else 999
        time_score = 1.0 if age_days <= 1 else (0.75 if age_days <= 7 else (0.45 if age_days <= 30 else 0.1))
        confidence = round((0.42 * text_score) + (0.28 * geo_score) + (0.20 * time_score) + (0.10 if same_category else 0), 3)
        candidate = {
            "complaint": item,
            "confidence": min(confidence, 1.0),
            "signals": {"text_similarity": round(text_score, 3), "distance_km": round(distance, 3) if distance is not None else None, "same_area": same_area, "same_category": same_category, "age_days": round(age_days, 1)},
        }
        if best is None or candidate["confidence"] > best["confidence"]:
            best = candidate
    return best


def find_duplicate_incident(payload: dict, analysis: dict, existing: list[dict]) -> dict | None:
    assessment = duplicate_assessment(payload, analysis, existing)
    if assessment and assessment["confidence"] >= settings.duplicate_auto_merge_confidence:
        return assessment["complaint"]
    return None


def recurring_count(area: str, existing: list[dict]) -> int:
    normalized = " ".join("".join(char.lower() if char.isalnum() else " " for char in area).split())
    cutoff = now_utc() - timedelta(days=90)
    count = 0
    for item in existing:
        candidate = item.get("location", {}).get("area", "")
        candidate = " ".join("".join(char.lower() if char.isalnum() else " " for char in candidate).split())
        created = item.get("created_at")
        if isinstance(created, str):
            from datetime import datetime
            created = datetime.fromisoformat(created.replace("Z", "+00:00"))
        if created and created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if candidate == normalized and created and created >= cutoff:
            count += 1
    return count


def should_hotspot(area: str, existing: list[dict]) -> bool:
    return recurring_count(area, existing) >= 3


def spam_limited_increment(complaint: dict, source_fingerprint: str | None) -> bool:
    sources = complaint.get("affected_sources", [])
    if not source_fingerprint:
        return True
    return sources.count(source_fingerprint) < SPAM_SIGNAL_LIMIT
