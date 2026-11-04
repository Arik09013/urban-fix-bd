from fastapi import APIRouter

from app.core.config import settings
from app.db.repository import civic_repo
from app.services.storage.cloudinary import cloudinary_configured, get_last_storage_error

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
async def health_check():
    database_mode = "memory-demo" if civic_repo.use_memory else "mongodb"
    storage_usage = await civic_repo.storage_status()
    has_cloudinary = cloudinary_configured()
    last_err = get_last_storage_error()

    if last_err:
        storage_mode = "cloudinary-error-fallback"
    elif has_cloudinary:
        storage_mode = "cloudinary-configured"
    else:
        storage_mode = "local-upload-fallback"

    response = {
        "status": "degraded" if (civic_repo.use_memory or last_err) else "ok",
        "database": database_mode,
        "database_error": "connection-failed" if civic_repo.connection_error else None,
        "ai": "key-configured" if settings.gemini_api_key else "fallback-pending-key",
        "ai_model": settings.gemini_model,
        "messaging": "future-module-disabled",
        "storage": storage_mode,
        "service": "UrbanFix AI",
        "database_storage": storage_usage,
    }
    if last_err:
        response["storage_error"] = last_err
    return response


@router.get("/ready")
async def readiness_check():
    if civic_repo.use_memory and not settings.allow_memory_fallback:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail="Database is not ready")
    return {"ready": True, "database": "memory-fallback" if civic_repo.use_memory else "mongodb"}


@router.get("/system-health")
async def system_health():
    has_cloudinary = cloudinary_configured()
    last_err = get_last_storage_error()

    if last_err:
        storage_info = {"status": "degraded", "mode": "Cloudinary-error-fallback", "error": last_err}
    elif has_cloudinary:
        storage_info = {"status": "ok", "mode": "Cloudinary"}
    else:
        storage_info = {"status": "degraded", "mode": "local"}

    services = [
        {"name": "AI", "status": "ok" if settings.gemini_api_key else "pending", "mode": "Gemini" if settings.gemini_api_key else "fallback"},
        {"name": "Database", "status": "degraded" if civic_repo.use_memory else "ok", "mode": "memory-demo" if civic_repo.use_memory else "mongodb"},
        {"name": "Storage", "status": storage_info["status"], "mode": storage_info["mode"]},
        {"name": "Messaging", "status": "disabled", "mode": "future module"},
        {"name": "Privacy", "status": "ok", "mode": "public map hides reporter identity"},
    ]
    return {
        "database": {"status": "degraded" if civic_repo.use_memory else "ok", "mode": "memory-demo" if civic_repo.use_memory else "mongodb"},
        "ai": {"status": "ok" if settings.gemini_api_key else "pending", "mode": "Gemini" if settings.gemini_api_key else "fallback"},
        "storage": storage_info,
        "messaging": {"status": "disabled", "mode": "future module"},
        "privacy": {"status": "ok", "public_reporter_visible": False},
        "services": services,
    }
