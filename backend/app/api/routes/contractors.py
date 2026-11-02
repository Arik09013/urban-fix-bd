from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.core.security import require_admin

from app.db.repository import civic_repo, public_id
from app.schemas.contractor import ContractorCreate
from app.services.contractors.matching import rank_contractors

router = APIRouter(prefix="/api/contractors", tags=["contractors"])


class ContractorApproval(BaseModel):
    approved: bool
    payout_account_id: Optional[str] = None


@router.get("")
async def list_contractors(_admin: dict = Depends(require_admin)):
    return {"contractors": await civic_repo.list_all("contractors")}


@router.post("")
async def register_contractor(payload: ContractorCreate, _admin: dict = Depends(require_admin)):
    contractor = {
        "contractor_id": public_id("CTR"),
        "name": payload.name,
        "contact": payload.contact,
        "service_area": payload.service_area,
        "skills": payload.skills,
        "rating": 4.5,
        "completed_jobs": 0,
        "distance_km": 0,
        "verified": bool(payload.verification_id),
        "available": True,
        "trust_score": 70 if payload.verification_id else 45,
    }
    return await civic_repo.insert_one("contractors", contractor)


@router.patch("/{contractor_id}/approval")
async def approve_contractor(contractor_id: str, payload: ContractorApproval, _admin: dict = Depends(require_admin)):
    contractor = await civic_repo.find_one("contractors", "contractor_id", contractor_id)
    if not contractor:
        raise HTTPException(status_code=404, detail="Contractor not found")
    return await civic_repo.update_one("contractors", "contractor_id", contractor_id, {
        "verified": payload.approved, "available": payload.approved,
        "approval_status": "Approved" if payload.approved else "Rejected",
        "trust_score": 70 if payload.approved else 30,
        "payout_account_id": payload.payout_account_id or contractor.get("payout_account_id"),
    })


@router.get("/match/{complaint_id}")
async def match_contractors(complaint_id: str, _admin: dict = Depends(require_admin)):
    complaint = await civic_repo.find_one("complaints", "complaint_id", complaint_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    contractors = await civic_repo.list_all("contractors")
    return {"matches": rank_contractors(contractors, complaint)[:5]}
