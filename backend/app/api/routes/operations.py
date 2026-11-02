from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from app.core.security import require_admin

from app.db.repository import civic_repo
from app.services.contractors.matching import rank_contractors

router = APIRouter(prefix="/api/operations", tags=["authority operations"])


def _utc(value):
    if not value:
        return None
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


@router.get("/queue")
async def filtered_incident_queue(
    days: Optional[int] = Query(default=None, ge=1, le=3650),
    state: str = Query(default="all", pattern="^(all|assigned|unresolved|resolved|needs_action)$"),
    category: Optional[str] = None,
    severity: Optional[str] = None,
    search: Optional[str] = Query(default=None, max_length=120),
    _admin: dict = Depends(require_admin),
):
    items = await civic_repo.list_all("complaints")
    cutoff = datetime.now(timezone.utc) - timedelta(days=days) if days else None
    assigned_states = {"Assigned", "In Progress", "Evidence Uploaded"}
    needs_action_states = {"Submitted", "Needs Review"}

    def included(item: dict) -> bool:
        created = _utc(item.get("created_at"))
        if cutoff and (not created or created < cutoff):
            return False
        if state == "assigned" and item.get("status") not in assigned_states:
            return False
        if state == "unresolved" and item.get("status") == "Resolved":
            return False
        if state == "resolved" and item.get("status") != "Resolved":
            return False
        if state == "needs_action" and item.get("status") not in needs_action_states:
            return False
        if category and item.get("category", "").lower() != category.lower():
            return False
        if severity and item.get("severity", "").lower() != severity.lower():
            return False
        if search:
            haystack = " ".join(str(item.get(key, "")) for key in ("complaint_id", "summary", "description", "category", "status"))
            haystack += " " + str(item.get("location", {}).get("area", ""))
            if search.lower() not in haystack.lower():
                return False
        return True

    filtered = [item for item in items if included(item)]
    filtered.sort(key=lambda item: (item.get("priority_score", 0), _utc(item.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc)), reverse=True)
    return {"items": filtered, "count": len(filtered), "total": len(items)}


@router.get("/audit/{entity_type}/{entity_id}")
async def entity_audit_trail(entity_type: str, entity_id: str, _admin: dict = Depends(require_admin)):
    events = [item for item in await civic_repo.list_all("audit_events") if item.get("entity_type") == entity_type and item.get("entity_id") == entity_id]
    events.sort(key=lambda item: item.get("created_at"), reverse=True)
    return {"events": events[:200], "count": len(events)}


def recommended_action(complaint: dict) -> str:
    if complaint.get("needs_review"):
        return "Human officer must verify the AI classification before dispatch."
    if complaint.get("sla_status", "").startswith("Overdue"):
        return "Escalate this overdue incident to the department supervisor."
    if complaint.get("severity") == "Critical" or complaint.get("safety_flag"):
        return "Dispatch the nearest qualified team immediately and secure the area."
    if complaint.get("resolution_evidence") and not complaint.get("fully_verified"):
        return "Review completion evidence and collect remaining stakeholder approvals."
    if complaint.get("status") in {"Submitted", "Assigned"}:
        return "Assign a qualified contractor or departmental field team."
    return "Monitor SLA progress and require photographic evidence before closure."


@router.get("/incidents/{complaint_id}")
async def incident_workspace(complaint_id: str, _admin: dict = Depends(require_admin)):
    complaint = await civic_repo.find_one("complaints", "complaint_id", complaint_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    contractors = await civic_repo.list_all("contractors")
    offers = [
        item for item in await civic_repo.list_all("offers")
        if item.get("complaint_id") == complaint_id
    ]
    repair_requests = [
        item for item in await civic_repo.list_all("repair_requests")
        if item.get("complaint_id") == complaint_id
    ]
    return {
        "complaint": complaint,
        "contractor_matches": rank_contractors(contractors, complaint)[:5],
        "offers": offers,
        "repair_requests": repair_requests,
        "recommended_action": recommended_action(complaint),
        "risk_signals": [
            label for active, label in [
                (complaint.get("safety_flag"), "Public safety risk"),
                (complaint.get("needs_review"), "Human review required"),
                (complaint.get("hotspot_warning"), "Recurring-area hotspot"),
                (complaint.get("duplicate_count", 1) > 1, "Duplicate citizen reports"),
                (complaint.get("sla_status", "").startswith("Overdue"), "SLA overdue"),
                (complaint.get("low_quality_image"), "Low-quality evidence"),
            ] if active
        ],
    }
