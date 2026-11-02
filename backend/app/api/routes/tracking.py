from fastapi import APIRouter, HTTPException

from app.db.repository import civic_repo
from app.services.privacy import public_complaint
from app.services.accountability import build_accountability_receipt

router = APIRouter(prefix="/api/track", tags=["tracking"])


def _complaint_id(value: str) -> str:
    normalized = value.strip().upper()
    return normalized if normalized.startswith("CP-") else f"CP-{normalized}"


@router.get("/{complaint_id}")
async def track_complaint(complaint_id: str):
    complaint_id = _complaint_id(complaint_id)
    complaint = await civic_repo.find_one("complaints", "complaint_id", complaint_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    offers = [
        offer
        for offer in await civic_repo.list_all("offers")
        if offer.get("complaint_id") == complaint_id
    ]
    return {
        "complaint": public_complaint(complaint),
        "complaint_id": complaint["complaint_id"],
        "status": complaint["status"],
        "summary": complaint["summary"],
        "department": complaint["department"],
        "priority_score": complaint["priority_score"],
        "status_history": public_complaint(complaint).get("status_history", []),
        "offers": [{"status": offer.get("status"), "proof_required": offer.get("proof_required"), "created_at": offer.get("created_at")} for offer in offers],
    }


@router.get("/{complaint_id}/receipt")
async def accountability_receipt(complaint_id: str):
    complaint_id = _complaint_id(complaint_id)
    complaint = await civic_repo.find_one("complaints", "complaint_id", complaint_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    return await build_accountability_receipt(complaint)
