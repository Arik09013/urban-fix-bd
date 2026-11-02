from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, File, Form, UploadFile
from pydantic import BaseModel, Field

from app.db.repository import civic_repo, now_utc, public_id
from app.services.storage.cloudinary import store_upload
from app.core.security import require_admin, require_user
from app.services.audit import record_audit_event
from app.services.payments import release_community_payment
from app.services.volunteer_safety import volunteer_eligibility

router = APIRouter(prefix="/api/repair-requests", tags=["community repair requests"])


class RepairRequestCreate(BaseModel):
    complaint_id: str
    applicant_name: str = ""
    applicant_contact: str = ""
    estimated_price: int = Field(..., gt=0, le=10_000_000)
    plan: str = Field(..., min_length=10, max_length=3000)
    estimated_hours: int = Field(default=24, ge=1, le=720)


class DecisionCreate(BaseModel):
    approved: bool
    approved_budget: Optional[int] = Field(default=None, gt=0, le=10_000_000)
    note: Optional[str] = Field(default=None, max_length=1000)


class ProofCreate(BaseModel):
    before_image_url: Optional[str] = None
    after_image_url: str = Field(..., min_length=3, max_length=2000)
    completion_note: str = Field(..., min_length=5, max_length=2000)
    gps_latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    gps_longitude: Optional[float] = Field(default=None, ge=-180, le=180)


@router.get("")
async def list_repair_requests(user: dict = Depends(require_user)):
    requests = await civic_repo.list_all("repair_requests")
    if user["role"] != "admin":
        requests = [item for item in requests if item.get("applicant_user_id") == user["user_id"]]
    return {"requests": requests}


@router.post("")
async def create_repair_request(payload: RepairRequestCreate, user: dict = Depends(require_user)):
    if user["role"] != "youth":
        raise HTTPException(status_code=403, detail="A youth account is required to submit repair proposals")
    complaint = await civic_repo.find_one("complaints", "complaint_id", payload.complaint_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    if complaint.get("status") == "Resolved":
        raise HTTPException(status_code=409, detail="This problem is already resolved")
    eligible, reason = volunteer_eligibility(complaint)
    if not eligible:
        raise HTTPException(status_code=403, detail=reason)
    existing = [item for item in await civic_repo.list_all("repair_requests") if
                item.get("applicant_user_id") == user["user_id"] and
                item.get("complaint_id") == payload.complaint_id and
                item.get("status") not in {"Rejected", "Completed"}]
    if existing:
        raise HTTPException(status_code=409, detail="You already have an active proposal for this problem")
    assigned_offer = [item for item in await civic_repo.list_all("offers") if item.get("complaint_id") == payload.complaint_id and item.get("status") in {"Accepted", "In Progress", "Proof Submitted"}]
    if assigned_offer:
        raise HTTPException(status_code=409, detail="This incident is already assigned to a professional contractor")
    timestamp = now_utc()
    request = {
        "request_id": public_id("REQ"),
        **payload.model_dump(),
        "applicant_user_id": user["user_id"],
        "applicant_name": user["name"],
        "applicant_contact": user.get("email") or payload.applicant_contact,
        "issue_title": complaint.get("summary") or complaint.get("description"),
        "issue_location": complaint.get("location"),
        "status": "Pending Admin Review",
        "approved_budget": None,
        "funds_status": "Not Allocated",
        "proof": None,
        "admin_note": None,
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    async with civic_repo.transaction() as session:
        created = await civic_repo.insert_one("repair_requests", request, session=session)
        await record_audit_event("repair_request", created["request_id"], "created", user, after={"complaint_id": payload.complaint_id, "estimated_price": payload.estimated_price}, session=session)
        await civic_repo.update_one("complaints", "complaint_id", payload.complaint_id, {
            "community_repair_interest_count": complaint.get("community_repair_interest_count", 0) + 1,
        }, session=session)
    return created


@router.patch("/{request_id}/decision")
async def decide_repair_request(request_id: str, payload: DecisionCreate, _admin: dict = Depends(require_admin)):
    request = await civic_repo.find_one("repair_requests", "request_id", request_id)
    if not request:
        raise HTTPException(status_code=404, detail="Repair request not found")
    if request.get("status") != "Pending Admin Review":
        raise HTTPException(status_code=409, detail=f"A decision cannot be recorded while request is {request.get('status')}")
    if payload.approved and payload.approved_budget is None:
        raise HTTPException(status_code=400, detail="Approved budget is required")
    if payload.approved:
        competing = [item for item in await civic_repo.list_all("repair_requests") if item.get("complaint_id") == request.get("complaint_id") and item.get("request_id") != request_id and item.get("status") in {"Approved - Awaiting Work", "Proof Submitted - Awaiting Verification"}]
        contractor_jobs = [item for item in await civic_repo.list_all("offers") if item.get("complaint_id") == request.get("complaint_id") and item.get("status") in {"Accepted", "In Progress", "Proof Submitted"}]
        if competing or contractor_jobs:
            raise HTTPException(status_code=409, detail="This incident already has an active assignment")
    async with civic_repo.transaction() as session:
        updated = await civic_repo.update_one("repair_requests", "request_id", request_id, {
            "status": "Approved - Awaiting Work" if payload.approved else "Rejected",
            "approved_budget": payload.approved_budget if payload.approved else None,
            "funds_status": "Budget Reserved" if payload.approved else "Not Allocated",
            "admin_note": payload.note,
        }, session=session)
        await record_audit_event("repair_request", request_id, "approved" if payload.approved else "rejected", _admin, {"status": request.get("status")}, {"status": updated.get("status"), "approved_budget": updated.get("approved_budget")}, payload.note, session=session)
    return updated


@router.post("/{request_id}/proof")
async def submit_repair_proof(request_id: str, payload: ProofCreate, user: dict = Depends(require_user)):
    request = await civic_repo.find_one("repair_requests", "request_id", request_id)
    if not request:
        raise HTTPException(status_code=404, detail="Repair request not found")
    if user["role"] != "admin" and request.get("applicant_user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="You can only submit proof for your own repair request")
    if request.get("status") != "Approved - Awaiting Work":
        raise HTTPException(status_code=400, detail="Request must be approved before proof can be submitted")
    async with civic_repo.transaction() as session:
        updated = await civic_repo.update_one("repair_requests", "request_id", request_id, {
            "status": "Proof Submitted - Awaiting Verification",
            "proof": payload.model_dump() | {"submitted_at": now_utc()},
        }, session=session)
        await record_audit_event("repair_request", request_id, "proof_submitted", user, {"status": request.get("status")}, {"status": updated.get("status")}, payload.completion_note, session=session)
    return updated


@router.post("/{request_id}/proof-with-image")
async def submit_repair_proof_image(
    request_id: str,
    completion_note: str = Form(..., min_length=5),
    image: UploadFile = File(...),
    gps_latitude: Optional[float] = Form(default=None),
    gps_longitude: Optional[float] = Form(default=None),
    user: dict = Depends(require_user),
):
    request = await civic_repo.find_one("repair_requests", "request_id", request_id)
    if not request:
        raise HTTPException(status_code=404, detail="Repair request not found")
    if user["role"] != "admin" and request.get("applicant_user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="You can only submit proof for your own repair request")
    if request.get("status") != "Approved - Awaiting Work":
        raise HTTPException(status_code=409, detail="Request must be approved before proof can be uploaded")
    image_url = await store_upload(image)
    return await submit_repair_proof(request_id, ProofCreate(
        after_image_url=image_url,
        completion_note=completion_note,
        gps_latitude=gps_latitude,
        gps_longitude=gps_longitude,
    ), user)


@router.post("/{request_id}/release-funds")
async def release_funds(request_id: str, _admin: dict = Depends(require_admin)):
    request = await civic_repo.find_one("repair_requests", "request_id", request_id)
    if not request:
        raise HTTPException(status_code=404, detail="Repair request not found")
    if request.get("status") != "Proof Submitted - Awaiting Verification" or not request.get("proof"):
        raise HTTPException(status_code=400, detail="Verified completion proof is required before funds can be released")
    applicant = await civic_repo.find_one("users", "user_id", request["applicant_user_id"])
    if not applicant:
        raise HTTPException(status_code=409, detail="Community worker payment profile is unavailable")
    payment = await release_community_payment(request, applicant)
    complaint = await civic_repo.find_one("complaints", "complaint_id", request["complaint_id"])
    history = complaint.get("status_history", [])
    history.append({"status": "Resolved", "note": f"Community repair proof verified and funds released for {request_id}.", "at": now_utc()})
    async with civic_repo.transaction() as session:
        updated = await civic_repo.update_one("repair_requests", "request_id", request_id, {
            "status": "Completed", "funds_status": "Released", "funds_released_at": now_utc(),
            "payment_provider": payment.provider, "payment_reference": payment.reference,
        }, session=session)
        await civic_repo.update_one("complaints", "complaint_id", request["complaint_id"], {
            "status": "Resolved", "resolution_evidence": request["proof"],
            "resolution_approvals": {"contractor": True, "government": True}, "fully_verified": True,
            "resolved_at": now_utc(), "status_history": history,
        }, session=session)
        await record_audit_event("repair_request", request_id, "payment_released_after_proof", _admin, {"status": request.get("status"), "funds_status": request.get("funds_status")}, {"status": "Completed", "funds_status": "Released", "payment_reference": payment.reference}, "Completion proof reviewed by authority", session=session)
    return updated
