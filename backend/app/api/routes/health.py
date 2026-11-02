from fastapi import APIRouter

from app.core.config import settings
from app.db.repository import civic_repo

router = APIRouter(prefix="/api", tags=["health"])


def cloudinary_configured() -> bool:
    separate_credentials = all((
        settings.cloudinary_cloud_name,
        settings.cloudinary_api_key,
        settings.cloudinary_api_secret,
    ))
    return bool(settings.cloudinary_url or separate_credentials)


@router.get("/health")
async def health_check():
    database_mode = "memory-demo" if civic_repo.use_memory else "mongodb"
    storage_usage = await civic_repo.storage_status()
    has_cloudinary = cloudinary_configured()
    return {
        "status": "degraded" if civic_repo.use_memory else "ok",
        "database": database_mode,
        "database_error": "connection-failed" if civic_repo.connection_error else None,
        "ai": "configured" if settings.gemini_api_key else "fallback-pending-key",
        "messaging": "future-module-disabled",
        "storage": "cloudinary-configured" if has_cloudinary else "local-upload-fallback",
        "service": "UrbanFix AI",
        "database_storage": storage_usage,
    }


@router.get("/ready")
async def readiness_check():
    if civic_repo.use_memory and not settings.allow_memory_fallback:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail="Database is not ready")
    return {"ready": True, "database": "memory-fallback" if civic_repo.use_memory else "mongodb"}


@router.get("/system-health")
async def system_health():
    has_cloudinary = cloudinary_configured()
    services = [
        {"name": "AI", "status": "ok" if settings.gemini_api_key else "pending", "mode": "Gemini" if settings.gemini_api_key else "fallback"},
        {"name": "Database", "status": "degraded" if civic_repo.use_memory else "ok", "mode": "memory-demo" if civic_repo.use_memory else "mongodb"},
        {"name": "Storage", "status": "ok" if has_cloudinary else "degraded", "mode": "Cloudinary" if has_cloudinary else "local"},
        {"name": "Messaging", "status": "disabled", "mode": "future module"},
        {"name": "Privacy", "status": "ok", "mode": "public map hides reporter identity"},
    ]
    return {
        "database": {"status": "degraded" if civic_repo.use_memory else "ok", "mode": "memory-demo" if civic_repo.use_memory else "mongodb"},
        "ai": {"status": "ok" if settings.gemini_api_key else "pending", "mode": "Gemini" if settings.gemini_api_key else "fallback"},
        "storage": {"status": "ok" if has_cloudinary else "degraded", "mode": "Cloudinary" if has_cloudinary else "local"},
        "messaging": {"status": "disabled", "mode": "future module"},
        "privacy": {"status": "ok", "public_reporter_visible": False},
        "services": services,
    }
