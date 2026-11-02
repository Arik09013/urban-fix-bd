from __future__ import annotations

import hashlib
import json

from app.db.repository import civic_repo, now_utc
from app.services.privacy import public_complaint


def _canonical_hash(value) -> str:
    payload = json.dumps(value, sort_keys=True, default=str, separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(payload).hexdigest()


async def build_accountability_receipt(complaint: dict) -> dict:
    public = public_complaint(complaint)
    incident_id = complaint.get("incident_id")
    cluster = [
        public_complaint(item) for item in await civic_repo.list_all("complaints")
        if incident_id and item.get("incident_id") == incident_id
    ] or [public]
    offers = [
        item for item in await civic_repo.list_all("offers")
        if item.get("complaint_id") == complaint["complaint_id"]
    ]
    audit = [
        item for item in await civic_repo.list_all("audit_events")
        if item.get("entity_type") == "complaint" and item.get("entity_id") == complaint["complaint_id"]
    ]
    receipt = {
        "receipt_version": "1.0",
        "generated_at": now_utc(),
        "complaint_id": complaint["complaint_id"],
        "incident_id": incident_id,
        "public_case": public,
        "incident_report_count": len(cluster),
        "incident_reports": [{
            "complaint_id": item.get("complaint_id"),
            "created_at": item.get("created_at"),
            "channel": item.get("channel"),
            "status": item.get("status"),
        } for item in cluster],
        "ai_assessment": {
            "source": complaint.get("analysis_source"),
            "category": complaint.get("ai_category"),
            "severity": complaint.get("ai_severity"),
            "department": complaint.get("ai_department"),
            "confidence": complaint.get("confidence"),
            "human_review_required": complaint.get("needs_review", False),
            "final_decision": complaint.get("final_decision"),
        },
        "priority": {
            "score": complaint.get("priority_score"),
            "breakdown": complaint.get("priority_breakdown"),
            "methodology": "Severity, safety, incident reports, affected citizens, waiting time, and location impact; AI does not authorize closure.",
        },
        "sla": {
            "started_at": complaint.get("sla_started_at"),
            "due_at": complaint.get("sla_due_at"),
            "status": complaint.get("sla_status"),
        },
        "assignments": [{
            "offer_id": item.get("offer_id"), "contractor_name": item.get("contractor_name"),
            "status": item.get("status"), "created_at": item.get("created_at"),
        } for item in offers],
        "resolution": {
            "evidence": public.get("resolution_evidence"),
            "evidence_hash": _canonical_hash(public.get("resolution_evidence")) if public.get("resolution_evidence") else None,
            "approvals": complaint.get("resolution_approvals"),
            "fully_verified": complaint.get("fully_verified", False),
            "citizen_verification": public.get("citizen_verification"),
            "resolved_at": complaint.get("resolved_at"),
        },
        "audit_summary": [{
            "action": item.get("action"), "actor_role": item.get("actor_role"),
            "source": item.get("source"), "created_at": item.get("created_at"),
            "event_hash": item.get("event_hash"), "previous_hash": item.get("previous_hash"),
        } for item in sorted(audit, key=lambda value: str(value.get("created_at")))],
    }
    receipt["receipt_hash"] = _canonical_hash(receipt)
    return receipt
