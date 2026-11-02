from app.models.constants import SEVERITY_WEIGHT
from datetime import datetime, timezone


def calculate_priority(
    severity: str,
    duplicate_count: int,
    location_impact: int = 14,
    waiting_hours: int = 0,
    affected_count: int = 1,
    safety_flag: bool = False,
) -> tuple[int, dict[str, int]]:
    severity_points = SEVERITY_WEIGHT.get(severity, 24)
    duplicate_points = min(max(duplicate_count - 1, 0) * 4 + max(affected_count - 1, 0) * 2, 22)
    waiting_points = min(waiting_hours // 8, 12)
    impact_points = max(0, min(location_impact, 20))
    safety_points = 12 if safety_flag else 0
    score = min(100, severity_points + duplicate_points + waiting_points + impact_points + safety_points)
    return score, {
        "severity": severity_points,
        "duplicates_and_affected": duplicate_points,
        "age": waiting_points,
        "location_impact": impact_points,
        "critical_safety": safety_points,
    }


def with_current_priority(complaint: dict) -> dict:
    """Return a copy with age-aware priority without mutating persistence."""
    item = dict(complaint)
    created = item.get("created_at")
    if isinstance(created, str):
        created = datetime.fromisoformat(created.replace("Z", "+00:00"))
    if created and created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    waiting_hours = max(0, int((datetime.now(timezone.utc) - created).total_seconds() // 3600)) if created else 0
    score, breakdown = calculate_priority(
        item.get("severity", "Medium"),
        duplicate_count=item.get("duplicate_count", 1),
        location_impact=(item.get("priority_breakdown") or {}).get("location_impact", 14),
        waiting_hours=waiting_hours,
        affected_count=item.get("affected_count", 1),
        safety_flag=item.get("safety_flag", False),
    )
    item["priority_score"] = score
    item["priority_breakdown"] = breakdown
    item["priority_calculated_at"] = datetime.now(timezone.utc)
    return item
