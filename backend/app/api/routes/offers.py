from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from app.core.security import require_admin, require_user

from app.db.repository import civic_repo, now_utc, public_id
from app.schemas.offer import OfferCreate, OfferStatusUpdate
from app.services.audit import record_audit_event
from app.services.drive_verification import verify_public_drive_access
from app.services.payments import release_contractor_payment
from app.services.storage.cloudinary import store_upload

router = APIRouter(prefix="/api/offers", tags=["offers"])


async def _contractor_for_user(user: dict) -> dict | None:
    return next((item for item in await civic_repo.list_all("contractors") if item.get("user_id") == user["user_id"]), None)


@router.get("")
async def list_offers(user: dict = Depends(require_user)):
    offers = await civic_repo.list_all("offers")
    if user.get("role") == "admin":
        return {"offers": offers}
    if user.get("role") == "contractor":
        contractor = await _contractor_for_user(user)
        return {"offers": [item for item in offers if contractor and item.get("contractor_id") == contractor.get("contractor_id")], "contractor": contractor}
    raise HTTPException(status_code=403, detail="Contractor or authority access required")


@router.post("/{offer_id}/proof")
async def submit_work_proof(
    offer_id: str,
    report_url: str = Form(..., min_length=8, max_length=2048),
    public_access_confirmed: bool = Form(...),
    note: str = Form(..., min_length=3, max_length=1000),
    image: UploadFile = File(...),
    user: dict = Depends(require_user),
):
    if user.get("role") != "contractor":
        raise HTTPException(status_code=403, detail="Only the assigned contractor can submit completion proof")
    offer = await civic_repo.find_one("offers", "offer_id", offer_id)
    contractor = await _contractor_for_user(user)
    if not offer:
        raise HTTPException(status_code=404, detail="Work order not found")
    if not contractor or offer.get("contractor_id") != contractor.get("contractor_id"):
        raise HTTPException(status_code=403, detail="This work order is not assigned to your account")
    if offer.get("status") != "In Progress":
        raise HTTPException(status_code=409, detail="Proof can only be submitted for work currently in progress")
    if not public_access_confirmed:
        raise HTTPException(status_code=422, detail="Confirm that anyone with the link can view the Drive report")
    drive_verification = await verify_public_drive_access(report_url)
    normalized_report_url = drive_verification["url"]
    complaint = await civic_repo.find_one("complaints", "complaint_id", offer["complaint_id"])
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    if complaint.get("resolution_evidence"):
        raise HTTPException(status_code=409, detail="Completion evidence has already been submitted")
    image_url = await store_upload(image)
    timestamp = now_utc()
    approvals = dict(complaint.get("resolution_approvals") or {})
    approvals["contractor"] = True
    history = list(complaint.get("status_history", []))
    history.append({"status": "Evidence Uploaded", "note": note, "at": timestamp, "actor_id": user.get("user_id"), "actor_role": "contractor"})
    evidence = {"after_image_url": image_url, "report_url": normalized_report_url, "report_access": "Verified public", "drive_verification": drive_verification, "completion_note": note, "uploaded_by": offer.get("contractor_name"), "uploaded_at": timestamp}
    async with civic_repo.transaction() as session:
        await civic_repo.update_one("offers", "offer_id", offer_id, {
            "status": "Proof Submitted", "note": note, "after_image_url": image_url,
            "report_url": normalized_report_url, "report_access": "Verified public", "drive_verification": drive_verification,
            "proof_submitted_at": timestamp, "updated_at": timestamp,
        }, session=session)
        await civic_repo.update_one("complaints", "complaint_id", offer["complaint_id"], {
            "status": "Evidence Uploaded", "resolution_evidence": evidence,
            "resolution_approvals": approvals, "status_history": history, "updated_at": timestamp,
        }, session=session)
        await record_audit_event("offer", offer_id, "proof_submitted", user, {"status": "In Progress"}, {"status": "Proof Submitted", "report_url": normalized_report_url, "report_access": "verified-public"}, note, session=session)
    return {"offer_id": offer_id, "status": "Proof Submitted", "resolution_evidence": evidence}


@router.post("")
async def create_offer(payload: OfferCreate, _admin: dict = Depends(require_admin)):
    complaint = await civic_repo.find_one("complaints", "complaint_id", payload.complaint_id)
    contractor = await civic_repo.find_one("contractors", "contractor_id", payload.contractor_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    if not contractor:
        raise HTTPException(status_code=404, detail="Contractor not found")
    if not contractor.get("verified") or not contractor.get("available"):
        raise HTTPException(status_code=409, detail="Contractor must be verified and available before dispatch")
    if complaint.get("needs_review") or complaint.get("status") == "Needs Review":
        raise HTTPException(status_code=409, detail="Human review must be completed before contractor dispatch")
    if complaint.get("status") == "Resolved":
        raise HTTPException(status_code=409, detail="Cannot dispatch work for a resolved complaint")
    if complaint.get("resolution_evidence"):
        raise HTTPException(status_code=409, detail="Completed work cannot be assigned again")
    active_offers = [item for item in await civic_repo.list_all("offers") if item.get("complaint_id") == payload.complaint_id and item.get("status") in {"Sent", "Accepted", "In Progress", "Proof Submitted"}]
    if active_offers:
        raise HTTPException(status_code=409, detail="This complaint already has an active contractor assignment")
    timestamp = now_utc()
    issue_location = complaint.get("location", {})
    work_location = {
        "area": payload.work_location_area or issue_location.get("area"),
        "latitude": payload.work_latitude if payload.work_latitude is not None else issue_location.get("latitude"),
        "longitude": payload.work_longitude if payload.work_longitude is not None else issue_location.get("longitude"),
    }
    offer = {
        "offer_id": public_id("OFF"),
        "complaint_id": payload.complaint_id,
        "contractor_id": payload.contractor_id,
        "contractor_name": contractor["name"],
        "issue_title": complaint.get("summary") or complaint.get("description"),
        "issue_location": issue_location,
        "work_location": work_location,
        "work_location_area": work_location["area"],
        "work_latitude": work_location["latitude"],
        "work_longitude": work_location["longitude"],
        "issue_priority": complaint.get("priority_score"),
        "issue_severity": complaint.get("severity"),
        "work_type": payload.work_type,
        "budget_cap": payload.budget_cap,
        "sla_hours": payload.sla_hours,
        "proof_required": payload.proof_required,
        "status": "Sent",
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    history = complaint.get("status_history", [])
    history.append({
        "status": "Contractor Offer Sent",
        "note": f"Offer sent to {contractor['name']} for {work_location.get('area') or 'reported location'}.",
        "at": timestamp,
    })
    async with civic_repo.transaction() as session:
        await civic_repo.update_one("complaints", "complaint_id", payload.complaint_id, {"status": "Contractor Offer Sent", "status_history": history}, session=session)
        created = await civic_repo.insert_one("offers", offer, session=session)
        await record_audit_event("offer", created["offer_id"], "created", _admin, after={"complaint_id": payload.complaint_id, "contractor_id": payload.contractor_id, "budget_cap": payload.budget_cap}, session=session)
    return created


@router.patch("/{offer_id}/status")
async def update_offer_status(offer_id: str, payload: OfferStatusUpdate, user: dict = Depends(require_user)):
    offer = await civic_repo.find_one("offers", "offer_id", offer_id)
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found")
    if user.get("role") == "contractor":
        contractor = await _contractor_for_user(user)
        if not contractor or offer.get("contractor_id") != contractor.get("contractor_id"):
            raise HTTPException(status_code=403, detail="This work order is not assigned to your account")
        if payload.status not in {"Accepted", "Rejected", "In Progress"}:
            raise HTTPException(status_code=403, detail="Authority approval is required")
    elif user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Contractor or authority access required")
    allowed = {
        "Sent": {"Accepted", "Rejected"},
        "Accepted": {"In Progress", "Rejected"},
        "In Progress": {"Proof Submitted"},
        "Proof Submitted": {"Approved", "In Progress"},
    }
    if payload.status == offer.get("status"):
        raise HTTPException(status_code=409, detail=f"Work order is already {payload.status}")
    if payload.status == "Proof Submitted":
        raise HTTPException(status_code=409, detail="Submit the required photo and report link through the proof endpoint")
    if payload.status not in allowed.get(offer.get("status"), set()):
        raise HTTPException(status_code=409, detail=f"Cannot move offer from {offer.get('status')} to {payload.status}")
    if payload.status == "Approved":
        complaint = await civic_repo.find_one("complaints", "complaint_id", offer["complaint_id"])
        if not complaint or not complaint.get("resolution_evidence"):
            raise HTTPException(status_code=409, detail="Stored completion evidence is required before approving contractor work")
        contractor = await civic_repo.find_one("contractors", "contractor_id", offer["contractor_id"])
        if not contractor:
            raise HTTPException(status_code=409, detail="Assigned contractor record is unavailable")
        payment = await release_contractor_payment(offer, contractor)
    offer_changes = {"status": payload.status, "note": payload.note, "updated_at": now_utc()}
    if offer.get("status") == "Proof Submitted" and payload.status == "In Progress":
        offer_changes.update({"after_image_url": None, "report_url": None, "report_access": None, "proof_submitted_at": None})
    if payload.status == "Approved":
        offer_changes.update({
            "payment_status": "Released",
            "payment_amount": offer.get("budget_cap"),
            "payment_released_at": now_utc(),
            "payment_provider": payment.provider,
            "payment_reference": payment.reference,
            "approved_by": user.get("user_id"),
        })
    async with civic_repo.transaction() as session:
        updated = await civic_repo.update_one("offers", "offer_id", offer_id, offer_changes, session=session)
        complaint = await civic_repo.find_one("complaints", "complaint_id", offer["complaint_id"])
        complaint_changes = None
        if complaint and payload.status in {"Accepted", "In Progress", "Rejected"}:
            other_active = [item for item in await civic_repo.list_all("offers") if item.get("complaint_id") == offer["complaint_id"] and item.get("offer_id") != offer_id and item.get("status") in {"Sent", "Accepted", "In Progress", "Proof Submitted"}]
            complaint_status = {"Accepted": "Assigned", "In Progress": "In Progress", "Rejected": complaint.get("status") if other_active else "Submitted"}[payload.status]
            history = complaint.get("status_history", [])
            history.append({"status": f"Contractor {payload.status}", "note": payload.note or f"Offer {offer_id} was {payload.status.lower()}.", "at": now_utc()})
            complaint_changes = {
                "status": complaint_status,
                "assigned_contractor_id": offer.get("contractor_id") if payload.status != "Rejected" else None,
                "assigned_contractor_name": offer.get("contractor_name") if payload.status != "Rejected" else None,
                "status_history": history,
            }
            if offer.get("status") == "Proof Submitted" and payload.status == "In Progress":
                approvals = dict(complaint.get("resolution_approvals") or {})
                approvals["contractor"] = False
                complaint_changes.update({"resolution_evidence": None, "resolution_approvals": approvals})
        elif complaint and payload.status == "Approved":
            approvals = dict(complaint.get("resolution_approvals") or {})
            approvals["government"] = True
            history = list(complaint.get("status_history", []))
            history.append({"status": "Resolved", "note": payload.note or "Authority approved the final review and released contractor payment.", "at": now_utc(), "actor_id": user.get("user_id"), "actor_role": "admin"})
            complaint_changes = {"status": "Resolved", "resolution_approvals": approvals, "fully_verified": all(approvals.get(key) for key in ("contractor", "government")), "resolved_at": now_utc(), "status_history": history, "updated_at": now_utc()}
        if complaint_changes:
            await civic_repo.update_one("complaints", "complaint_id", offer["complaint_id"], complaint_changes, session=session)
        await record_audit_event("offer", offer_id, "status_transition", user, {"status": offer.get("status")}, {"status": payload.status, "payment_reference": getattr(locals().get("payment"), "reference", None)}, payload.note, session=session)
    return updated
