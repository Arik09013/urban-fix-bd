from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from app.core.security import require_admin, require_admin_or_officer
from app.db.repository import civic_repo, now_utc
from app.schemas.complaint import AdminVerificationRequest
from app.services.audit import record_audit_event
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
    authority_id: Optional[str] = Query(default=None, max_length=50),
    user: dict = Depends(require_admin_or_officer),
):
    # Authority isolation: Resolve officer authority strictly from session
    if user.get("role") == "officer":
        if authority_id and authority_id != user.get("authority_id"):
            raise HTTPException(status_code=403, detail="Officers cannot access queues for other authorities")
        target_authority = user.get("authority_id")
    else:
        target_authority = authority_id

    items = await civic_repo.list_all("complaints")
    cutoff = datetime.now(timezone.utc) - timedelta(days=days) if days else None
    assigned_states = {"Assigned", "In Progress", "Evidence Uploaded"}
    needs_action_states = {"Submitted", "Needs Review"}

    def included(item: dict) -> bool:
        created = _utc(item.get("created_at"))
        if cutoff and (not created or created < cutoff):
            return False
        if target_authority:
            item_auth = (item.get("assigned_authority") or {}).get("authority_id")
            if item_auth != target_authority:
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
async def entity_audit_trail(entity_type: str, entity_id: str, user: dict = Depends(require_admin_or_officer)):
    if user.get("role") == "officer":
        if entity_type == "complaint":
            complaint = await civic_repo.find_one("complaints", "complaint_id", entity_id)
            if not complaint:
                raise HTTPException(status_code=404, detail="Complaint not found")
            assigned = complaint.get("assigned_authority") or {}
            if assigned.get("authority_id") != user.get("authority_id"):
                raise HTTPException(status_code=403, detail="Access denied to audit trail of other authority's complaint")
        else:
            raise HTTPException(status_code=403, detail="Officers cannot access non-complaint audit trails")
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
async def incident_workspace(complaint_id: str, user: dict = Depends(require_admin_or_officer)):
    complaint = await civic_repo.find_one("complaints", "complaint_id", complaint_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    if user.get("role") == "officer":
        assigned = complaint.get("assigned_authority") or {}
        if assigned.get("authority_id") != user.get("authority_id"):
            raise HTTPException(status_code=403, detail="Access denied to other authority's incident workspace")
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


@router.get("/work-history")
async def authority_work_history(
    authority_id: Optional[str] = Query(default=None, max_length=50),
    status: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None, max_length=120),
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    user: dict = Depends(require_admin_or_officer),
):
    # Authority isolation: Resolve officer authority strictly from session
    if user.get("role") == "officer":
        if authority_id and authority_id != user.get("authority_id"):
            raise HTTPException(status_code=403, detail="Officers cannot access work history for other authorities")
        target_authority = user.get("authority_id")
    else:
        target_authority = authority_id

    items = await civic_repo.list_all("complaints")

    # Date range parsing
    dt_from = None
    if date_from:
        try:
            dt_from = datetime.fromisoformat(date_from.replace("Z", "+00:00")).astimezone(timezone.utc)
        except Exception:
            pass
    dt_to = None
    if date_to:
        try:
            dt_to = datetime.fromisoformat(date_to.replace("Z", "+00:00")).astimezone(timezone.utc)
            if len(date_to) <= 10:
                dt_to = dt_to.replace(hour=23, minute=59, second=59)
        except Exception:
            pass

    authority_items = []
    for item in items:
        item_auth = (item.get("assigned_authority") or {}).get("authority_id")
        if target_authority and item_auth != target_authority:
            continue
        authority_items.append(item)

    stats = {
        "total_assigned": len(authority_items),
        "in_progress": len([i for i in authority_items if i.get("status") in {"In Progress", "Acknowledged"}]),
        "pending_verification": len([i for i in authority_items if i.get("status") in {"Evidence Uploaded", "Verification", "Resolution Submitted"}]),
        "verified": len([i for i in authority_items if i.get("status") == "Resolved" or i.get("admin_verified")]),
        "rejected": len([i for i in authority_items if i.get("status") == "Rejected"]),
    }

    def match_item(item: dict) -> bool:
        item_status = item.get("status", "")
        if status and status != "all":
            if status.lower() == "pending_verification":
                if item_status not in {"Evidence Uploaded", "Verification", "Resolution Submitted"}:
                    return False
            elif status.lower() in {"verified", "completed"}:
                if item_status != "Resolved" and not item.get("admin_verified"):
                    return False
            elif status.lower() == "rejected":
                if item_status != "Rejected":
                    return False
            elif status.lower() == "in_progress":
                if item_status not in {"In Progress", "Acknowledged"}:
                    return False
            elif status.lower() == "assigned":
                if item_status != "Assigned":
                    return False
            elif item_status.lower() != status.lower():
                return False

        if category and category != "all" and item.get("category", "").lower() != category.lower():
            return False

        if search:
            search_str = search.lower()
            haystack = " ".join([
                str(item.get("complaint_id", "")),
                str(item.get("summary", "")),
                str(item.get("description", "")),
                str(item.get("category", "")),
                str(item.get("status", "")),
                str(item.get("location", {}).get("area", "")),
                str(item.get("completion_notes", "")),
                str(item.get("rejection_reason", "")),
            ]).lower()
            if search_str not in haystack:
                return False

        task_date = _utc(item.get("work_completed_at") or item.get("resolved_at") or item.get("updated_at") or item.get("created_at"))
        if dt_from and task_date and task_date < dt_from:
            return False
        if dt_to and task_date and task_date > dt_to:
            return False

        return True

    filtered = [item for item in authority_items if match_item(item)]
    filtered.sort(
        key=lambda item: _utc(item.get("work_completed_at") or item.get("updated_at") or item.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )

    def _format_item(c: dict) -> dict:
        item = dict(c)
        item["id"] = item.get("complaint_id")
        return item

    total_count = len(filtered)
    skip = (page - 1) * limit
    paginated = filtered[skip : skip + limit]

    return {
        "items": [_format_item(i) for i in paginated],
        "total": total_count,
        "page": page,
        "limit": limit,
        "has_more": skip + limit < total_count,
        "stats": stats,
    }


@router.get("/verification-queue")
async def admin_verification_queue(
    filter_state: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None, max_length=120),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    user: dict = Depends(require_admin),
):
    items = await civic_repo.list_all("complaints")
    pending_states = {"Evidence Uploaded", "Verification", "Resolution Submitted"}
    reviewed_states = {"Resolved", "Rejected"}

    active_filter = (status or filter_state or "pending").lower()

    def match_item(item: dict) -> bool:
        item_status = item.get("status", "")
        has_evidence = bool(item.get("resolution_evidence") or item.get("officer_evidence_submitted") or item.get("evidence_versions"))
        if not has_evidence and item_status not in pending_states:
            return False

        if active_filter == "pending" and item_status not in pending_states:
            return False
        if active_filter == "reviewed" and item_status not in reviewed_states:
            return False
        if active_filter == "approved" and not (item_status == "Resolved" and item.get("admin_verified")):
            return False
        if active_filter == "rejected" and item_status != "Rejected":
            return False

        if search:
            search_str = search.lower()
            haystack = " ".join([
                str(item.get("complaint_id", "")),
                str(item.get("summary", "")),
                str(item.get("description", "")),
                str(item.get("category", "")),
                str(item.get("status", "")),
                str((item.get("assigned_authority") or {}).get("authority_name", "")),
                str((item.get("assigned_authority") or {}).get("short_code", "")),
                str(item.get("completion_notes", "")),
            ]).lower()
            if search_str not in haystack:
                return False

        return True

    def _format_item(c: dict) -> dict:
        item = dict(c)
        item["id"] = item.get("complaint_id")
        return item

    results = [item for item in items if match_item(item)]
    results.sort(
        key=lambda item: _utc(item.get("updated_at") or item.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )

    stats = {
        "pending_count": len([i for i in items if i.get("status") in pending_states]),
        "approved_count": len([i for i in items if i.get("status") == "Resolved" and i.get("admin_verified")]),
        "rejected_count": len([i for i in items if i.get("status") == "Rejected"]),
    }

    skip = (page - 1) * limit
    paginated = results[skip : skip + limit]

    return {
        "items": [_format_item(i) for i in paginated],
        "count": len(results),
        "total": len(results),
        "page": page,
        "limit": limit,
        "total_pages": max(1, (len(results) + limit - 1) // limit),
        "stats": stats,
    }


@router.post("/verify/{complaint_id}")
async def admin_verify_evidence(
    complaint_id: str,
    payload: AdminVerificationRequest,
    user: dict = Depends(require_admin),
):
    complaint = await civic_repo.find_one("complaints", "complaint_id", complaint_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")

    if not complaint.get("resolution_evidence") and not complaint.get("evidence_versions"):
        raise HTTPException(status_code=400, detail="Cannot verify a complaint without submitted completion evidence")

    now = now_utc()
    now_iso = now.isoformat() if hasattr(now, "isoformat") else str(now)
    admin_name = user.get("name") or user.get("username") or "Administrator"
    evidence_versions = list(complaint.get("evidence_versions") or [])
    history = list(complaint.get("status_history", []))

    if payload.action == "reject":
        if not payload.note or len(payload.note.strip()) < 3:
            raise HTTPException(status_code=422, detail="Mandatory rejection reason (at least 3 characters) is required when rejecting work")

        rejection_reason = payload.note.strip()
        if evidence_versions:
            evidence_versions[-1]["verification_status"] = "rejected"
            evidence_versions[-1]["admin_feedback"] = rejection_reason
            evidence_versions[-1]["verified_by"] = admin_name
            evidence_versions[-1]["verified_at"] = now_iso

        res_evidence = dict(complaint.get("resolution_evidence") or {})
        res_evidence["verification_status"] = "rejected"
        res_evidence["admin_feedback"] = rejection_reason

        history.append({
            "status": "Rejected",
            "note": f"Admin rejected completion evidence: {rejection_reason}",
            "at": now,
            "actor_id": user.get("user_id", "ADMIN"),
            "actor_role": "admin",
            "decision_source": "admin_verification",
        })

        changes = {
            "status": "Rejected",
            "admin_verified": False,
            "rejection_reason": rejection_reason,
            "resolution_evidence": res_evidence,
            "evidence_versions": evidence_versions,
            "admin_verification": {
                "action": "rejected",
                "admin_id": user["user_id"],
                "admin_name": admin_name,
                "rejected_at": now_iso,
                "note": rejection_reason,
            },
            "status_history": history,
            "updated_at": now,
        }
        updated = await civic_repo.update_one("complaints", "complaint_id", complaint_id, changes)
        await record_audit_event(
            "complaint",
            complaint_id,
            "admin_evidence_rejected",
            user,
            {"status": complaint.get("status")},
            {"status": "Rejected", "rejection_reason": rejection_reason},
            rejection_reason,
        )
        return updated

    elif payload.action == "approve":
        approval_note = (payload.note or "Admin approved completion evidence.").strip()
        if evidence_versions:
            evidence_versions[-1]["verification_status"] = "approved"
            evidence_versions[-1]["admin_feedback"] = approval_note
            evidence_versions[-1]["verified_by"] = admin_name
            evidence_versions[-1]["verified_at"] = now_iso

        res_evidence = dict(complaint.get("resolution_evidence") or {})
        res_evidence["verification_status"] = "approved"
        res_evidence["admin_feedback"] = approval_note

        history.append({
            "status": "Resolved",
            "note": f"Admin verified and approved completion: {approval_note}",
            "at": now,
            "actor_id": user.get("user_id", "ADMIN"),
            "actor_role": "admin",
            "decision_source": "admin_verification",
        })

        approvals = dict(complaint.get("resolution_approvals") or {})
        approvals["government"] = True
        approvals["admin"] = True

        changes = {
            "status": "Resolved",
            "admin_verified": True,
            "fully_verified": True,
            "rejection_reason": None,
            "resolution_approvals": approvals,
            "resolution_evidence": res_evidence,
            "evidence_versions": evidence_versions,
            "admin_verification": {
                "action": "approved",
                "admin_id": user["user_id"],
                "admin_name": admin_name,
                "verified_at": now_iso,
                "note": approval_note,
            },
            "resolved_at": complaint.get("resolved_at") or now,
            "status_history": history,
            "updated_at": now,
        }
        updated = await civic_repo.update_one("complaints", "complaint_id", complaint_id, changes)
        await record_audit_event(
            "complaint",
            complaint_id,
            "admin_evidence_approved",
            user,
            {"status": complaint.get("status")},
            {"status": "Resolved", "admin_verified": True},
            approval_note,
        )
        return updated
