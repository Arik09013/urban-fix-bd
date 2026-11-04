from __future__ import annotations

import asyncio
from io import BytesIO
import logging
from uuid import uuid4

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import settings, upload_directory

logger = logging.getLogger(__name__)
IMAGE_SIGNATURES = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/gif": (b"GIF87a", b"GIF89a"),
    "image/webp": (b"RIFF",),
}
SAFE_SUFFIX = {"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp"}


def sign_evidence_access(complaint_id: str, filename: str, expires_at: int) -> str:
    import hashlib
    import hmac

    secret = (settings.evidence_signing_secret or "").strip()
    if not secret:
        raise ValueError("EVIDENCE_SIGNING_SECRET is not configured. Set EVIDENCE_SIGNING_SECRET in environment or .env.")
    message = f"{complaint_id}:{filename}:{expires_at}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def verify_evidence_signature(complaint_id: str, filename: str, sig: str, exp: int) -> bool:
    import hmac
    import time

    secret = (settings.evidence_signing_secret or "").strip()
    if not secret or not sig or not exp or not complaint_id or not filename:
        return False
    try:
        exp_int = int(exp)
        if int(time.time()) > exp_int:
            return False
        expected = sign_evidence_access(complaint_id, filename, exp_int)
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(expected, sig)


def create_signed_evidence_url(complaint_id: str, filename: str, ttl_seconds: int = 3600) -> str:
    import time

    expires_at = int(time.time()) + ttl_seconds
    sig = sign_evidence_access(complaint_id, filename, expires_at)
    return f"/uploads/{filename}?cid={complaint_id}&exp={expires_at}&sig={sig}"


def is_safe_evidence_url(url: str) -> bool:
    from urllib.parse import urlparse
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return False
    host = (parsed.hostname or "").lower()
    return (
        host == "res.cloudinary.com"
        or host.endswith(".cloudinary.com")
        or host.endswith(".onrender.com")
        or host in ("localhost", "127.0.0.1")
    )


async def store_upload(file: UploadFile | None) -> str | None:
    if file is None:
        return None

    if file.content_type not in {"image/jpeg", "image/png", "image/webp", "image/gif"}:
        raise HTTPException(status_code=415, detail="Only JPEG, PNG, WebP, and GIF images are supported")
    content = await file.read()
    upload_limit_mb = min(settings.max_upload_mb, 4) if settings.environment == "production" else settings.max_upload_mb
    if len(content) > upload_limit_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"Image exceeds the {upload_limit_mb} MB upload limit")
    output_content_type = file.content_type
    signatures = IMAGE_SIGNATURES[file.content_type]
    valid_signature = any(content.startswith(signature) for signature in signatures)
    if file.content_type == "image/webp":
        valid_signature = valid_signature and len(content) >= 12 and content[8:12] == b"WEBP"
    if not valid_signature:
        raise HTTPException(status_code=415, detail="File content does not match its declared image type")

    # Fully decode and re-encode every upload. This rejects corrupt/polyglot
    # files, removes EXIF/GPS metadata, normalizes orientation, and prevents
    # browser delivery of attacker-controlled trailing bytes.
    try:
        Image.MAX_IMAGE_PIXELS = settings.max_image_megapixels * 1_000_000
        with Image.open(BytesIO(content)) as source:
            source.verify()
        with Image.open(BytesIO(content)) as source:
            if source.width * source.height > settings.max_image_megapixels * 1_000_000:
                raise HTTPException(status_code=413, detail="Image dimensions are too large")
            image = ImageOps.exif_transpose(source)
            output = BytesIO()
            if file.content_type == "image/png":
                image.save(output, format="PNG", optimize=True)
            elif file.content_type == "image/webp":
                image.convert("RGB").save(output, format="WEBP", quality=88, method=6)
            else:
                # Animated GIF evidence is intentionally flattened to a safe
                # still JPEG; evidence workflows only require one clear frame.
                image.convert("RGB").save(output, format="JPEG", quality=90, optimize=True)
                output_content_type = "image/jpeg"
            content = output.getvalue()
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise HTTPException(status_code=415, detail="Image is corrupt or unsafe to process") from exc

    cloudinary_parts = all((settings.cloudinary_cloud_name, settings.cloudinary_api_key, settings.cloudinary_api_secret))
    if settings.cloudinary_url or cloudinary_parts:
        import cloudinary
        import cloudinary.uploader

        if cloudinary_parts:
            cloudinary.config(
                cloud_name=settings.cloudinary_cloud_name,
                api_key=settings.cloudinary_api_key,
                api_secret=settings.cloudinary_api_secret,
                secure=True,
            )
        try:
            result = await asyncio.wait_for(asyncio.to_thread(
                cloudinary.uploader.upload,
                content,
                folder="urbanfix/evidence",
                resource_type="image",
                use_filename=False,
                unique_filename=True,
                overwrite=False,
            ), timeout=30)
            return result["secure_url"]
        except Exception as exc:
            logger.exception("Cloudinary upload failed: %s", type(exc).__name__)
            if settings.environment == "production":
                raise HTTPException(status_code=502, detail="Evidence storage is temporarily unavailable") from exc

    if settings.environment == "production":
        raise HTTPException(status_code=503, detail="Evidence storage is not configured")

    upload_root = upload_directory()
    upload_root.mkdir(parents=True, exist_ok=True)
    suffix = SAFE_SUFFIX[output_content_type]
    file_name = f"{uuid4().hex}{suffix}"
    destination = upload_root / file_name
    destination.write_bytes(content)
    return f"/uploads/{file_name}"
