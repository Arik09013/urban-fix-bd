from contextlib import asynccontextmanager
import json
import logging
import time
from uuid import uuid4
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, RedirectResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import analytics, auth, authorities, complaints, contractors, dashboard, discussions, geocoding, health, offers, operations, repair_requests, seo, tracking, whatsapp
from app.core.config import project_root, settings, upload_directory
from app.core.security import optional_user
from app.db.repository import civic_repo
from app.services.storage.cloudinary import is_safe_evidence_url, verify_evidence_signature
from app.services.reporter_access import verify_reporter_access

PROJECT_ROOT = project_root()
STATIC_ASSET_DIR = PROJECT_ROOT / "public" / "assets"
BUILT_FRONTEND_DIR = PROJECT_ROOT / "dist"
BUILT_ASSET_DIR = BUILT_FRONTEND_DIR / "build"
UPLOAD_DIR = upload_directory()
LOCAL_UPLOADS_ENABLED = settings.environment != "production"
if LOCAL_UPLOADS_ENABLED:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
logger = logging.getLogger("urbanfix.http")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await civic_repo.connect()
    if settings.seed_demo_data:
        await civic_repo.ensure_demo_data()
    yield
    await civic_repo.close()


app = FastAPI(
    title="UrbanFix AI API",
    description="AI-powered civic governance and decision-support backend.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin for origin in settings.cors_origins if settings.environment != "production" or origin != "null"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-CSRF-Token", "Idempotency-Key", "X-Hub-Signature-256", "X-Request-ID"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or uuid4().hex
    started = time.perf_counter()
    request.state.request_id = request_id
    try:
        response = await call_next(request)
    except Exception:
        logger.exception(json.dumps({"event": "request_failed", "request_id": request_id, "method": request.method, "path": request.url.path}))
        raise
    duration_ms = round((time.perf_counter() - started) * 1000, 2)
    response.headers["X-Request-ID"] = request_id
    response.headers["Server-Timing"] = f"app;dur={duration_ms}"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(self), geolocation=(self), microphone=()"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    if settings.environment == "production":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    if request.url.path.startswith("/api/auth"):
        response.headers["Cache-Control"] = "no-store"
    logger.info(json.dumps({"event": "request_complete", "request_id": request_id, "method": request.method, "path": request.url.path, "status": response.status_code, "duration_ms": duration_ms}))
    return response

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(complaints.router)
app.include_router(dashboard.router)
app.include_router(authorities.router)
app.include_router(contractors.router)
app.include_router(offers.router)
app.include_router(repair_requests.router)
app.include_router(operations.router)
app.include_router(geocoding.router)
app.include_router(tracking.router)
app.include_router(analytics.router)
app.include_router(discussions.router)
app.include_router(whatsapp.router)
app.include_router(seo.router)
@app.api_route("/uploads/{filename}", methods=["GET", "HEAD"], include_in_schema=False)
async def get_secure_upload(filename: str, request: Request):
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    clean_name = filename.split("?")[0].strip()
    file_path = (UPLOAD_DIR / clean_name).resolve()
    local_exists = file_path.is_relative_to(UPLOAD_DIR.resolve()) and file_path.is_file()

    complaint = await civic_repo.find_complaint_by_evidence_filename(clean_name)
    target_external_url = None
    if complaint:
        candidate_urls = [
            complaint.get("image_url"),
            complaint.get("after_image_url"),
            (complaint.get("resolution_evidence") or {}).get("url"),
            (complaint.get("resolution_evidence") or {}).get("after_image_url"),
        ]
        for cand in candidate_urls:
            if cand and clean_name in cand and (cand.startswith("http://") or cand.startswith("https://")):
                if is_safe_evidence_url(cand):
                    target_external_url = cand
                    break

    if not local_exists and not target_external_url:
        raise HTTPException(status_code=404, detail="File not found")

    def deliver_response(cache_header: dict):
        if target_external_url:
            return RedirectResponse(url=target_external_url, status_code=307, headers=cache_header)
        return FileResponse(file_path, headers=cache_header)

    # If not associated with any complaint or if it's a demo complaint, allow public viewing
    if not complaint or complaint.get("data_label") == "Demo":
        return deliver_response({"Cache-Control": "public, max-age=3600"})

    # Restricted complaint: require valid auth (admin, matching officer, signed URL, or reporter token)
    user = await optional_user(request)
    if user:
        if user.get("role") == "admin":
            return deliver_response({"Cache-Control": "private, no-store"})
        if user.get("role") == "officer":
            assigned_auth = (complaint.get("assigned_authority") or {}).get("authority_id")
            if user.get("authority_id") == assigned_auth:
                return deliver_response({"Cache-Control": "private, no-store"})
            raise HTTPException(status_code=403, detail="Officers cannot access evidence for other authorities")

    # Check HMAC signature
    sig = request.query_params.get("sig")
    exp = request.query_params.get("exp")
    cid = request.query_params.get("cid") or complaint.get("complaint_id")
    if sig and exp:
        try:
            if verify_evidence_signature(cid, clean_name, sig, int(exp)):
                return deliver_response({"Cache-Control": "private, no-store"})
        except (ValueError, TypeError):
            pass

    # Check reporter token
    token = request.query_params.get("token") or request.headers.get("x-reporter-token")
    if token:
        owner = await verify_reporter_access(complaint["complaint_id"], token)
        if owner:
            return deliver_response({"Cache-Control": "private, no-store"})

    raise HTTPException(status_code=403, detail="Unauthorized access to restricted evidence")


if STATIC_ASSET_DIR.exists():
    app.mount(
        "/assets",
        StaticFiles(directory=STATIC_ASSET_DIR),
        name="assets"
    )
if BUILT_ASSET_DIR.exists():
    app.mount("/build", StaticFiles(directory=BUILT_ASSET_DIR), name="frontend-build")


@app.get("/api", include_in_schema=False)
async def api_root():
    return {"service": settings.app_name, "status": "ok", "health": "/api/health", "docs": "/docs"}


@app.get("/", include_in_schema=False)
async def frontend(request: Request):
    base = settings.public_base_url.rstrip("/") or str(request.base_url).rstrip("/")
    frontend_file = BUILT_FRONTEND_DIR / "index.html" if (BUILT_FRONTEND_DIR / "index.html").exists() else PROJECT_ROOT / "index.html"
    html = frontend_file.read_text(encoding="utf-8").replace("__PUBLIC_BASE_URL__", base)
    return HTMLResponse(html)


@app.get("/robots.txt", include_in_schema=False)
async def robots(request: Request):
    base = str(request.base_url).rstrip("/")
    return PlainTextResponse(f"User-agent: *\nAllow: /\nSitemap: {base}/sitemap.xml\n")


@app.get("/google071715fa18feee5a.html", include_in_schema=False)
async def google_site_verification():
    return PlainTextResponse("google-site-verification: google071715fa18feee5a.html")


@app.get("/sitemap.xml", include_in_schema=False)
async def sitemap(request: Request):
    base = str(request.base_url).rstrip("/")
    paths = ["/", *seo.SEO_PATHS]
    entries = "".join(
        f"<url><loc>{base}{path}</loc><changefreq>{'daily' if path == '/' else 'weekly'}</changefreq><priority>{'1.0' if path == '/' else '0.8'}</priority></url>"
        for path in paths
    )
    xml = f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{entries}</urlset>'
    return Response(xml, media_type="application/xml")
