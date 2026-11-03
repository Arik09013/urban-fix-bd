from __future__ import annotations

from datetime import datetime, timezone


STATUS_TRANSITIONS = {
    "Submitted": {"Needs Review", "Assigned", "Acknowledged", "Rejected"},
    "Needs Review": {"Assigned", "Rejected"},
    "Assigned": {"Acknowledged", "In Progress", "Needs Review"},
    "Contractor Offer Sent": {"Assigned", "Acknowledged", "In Progress"},
    "Acknowledged": {"In Progress", "Needs Review"},
    "In Progress": {"Resolution Submitted", "Needs Review"},
    "Resolution Submitted": {"Evidence Uploaded", "In Progress"},
    "Evidence Uploaded": {"Verification", "In Progress", "Reopened - Needs Review"},
    "Verification": {"Resolved", "In Progress", "Reopened - Needs Review"},
    "Reopened - Needs Review": {"Assigned", "Acknowledged", "In Progress"},
    "Resolved": {"Reopened - Needs Review"},
}


class InvalidTransition(ValueError):
    pass


def validate_transition(complaint: dict, target: str) -> None:
    current = complaint.get("status", "Submitted")
    if target == current:
        raise InvalidTransition(f"Complaint is already {current}")
    if target not in STATUS_TRANSITIONS.get(current, set()):
        raise InvalidTransition(f"Cannot move complaint from {current} to {target}")
    if current == "Submitted" and target == "Acknowledged":
        assigned = complaint.get("assigned_authority") or {}
        if assigned.get("routing_status") != "assigned" or complaint.get("review_type") == "routing_uncertain":
            raise InvalidTransition("Cannot acknowledge complaint with uncertain authority routing; administrator review required")
    if current == "Reopened - Needs Review" and complaint.get("review_type") == "routing_uncertain":
        raise InvalidTransition("Routing-uncertain complaints require administrator review before operational dispatch")
    if target in {"Evidence Uploaded", "Verification", "Resolved"} and not complaint.get("resolution_evidence"):
        raise InvalidTransition("Resolution evidence is required before verification or closure")
    if target == "Resolved" and not complaint.get("fully_verified"):
        raise InvalidTransition("All required resolution approvals are required before closure")


def transition_changes(complaint: dict, target: str, note: str, actor: dict, source: str = "human") -> dict:
    validate_transition(complaint, target)
    now = datetime.now(timezone.utc)
    history = list(complaint.get("status_history", []))
    history.append({
        "status": target,
        "note": note,
        "at": now,
        "actor_id": actor.get("user_id", "SYSTEM"),
        "actor_role": actor.get("role", "system"),
        "decision_source": source,
    })
    changes = {"status": target, "status_history": history, "updated_at": now}
    if target == "Assigned" and not complaint.get("assigned_at"):
        changes["assigned_at"] = now
    if target == "Acknowledged":
        changes["acknowledged_at"] = now
        if not complaint.get("assigned_at"):
            changes["assigned_at"] = now
        if complaint.get("review_type") == "citizen_dispute":
            changes["needs_review"] = False
            changes["review_type"] = None
    if target == "In Progress":
        if complaint.get("review_type") == "citizen_dispute":
            changes["needs_review"] = False
            changes["review_type"] = None
    if target == "Resolution Submitted":
        changes["resolution_submitted_at"] = now
    if target == "Resolved":
        changes["resolved_at"] = now
    if target == "Reopened - Needs Review":
        changes["reopened_at"] = now
        changes["needs_review"] = True
        changes["review_type"] = "citizen_dispute"
    return changes
