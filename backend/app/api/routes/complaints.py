from __future__ import annotations

from typing import Optional
from datetime import datetime, timedelta, timezone
from collections import defaultdict, deque
import base64
import binascii
import json

from fastapi import APIRouter, Depends, Header, HTTPException, Query, UploadFile, File, Form, Request
import hashlib
import hmac

from app.db.repository import civic_repo, now_utc, public_id
from app.core.config import settings
from app.core.security import require_admin
from app.schemas.complaint import (
    AffectedTooCreate,
    CitizenVerificationCreate,
    ReporterVerificationCreate,
    ComplaintCreate,
    ComplaintStatusUpdate,
    OfficerOverride,
    ResolutionEvidenceCreate,
    ResolutionApprovalCreate,
    ContractorRatingCreate,
)
from app.services.ai.gemini import analyze_complaint
from app.services.priority import calculate_priority, with_current_priority
from app.services.storage.cloudinary import store_upload
from app.services.image_metadata import extract_permitted_metadata
from app.services.workflow import (
    duplicate_assessment,
    find_duplicate_incident,
    recurring_count,
    requires_review,
    should_hotspot,
    sla_minutes_for,
    sla_state,
    spam_limited_increment,
)
from app.services.audit import record_audit_event
from app.services.lifecycle import InvalidTransition, transition_changes
from app.services.privacy import public_complaint
from app.services.volunteer_safety import volunteer_eligibility
from app.services.reporter_access import create_reporter_access, verify_reporter_access

router = APIRouter(prefix="/api/complaints", tags=["complaints"])
intake_attempts: dict[str, deque] = defaultdict(deque)
ANALYSIS_TOKEN_TTL_SECONDS = 15 * 60


async def _save_contractor_rating(complaint: dict, source: str, score: int):
    contractor_id = complaint.get("assigned_contractor_id")
    if not contractor_id:
        raise HTTPException(status_code=409, detail="No contractor is assigned to this report")
    if not complaint.get("resolution_evidence"):
        raise HTTPException(status_code=409, detail="Completed work evidence is required before rating")
    ratings = dict(complaint.get("contractor_ratings") or {})
    ratings[source] = score
    updated = await civic_repo.update_one("complaints", "complaint_id", complaint["complaint_id"], {"contractor_ratings": ratings})
    relevant = [item for item in await civic_repo.list_all("complaints") if item.get("assigned_contractor_id") == contractor_id]
    scores = [value for item in relevant for value in (item.get("contractor_ratings") or {}).values() if isinstance(value, (int, float))]
    if scores:
        await civic_repo.update_one("contractors", "contractor_id", contractor_id, {"rating": round(sum(scores) / len(scores), 2), "rating_count": len(scores)})
    return updated


def _analysis_binding(image_bytes: bytes | None, description: str, category_hint: str | None) -> str:
    image_digest = hashlib.sha256(image_bytes or b"").hexdigest()
    # Image-backed analysis remains valid while the citizen edits AI-prepared
    # wording. Text-only analysis remains bound to its submitted description.
    binding_value = image_digest if image_bytes else f"{image_digest}|{description.strip()}"
    return hashlib.sha256(binding_value.encode("utf-8")).hexdigest()


def _sign_analysis(analysis: dict, image_bytes: bytes | None, description: str, category_hint: str | None) -> str:
    payload = {
        "analysis": analysis,
        "binding": _analysis_binding(image_bytes, description, category_hint),
        "expires_at": int(datetime.now(timezone.utc).timestamp()) + ANALYSIS_TOKEN_TTL_SECONDS,
    }
    encoded = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()).rstrip(b"=")
    signature = hmac.new(settings.reporter_token_secret.encode(), encoded, hashlib.sha256).digest()
    return f"{encoded.decode()}.{base64.urlsafe_b64encode(signature).rstrip(b'=').decode()}"


def _verified_analysis(token: str | None, image_bytes: bytes | None, description: str, category_hint: str | None) -> dict | None:
    if not token or "." not in token:
        return None
    encoded_text, signature_text = token.split(".", 1)
    encoded = encoded_text.encode()
    try:
        signature = base64.urlsafe_b64decode(signature_text + "=" * (-len(signature_text) % 4))
        expected = hmac.new(settings.reporter_token_secret.encode(), encoded, hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected):
            return None
        payload = json.loads(base64.urlsafe_b64decode(encoded_text + "=" * (-len(encoded_text) % 4)))
        if payload.get("expires_at", 0) < int(datetime.now(timezone.utc).timestamp()):
            return None
        if payload.get("binding") != _analysis_binding(image_bytes, description, category_hint):
            return None
        return payload.get("analysis")
    except (ValueError, TypeError, json.JSONDecodeError, binascii.Error):
        return None


def check_intake_rate(request: Request) -> None:
    key = request.client.host if request.client else "unknown"
    cutoff = now_utc() - timedelta(minutes=10)
    while intake_attempts[key] and intake_attempts[key][0] < cutoff:
        intake_attempts[key].popleft()
    if len(intake_attempts[key]) >= 20:
        raise HTTPException(status_code=429, detail="Too many reports from this network. Please retry later or use an official assisted channel.")
    intake_attempts[key].append(now_utc())


@router.post("/analyze")
async def analyze_evidence(
    description: str = Form(default="Civic issue shown in the uploaded evidence"),
    category_hint: Optional[str] = Form(default=None),
    image: Optional[UploadFile] = File(default=None),
):
    """Upload evidence and preview the AI triage before creating a complaint."""
    if image and image.content_type not in {"image/jpeg", "image/png", "image/webp", "image/gif"}:
        raise HTTPException(status_code=415, detail="Only JPEG, PNG, WebP, and GIF images are supported")
    image_bytes = await image.read() if image else None
    upload_limit_mb = min(settings.max_upload_mb, 4) if settings.environment == "production" else settings.max_upload_mb
    if image_bytes and len(image_bytes) > upload_limit_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"Image exceeds the {upload_limit_mb} MB upload limit")
    photo_location = extract_permitted_metadata(image_bytes) if image_bytes else None
    analysis = await analyze_complaint(
        description, None, category_hint,
        image_bytes=image_bytes,
        image_mime_type=image.content_type if image else None,
    )
    location_allowed = analysis.get("is_civic_issue") is not False or analysis.get("confidence", 0) < 0.75
    return {
        "image_url": None,
        "photo_location": photo_location if location_allowed else None,
        "analysis_token": _sign_analysis(analysis, image_bytes, description, category_hint),
        **analysis,
    }


@router.get("")
async def list_complaints(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=settings.default_page_size, ge=1, le=settings.max_page_size),
):
    total = await civic_repo.count("complaints")
    complaints = await civic_repo.list_page(
        "complaints", skip=(page - 1) * limit, limit=limit,
        sort=[("priority_score", -1), ("created_at", -1)],
    )
    return {
        "complaints": [public_complaint(with_current_priority(item)) for item in complaints],
        "pagination": {"page": page, "limit": limit, "total": total, "has_more": page * limit < total},
    }


@router.get("/map")
async def map_complaints(
    west: float = Query(ge=-180, le=180), south: float = Query(ge=-90, le=90),
    east: float = Query(ge=-180, le=180), north: float = Query(ge=-90, le=90),
    limit: int = Query(default=1000, ge=1, le=5000),
):
    if west >= east or south >= north:
        raise HTTPException(status_code=422, detail="Invalid map bounding box")
    complaints = await civic_repo.complaints_in_bbox(west, south, east, north, limit)
    return {"complaints": [public_complaint(with_current_priority(item)) for item in complaints], "count": len(complaints), "truncated": len(complaints) == limit}


@router.get("/map/clusters")
async def map_clusters(
    west: float = Query(ge=-180, le=180), south: float = Query(ge=-90, le=90),
    east: float = Query(ge=-180, le=180), north: float = Query(ge=-90, le=90),
    zoom: int = Query(default=12, ge=1, le=19),
):
    if west >= east or south >= north:
        raise HTTPException(status_code=422, detail="Invalid map bounding box")
    clusters = await civic_repo.complaint_clusters(west, south, east, north, zoom)
    return {"clusters": clusters, "count": len(clusters)}


@router.get("/{complaint_id}")
async def get_complaint(complaint_id: str):
    complaint = await civic_repo.find_one("complaints", "complaint_id", complaint_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    return public_complaint(complaint)


async def _create_complaint(payload: ComplaintCreate, analysis_override: dict | None = None):
    analysis = analysis_override or await analyze_complaint(payload.description, payload.image_url, payload.category_hint)
    if payload.image_url and analysis.get("is_civic_issue") is False and analysis.get("confidence", 0) >= 0.75:
        raise HTTPException(status_code=422, detail="The uploaded image does not show a relevant civic issue")
    payload_dict = payload.model_dump()
    existing = await civic_repo.list_all("complaints")
    assessment = duplicate_assessment(payload_dict, analysis, existing)
    # A strong match links reports to one incident but never deletes the new
    # citizen's report or evidence. This preserves provenance and ownership.
    linked_report = assessment["complaint"] if assessment and assessment["confidence"] >= settings.duplicate_auto_merge_confidence else None
    incident_id = linked_report.get("incident_id") if linked_report else None
    if linked_report and not incident_id:
        incident_id = public_id("INC")
        await civic_repo.update_one("complaints", "complaint_id", linked_report["complaint_id"], {"incident_id": incident_id})
    incident_id = incident_id or public_id("INC")

    needs_review, review_reason = requires_review(analysis, payload_dict)
    if assessment and settings.duplicate_review_confidence <= assessment["confidence"] < settings.duplicate_auto_merge_confidence:
        needs_review = True
        review_reason = f"Possible duplicate ({round(assessment['confidence'] * 100)}% confidence); officer confirmation required."
    timestamp = now_utc()
    recurring = recurring_count(payload.location.area, existing)
    safety_flag = analysis.get("safety_flag", False)
    sla_minutes = sla_minutes_for(analysis["severity"], safety_flag)
    sla = sla_state(timestamp, sla_minutes)
    score, breakdown = calculate_priority(
        analysis["severity"],
        duplicate_count=1,
        affected_count=1,
        safety_flag=safety_flag,
    )
    status = "Needs Review" if needs_review else "Submitted"
    department = "Needs Review" if needs_review else analysis["department"]
    complaint_id = public_id("CP", 6)
    while await civic_repo.find_one("complaints", "complaint_id", complaint_id):
        complaint_id = public_id("CP", 6)
    complaint = {
        "complaint_id": complaint_id,
        "incident_id": incident_id,
        "description": payload.description,
        "location": payload.location.model_dump(),
        "location_geo": ({"type": "Point", "coordinates": [payload.location.longitude, payload.location.latitude]}
                         if payload.location.latitude is not None and payload.location.longitude is not None else None),
        "image_url": payload.image_url,
        "category": analysis["category"],
        "severity": analysis["severity"],
        "ai_category": analysis["category"],
        "ai_severity": analysis["severity"],
        "ai_department": analysis["department"],
        "ai_reasoning": analysis["reasoning"],
        "confidence": analysis["confidence"],
        "summary": analysis["summary"],
        "department": department,
        "priority_score": score,
        "priority_breakdown": breakdown,
        "duplicate_count": 1,
        "affected_count": 1,
        "affected_sources": [payload.source_fingerprint] if payload.source_fingerprint else [],
        "needs_review": needs_review,
        "review_reason": review_reason,
        "sla_minutes": sla_minutes,
        "sla_started_at": timestamp,
        "sla_due_at": sla["sla_due_at"],
        "sla_status": sla["sla_status"],
        "sla_remaining_label": sla["sla_remaining_label"],
        "sla_history": [{"event": "SLA Started", "at": timestamp, "due_at": sla["sla_due_at"], "minutes": sla_minutes}],
        "recurring_count_90d": recurring,
        "hotspot_warning": should_hotspot(payload.location.area, existing),
        "safety_flag": safety_flag,
        "low_quality_image": payload.image_quality in {"blurry", "dark", "missing"} or analysis["confidence"] < 0.70,
        "missing_location": not payload.location.area,
        "multi_issue_detected": analysis.get("multi_issue_detected", False),
        "duplicate_suggestion": {
            "complaint_id": assessment["complaint"]["complaint_id"],
            "confidence": assessment["confidence"],
            "signals": assessment["signals"],
        } if assessment and assessment["confidence"] >= settings.duplicate_review_confidence else None,
        "public_reporter_visible": False,
        "data_label": "Live",
        "status": status,
        "channel": "Portal",
        "created_at": timestamp,
        "updated_at": timestamp,
        "final_decision": None,
        "resolution_evidence": None,
        "citizen_verification": None,
        "resolution_approvals": {"contractor": False, "government": False},
        "status_history": [
            {"status": "Reported", "note": "Citizen report received.", "at": timestamp},
            {"status": "AI Classified", "note": analysis["reasoning"], "at": timestamp},
            {"status": status, "note": review_reason or f"Routed to {department}.", "at": timestamp},
        ],
    }
    complaint["analysis_source"] = analysis.get("analysis_source", "unknown")
    complaint["analysis_warning"] = analysis.get("analysis_warning")
    complaint["is_civic_issue"] = analysis.get("is_civic_issue", True)
    complaint["detected_language"] = analysis.get("detected_language", "English")
    complaint["citizen_response"] = analysis.get("citizen_response")
    eligible, eligibility_reason = volunteer_eligibility(complaint)
    complaint["volunteer_eligible"] = eligible
    complaint["volunteer_eligibility_reason"] = eligibility_reason
    created = await civic_repo.insert_one("complaints", complaint)
    if linked_report:
        cluster = [item for item in await civic_repo.list_all("complaints") if item.get("incident_id") == incident_id]
        cluster_size = len(cluster)
        for member in cluster:
            member_score, member_breakdown = calculate_priority(
                member.get("severity", "Medium"), duplicate_count=cluster_size,
                affected_count=member.get("affected_count", 1), safety_flag=member.get("safety_flag", False),
            )
            await civic_repo.update_one("complaints", "complaint_id", member["complaint_id"], {
                "duplicate_count": cluster_size,
                "priority_score": member_score,
                "priority_breakdown": member_breakdown,
            })
        created = await civic_repo.find_one("complaints", "complaint_id", created["complaint_id"])
    if payload.reporter_contact:
        # Returned once to the intake client; only the token hash is persisted.
        created = dict(created)
        created["reporter_verification_token"] = await create_reporter_access(
            created["complaint_id"], payload.reporter_contact, created.get("channel", "Portal")
        )
    return created


async def _idempotent_create(payload: ComplaintCreate, idempotency_key: str | None, analysis_override: dict | None = None):
    if idempotency_key:
        if len(idempotency_key) > 160:
            raise HTTPException(status_code=422, detail="Idempotency-Key is too long")
        existing = await civic_repo.find_one("idempotency_keys", "key", idempotency_key)
        if existing:
            complaint = await civic_repo.find_one("complaints", "complaint_id", existing.get("complaint_id")) if existing.get("complaint_id") else None
            if complaint:
                return complaint
            if existing.get("state") == "completed" and existing.get("complaint_id"):
                # The complaint may have been removed manually while its
                # idempotency record remained. Remove that orphan so a fresh
                # submission is not permanently blocked.
                await civic_repo.delete_one("idempotency_keys", "key", idempotency_key)
            else:
                raise HTTPException(status_code=409, detail="A request with this idempotency key is already processing")
        try:
            await civic_repo.insert_one("idempotency_keys", {"key": idempotency_key, "complaint_id": None, "state": "processing", "created_at": now_utc(), "expires_at": now_utc() + timedelta(hours=24)})
        except Exception as exc:
            # A unique index arbitrates simultaneous requests that passed the
            # read check together. Convert that race into a stable API result.
            winner = await civic_repo.find_one("idempotency_keys", "key", idempotency_key)
            if winner:
                complaint = await civic_repo.find_one("complaints", "complaint_id", winner.get("complaint_id")) if winner.get("complaint_id") else None
                if complaint:
                    return complaint
                raise HTTPException(status_code=409, detail="A request with this idempotency key is already processing") from exc
            raise
    try:
        created = await _create_complaint(payload, analysis_override)
    except Exception:
        if idempotency_key:
            await civic_repo.delete_one("idempotency_keys", "key", idempotency_key)
        raise
    if idempotency_key:
        await civic_repo.update_one("idempotency_keys", "key", idempotency_key, {"complaint_id": created["complaint_id"], "state": "completed"})
    return created


@router.post("")
async def create_complaint(payload: ComplaintCreate, request: Request = None, idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key")):
    if request is not None:
        check_intake_rate(request)
    return await _idempotent_create(payload, idempotency_key)


@router.post("/with-image")
async def create_complaint_with_image(
    request: Request,
    description: str = Form(...),
    area: str = Form(...),
    category_hint: Optional[str] = Form(default=None),
    latitude: Optional[float] = Form(default=None),
    longitude: Optional[float] = Form(default=None),
    location_source: Optional[str] = Form(default=None),
    location_confirmed: bool = Form(default=False),
    location_accuracy_meters: Optional[float] = Form(default=None),
    photo_captured_at: Optional[datetime] = Form(default=None),
    image: Optional[UploadFile] = File(default=None),
    image_quality: str = Form(default="usable"),
    reporter_contact: Optional[str] = Form(default=None),
    analysis_token: Optional[str] = Form(default=None),
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
):
    check_intake_rate(request)
    image_bytes = await image.read() if image else None
    if image:
        await image.seek(0)
    analysis = _verified_analysis(analysis_token, image_bytes, description, category_hint)
    if analysis is None:
        analysis = await analyze_complaint(
            description, None, category_hint,
            image_bytes=image_bytes,
            image_mime_type=image.content_type if image else None,
        )
    if image_bytes and analysis.get("is_civic_issue") is False and analysis.get("confidence", 0) >= 0.75:
        raise HTTPException(status_code=422, detail="The uploaded image does not show a relevant civic issue")
    if image:
        await image.seek(0)
    image_url = await store_upload(image)
    payload = ComplaintCreate(
        description=description,
        location={
            "area": area,
            "latitude": latitude,
            "longitude": longitude,
            "source": location_source,
            "confirmed": location_confirmed,
            "accuracy_meters": location_accuracy_meters,
            "captured_at": photo_captured_at,
        },
        category_hint=category_hint,
        image_url=image_url,
        image_quality=image_quality,
        reporter_contact=reporter_contact,
        source_fingerprint=reporter_contact or "portal-upload",
    )
    return await _idempotent_create(payload, idempotency_key, analysis)


@router.patch("/{complaint_id}/status")
async def update_complaint_status(complaint_id: str, payload: ComplaintStatusUpdate, _admin: dict = Depends(require_admin)):
    complaint = await civic_repo.find_one("complaints", "complaint_id", complaint_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    try:
        changes = transition_changes(complaint, payload.status, payload.note or "", _admin)
    except InvalidTransition as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    sla_history = list(complaint.get("sla_history", []))
    if payload.status == "Resolved":
        due = complaint.get("sla_due_at")
        if isinstance(due, str):
            from datetime import datetime
            due = datetime.fromisoformat(due.replace("Z", "+00:00"))
        changes["sla_status"] = "Met" if due and now_utc() <= due else "Breached"
        changes["sla_remaining_label"] = "SLA completed"
        sla_history.append({"event": "SLA Completed", "at": now_utc(), "result": changes["sla_status"]})
    else:
        snapshot = sla_state(complaint.get("sla_started_at") or complaint.get("created_at") or now_utc(), complaint.get("sla_minutes", 1440))
        changes.update(snapshot)
        sla_history.append({"event": "SLA Recalculated", "at": now_utc(), "status": snapshot["sla_status"], "due_at": snapshot["sla_due_at"], "reason": f"Status changed to {payload.status}; original SLA start preserved."})
    changes["sla_history"] = sla_history
    updated = await civic_repo.update_one(
        "complaints",
        "complaint_id",
        complaint_id,
        changes,
    )
    await record_audit_event("complaint", complaint_id, "status_transition", _admin, {"status": complaint.get("status")}, {"status": payload.status}, payload.note)
    return updated


@router.post("/{complaint_id}/affected-too")
async def affected_too(complaint_id: str, payload: AffectedTooCreate, request: Request):
    complaint = await civic_repo.find_one("complaints", "complaint_id", complaint_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    client_hint = f"{request.client.host if request.client else 'unknown'}|{request.headers.get('user-agent', '')[:200]}"
    source_fingerprint = hmac.new(settings.reporter_token_secret.encode(), client_hint.encode(), hashlib.sha256).hexdigest()[:32]
    if not spam_limited_increment(complaint, source_fingerprint):
        return {"complaint": public_complaint(complaint), "message": "Signal recorded but not counted again due to spam protection."}
    affected_sources = complaint.get("affected_sources", [])
    affected_sources.append(source_fingerprint)
    affected_count = complaint.get("affected_count", 1) + 1
    score, breakdown = calculate_priority(
        complaint["severity"],
        complaint.get("duplicate_count", 1),
        affected_count=affected_count,
        safety_flag=complaint.get("safety_flag", False),
    )
    history = complaint.get("status_history", [])
    history.append({"status": "Citizen Signal Added", "note": payload.note or "Citizen marked I am affected too.", "at": now_utc()})
    updated = await civic_repo.update_one(
        "complaints",
        "complaint_id",
        complaint_id,
        {
            "affected_count": affected_count,
            "affected_sources": affected_sources,
            "priority_score": score,
            "priority_breakdown": breakdown,
            "status_history": history,
            "updated_at": now_utc(),
        },
    )
    return {"complaint": public_complaint(updated), "message": "Affected signal increased incident priority."}


@router.patch("/{complaint_id}/override")
async def officer_override(complaint_id: str, payload: OfficerOverride, _admin: dict = Depends(require_admin)):
    complaint = await civic_repo.find_one("complaints", "complaint_id", complaint_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    if not complaint.get("needs_review") and complaint.get("status") != "Needs Review":
        raise HTTPException(status_code=409, detail="This report is not awaiting human review")
    final_category = payload.final_category or complaint["category"]
    final_severity = payload.final_severity or complaint["severity"]
    final_department = payload.final_department or complaint["department"]
    score, breakdown = calculate_priority(
        final_severity,
        complaint.get("duplicate_count", 1),
        affected_count=complaint.get("affected_count", 1),
        safety_flag=complaint.get("safety_flag", False),
    )
    history = complaint.get("status_history", [])
    history.append({"status": "Officer Override", "note": payload.reason, "at": now_utc(), "officer_id": _admin["user_id"]})
    updated = await civic_repo.update_one(
        "complaints",
        "complaint_id",
        complaint_id,
        {
            "category": final_category,
            "severity": final_severity,
            "department": final_department,
            "priority_score": score,
            "priority_breakdown": breakdown,
            "needs_review": False,
            "status": "Submitted",
            "final_decision": {
                "category": final_category,
                "severity": final_severity,
                "department": final_department,
                "reason": payload.reason,
                "officer_id": _admin["user_id"],
                "at": now_utc(),
            },
            "status_history": history,
            "updated_at": now_utc(),
        },
    )
    await record_audit_event("complaint", complaint_id, "ai_override", _admin, {"category": complaint.get("category"), "severity": complaint.get("severity"), "department": complaint.get("department")}, {"category": final_category, "severity": final_severity, "department": final_department}, payload.reason)
    return updated


@router.post("/{complaint_id}/evidence")
async def attach_resolution_evidence(complaint_id: str, payload: ResolutionEvidenceCreate, _admin: dict = Depends(require_admin)):
    complaint = await civic_repo.find_one("complaints", "complaint_id", complaint_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    if complaint.get("status") not in {"In Progress", "Resolution Submitted"}:
        raise HTTPException(status_code=409, detail="Evidence can only be uploaded after work is in progress or resolution is submitted")
    history = list(complaint.get("status_history", []))
    if complaint.get("status") == "In Progress":
        history.append({"status": "Resolution Submitted", "note": "Field team submitted work for verification.", "at": now_utc(), "actor_id": _admin["user_id"], "actor_role": _admin["role"]})
    history.append({"status": "Evidence Uploaded", "note": payload.completion_note, "at": now_utc(), "uploaded_by": payload.uploaded_by, "actor_id": _admin["user_id"], "actor_role": _admin["role"]})
    approvals = complaint.get("resolution_approvals") or {"contractor": False, "government": False}
    approvals["contractor"] = True
    updated = await civic_repo.update_one(
        "complaints",
        "complaint_id",
        complaint_id,
        {
            "status": "Evidence Uploaded",
            "resolution_evidence": payload.model_dump() | {"uploaded_at": now_utc()},
            "resolution_approvals": approvals,
            "status_history": history,
            "resolution_submitted_at": complaint.get("resolution_submitted_at") or now_utc(),
            "updated_at": now_utc(),
        },
    )
    await record_audit_event("complaint", complaint_id, "resolution_evidence_uploaded", _admin, {"status": complaint.get("status")}, {"status": "Evidence Uploaded"}, payload.completion_note)
    return updated


@router.post("/{complaint_id}/citizen-verification")
async def citizen_verification(complaint_id: str, payload: CitizenVerificationCreate, _admin: dict = Depends(require_admin)):
    raise HTTPException(status_code=410, detail="Use the reporter's private verification link; administrators cannot impersonate citizen approval")


@router.post("/{complaint_id}/resolution-approval")
async def resolution_approval(complaint_id: str, payload: ResolutionApprovalCreate, _admin: dict = Depends(require_admin)):
    complaint = await civic_repo.find_one("complaints", "complaint_id", complaint_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    if payload.stakeholder == "reporter":
        raise HTTPException(status_code=403, detail="Reporter approval must come from the private reporter verification flow")
    if payload.approved and not complaint.get("resolution_evidence"):
        raise HTTPException(status_code=400, detail="Resolution evidence is required before approval")
    approvals = complaint.get("resolution_approvals") or {"contractor": False, "government": False}
    approvals[payload.stakeholder] = payload.approved
    all_approved = all(approvals.get(key) for key in ("contractor", "government"))
    history = complaint.get("status_history", [])
    history.append({
        "status": "Resolution Approved" if payload.approved else "Resolution Approval Withdrawn",
        "note": payload.note or f"{payload.stakeholder.title()} verification updated.",
        "stakeholder": payload.stakeholder,
        "at": now_utc(),
    })
    updated = await civic_repo.update_one("complaints", "complaint_id", complaint_id, {
        "resolution_approvals": approvals,
        "fully_verified": all_approved,
        "status": "Resolved" if all_approved and complaint.get("resolution_evidence") else complaint.get("status"),
        "resolved_at": now_utc() if all_approved and complaint.get("resolution_evidence") else complaint.get("resolved_at"),
        "status_history": history,
    })
    await record_audit_event("complaint", complaint_id, "resolution_approval_updated", _admin, {"approvals": complaint.get("resolution_approvals", {})}, {"approvals": approvals, "fully_verified": all_approved}, payload.note, source="human")
    return updated


@router.post("/{complaint_id}/authority-contractor-rating")
async def authority_contractor_rating(complaint_id: str, payload: ContractorRatingCreate, _admin: dict = Depends(require_admin)):
    complaint = await civic_repo.find_one("complaints", "complaint_id", complaint_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    return await _save_contractor_rating(complaint, "authority", payload.score)


@router.post("/{complaint_id}/reporter-contractor-rating")
async def reporter_contractor_rating(complaint_id: str, payload: ContractorRatingCreate):
    if not payload.token or not await verify_reporter_access(complaint_id, payload.token):
        raise HTTPException(status_code=403, detail="Only the original reporter can rate this work")
    complaint = await civic_repo.find_one("complaints", "complaint_id", complaint_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    return await _save_contractor_rating(complaint, "public", payload.score)


@router.post("/{complaint_id}/reporter-verification")
async def reporter_verification(complaint_id: str, payload: ReporterVerificationCreate):
    """Allow the actual reporter to verify or dispute completion via a private token."""
    owner = await verify_reporter_access(complaint_id, payload.token)
    if not owner:
        raise HTTPException(status_code=403, detail="Reporter verification link is invalid or expired")
    complaint = await civic_repo.find_one("complaints", "complaint_id", complaint_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    if not complaint.get("resolution_evidence"):
        raise HTTPException(status_code=409, detail="Completion evidence must be submitted before reporter verification")

    timestamp = now_utc()
    approvals = dict(complaint.get("resolution_approvals") or {"contractor": False, "government": False})
    positive = payload.outcome == "fixed"
    approvals["reporter"] = positive
    all_approved = all(approvals.get(key) for key in ("contractor", "government"))
    if payload.outcome in {"partially_fixed", "not_fixed"}:
        status = "Reopened - Needs Review"
        needs_review = True
    elif all_approved:
        status = "Resolved"
        needs_review = False
    else:
        status = "Verification"
        needs_review = complaint.get("needs_review", False)
    history = list(complaint.get("status_history", []))
    history.append({
        "status": "Reporter Verification",
        "note": payload.note or payload.outcome.replace("_", " ").title(),
        "outcome": payload.outcome,
        "at": timestamp,
        "decision_source": "reporter-token",
    })
    changes = {
        "status": status,
        "needs_review": needs_review,
        "resolution_approvals": approvals,
        "fully_verified": all_approved,
        "citizen_verification": {"outcome": payload.outcome, "fixed": positive, "note": payload.note, "verified_at": timestamp},
        "status_history": history,
        "updated_at": timestamp,
    }
    if all_approved:
        changes["resolved_at"] = timestamp
    if status == "Reopened - Needs Review":
        changes["reopened_at"] = timestamp
    updated = await civic_repo.update_one("complaints", "complaint_id", complaint_id, changes)
    await civic_repo.update_one("report_owners", "owner_id", owner["owner_id"], {
        "verification_count": owner.get("verification_count", 0) + 1,
        "last_verified_at": timestamp,
    })
    await record_audit_event(
        "complaint", complaint_id, "reporter_verification",
        {"user_id": owner["owner_id"], "role": "reporter"},
        {"status": complaint.get("status")},
        {"status": status, "outcome": payload.outcome}, payload.note, source="reporter-token",
    )
    return public_complaint(updated)
