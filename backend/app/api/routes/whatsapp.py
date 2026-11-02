import hashlib
import hmac
import json
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.api.routes.complaints import create_complaint
from app.core.config import settings
from app.db.repository import civic_repo
from app.schemas.complaint import ComplaintCreate, Location

router = APIRouter(prefix="/api/whatsapp", tags=["whatsapp"])


class WhatsAppDemoMessage(BaseModel):
    provider_message_id: Optional[str] = Field(default=None, max_length=160)
    message: str = Field(..., min_length=3)
    area: str = Field(..., min_length=2)
    phone: Optional[str] = Field(default=None, max_length=40)
    image_url: Optional[str] = Field(default=None, max_length=2000)


@router.post("/webhook/demo")
async def whatsapp_demo_webhook(payload: WhatsAppDemoMessage):
    if settings.environment == "production":
        raise HTTPException(status_code=404, detail="Demo webhook is disabled")
    complaint = ComplaintCreate(
        description=payload.message,
        location=Location(area=payload.area),
        image_url=payload.image_url,
        reporter_contact=payload.phone,
        source_fingerprint=f"whatsapp-{payload.phone}" if payload.phone else "whatsapp-demo",
    )
    created = await create_complaint(complaint)
    created = await civic_repo.update_one("complaints", "complaint_id", created["complaint_id"], {"channel": "WhatsApp"})
    return {
        "message": "WhatsApp report processed through UrbanFix pipeline.",
        "tracking_id": created["complaint_id"],
        "complaint": created,
    }


@router.get("/webhook")
async def verify_webhook(
    mode: str = Query(alias="hub.mode"),
    token: str = Query(alias="hub.verify_token"),
    challenge: str = Query(alias="hub.challenge"),
):
    if mode != "subscribe" or not settings.whatsapp_verify_token or not hmac.compare_digest(token, settings.whatsapp_verify_token):
        raise HTTPException(status_code=403, detail="Webhook verification failed")
    return int(challenge) if challenge.isdigit() else challenge


@router.post("/webhook")
async def production_webhook(request: Request, signature: Optional[str] = Header(default=None, alias="X-Hub-Signature-256")):
    raw = await request.body()
    if len(raw) > 1_000_000:
        raise HTTPException(status_code=413, detail="Webhook payload is too large")
    if not settings.whatsapp_webhook_secret:
        raise HTTPException(status_code=503, detail="WhatsApp webhook secret is not configured")
    expected = "sha256=" + hmac.new(settings.whatsapp_webhook_secret.encode(), raw, hashlib.sha256).hexdigest()
    if not signature or not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")
    try:
        payload = WhatsAppDemoMessage.model_validate(json.loads(raw))
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Unsupported WhatsApp webhook payload") from exc
    if not payload.provider_message_id:
        raise HTTPException(status_code=422, detail="provider_message_id is required")
    processed = await civic_repo.find_one("webhook_events", "provider_event_id", payload.provider_message_id)
    if processed:
        return {"message": "Webhook already processed", "tracking_id": processed["complaint_id"], "duplicate": True}
    complaint = ComplaintCreate(
        description=payload.message,
        location=Location(area=payload.area),
        image_url=payload.image_url,
        reporter_contact=payload.phone,
        source_fingerprint=f"whatsapp-{hashlib.sha256((payload.phone or payload.provider_message_id).encode()).hexdigest()[:20]}",
    )
    created = await create_complaint(complaint, request=None, idempotency_key=f"whatsapp:{payload.provider_message_id}")
    created = await civic_repo.update_one("complaints", "complaint_id", created["complaint_id"], {"channel": "WhatsApp"})
    await civic_repo.insert_one("webhook_events", {"provider_event_id": payload.provider_message_id, "complaint_id": created["complaint_id"], "created_at": created.get("created_at")})
    return {"message": "Complaint received successfully", "tracking_id": created["complaint_id"], "duplicate": False}
