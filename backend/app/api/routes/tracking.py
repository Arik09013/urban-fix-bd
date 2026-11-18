from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Request

from app.core.security import optional_user
from app.db.repository import civic_repo
from app.services.accountability import build_accountability_receipt
from app.services.privacy import public_complaint
from app.services.reporter_access import verify_reporter_access
from app.services.storage.cloudinary import create_signed_evidence_url

router = APIRouter(prefix="/api/track", tags=["tracking"])


def _complaint_id(value: str) -> str:
    normalized = value.strip().upper()
    return normalized if normalized.startswith("CP-") else f"CP-{normalized}"


def _sign_url_if_local(url: str | None, cid: str) -> str | None:
    if not url:
        return url
    if "/uploads/" in url:
        path_part = url.split("?")[0]
        filename = path_part.split("/")[-1].strip()
        if filename:
            return create_signed_evidence_url(cid, filename)
    return url


@router.get("/{complaint_id}")
async def track_complaint(
    complaint_id: str,
    request: Request = None,
    token: Optional[str] = Query(default=None),
):
    complaint_id = _complaint_id(complaint_id)
    complaint = await civic_repo.find_one("complaints", "complaint_id", complaint_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")

    is_authorized = False
    if complaint.get("data_label") == "Demo":
        is_authorized = True
    else:
        user = await optional_user(request) if request else None
        if user:
            if user.get("role") == "admin":
                is_authorized = True
            elif user.get("role") == "officer":
                assigned_auth = (complaint.get("assigned_authority") or {}).get("authority_id")
                if user.get("authority_id") == assigned_auth:
                    is_authorized = True
        if not is_authorized:
            eff_token = token or (request.headers.get("x-reporter-token") if request else None)
            if eff_token:
                owner = await verify_reporter_access(complaint_id, eff_token)
                if owner:
                    is_authorized = True

    public_comp = public_complaint(complaint)

    # Process before image
    image_url = public_comp.get("image_url")
    if image_url and "/uploads/" in image_url:
        if is_authorized:
            public_comp["image_url"] = _sign_url_if_local(image_url, complaint_id)
        else:
            public_comp["image_url"] = None

    # Process resolution evidence: authorized users view in any state; public views if verified
    can_view_evidence = is_authorized or public_comp.get("is_verified")
    res_ev = complaint.get("resolution_evidence")
    if can_view_evidence and isinstance(res_ev, dict):
        res_ev = dict(res_ev)
        after_url = res_ev.get("after_image_url") or res_ev.get("url") or complaint.get("after_image_url")
        if after_url and "/uploads/" in after_url:
            signed_after = _sign_url_if_local(after_url, complaint_id)
            res_ev["after_image_url"] = signed_after
            res_ev["url"] = signed_after
            public_comp["after_image_url"] = signed_after
        elif after_url:
            public_comp["after_image_url"] = after_url
        public_comp["resolution_evidence"] = res_ev
    else:
        public_comp["after_image_url"] = None
        public_comp["resolution_evidence"] = None

    if is_authorized:
        public_comp["evidence_versions"] = complaint.get("evidence_versions", [])
        public_comp["rejection_reason"] = complaint.get("rejection_reason")
        public_comp["admin_verification"] = complaint.get("admin_verification")

    offers = [
        offer
        for offer in await civic_repo.list_all("offers")
        if offer.get("complaint_id") == complaint_id
    ]
    return {
        "complaint": public_comp,
        "complaint_id": complaint["complaint_id"],
        "status": complaint["status"],
        "summary": complaint["summary"],
        "department": complaint["department"],
        "priority_score": complaint["priority_score"],
        "status_history": public_comp.get("status_history", []),
        "offers": [{"status": offer.get("status"), "proof_required": offer.get("proof_required"), "created_at": offer.get("created_at")} for offer in offers],
    }


@router.get("/{complaint_id}/receipt")
async def accountability_receipt(complaint_id: str):
    complaint_id = _complaint_id(complaint_id)
    complaint = await civic_repo.find_one("complaints", "complaint_id", complaint_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    return await build_accountability_receipt(complaint)
