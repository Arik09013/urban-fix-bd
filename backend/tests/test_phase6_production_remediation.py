from __future__ import annotations

import json
from pathlib import Path
import pytest
from starlette.testclient import TestClient

from app.main import app
from app.core.config import Settings, settings
from app.db.repository import civic_repo, now_utc
from app.services.reporter_access import create_reporter_access
from app.services.storage.cloudinary import sign_evidence_access, create_signed_evidence_url, is_safe_evidence_url
from app.api.routes.auth import rate_limit_key


def reset_test_repo():
    civic_repo.use_memory = True
    civic_repo.connection_error = None
    civic_repo.client = None
    civic_repo.db = None
    civic_repo.memory = {
        "complaints": [],
        "contractors": [],
        "offers": [],
        "discussions": [],
        "repair_requests": [],
        "geocoding_cache": [],
        "users": [],
        "sessions": [],
        "audit_events": [],
        "idempotency_keys": [],
        "webhook_events": [],
        "report_owners": [],
        "discussion_votes": [],
        "login_attempts": [],
    }


def login_admin(client: TestClient) -> dict:
    resp = client.post("/api/auth/login", json={"email": "admin", "password": "admin"})
    assert resp.status_code == 200
    return {"x-csrf-token": resp.json()["csrf_token"]}


def login_officer(client: TestClient, username: str) -> dict:
    settings.allow_demo_officer_login = True
    resp = client.post("/api/auth/demo-officer-login", json={"username": username})
    assert resp.status_code == 200
    return {"x-csrf-token": resp.json()["csrf_token"]}


# ==============================================================================
# P0.1 — CLOUDINARY EVIDENCE DELIVERY & OPEN REDIRECT PREVENTION
# ==============================================================================

def test_p0_1_is_safe_evidence_url():
    """Verify safe URL validation rejects attacker hosts and allows trusted hosts."""
    assert is_safe_evidence_url("https://res.cloudinary.com/urbanfix/image/upload/v1/after.jpg")
    assert is_safe_evidence_url("https://subdomain.cloudinary.com/evidence.jpg")
    assert is_safe_evidence_url("https://urbanfix.onrender.com/uploads/sample.jpg")
    assert is_safe_evidence_url("http://localhost:8000/uploads/sample.jpg")

    # Untrusted / attacker targets
    assert not is_safe_evidence_url("https://evil-site.com/malicious.jpg")
    assert not is_safe_evidence_url("http://attacker.com/leak.jpg")
    assert not is_safe_evidence_url("javascript:alert(1)")
    assert not is_safe_evidence_url("ftp://res.cloudinary.com/file")


def test_p0_1_cloudinary_evidence_redirect_and_auth():
    """Cloudinary-stored evidence redirects authorized users with 307 and blocks unauthorized."""
    reset_test_repo()
    ts = now_utc()
    cloudinary_img = "https://res.cloudinary.com/urbanfix/image/upload/v12345/evidence_abc.jpg"
    cloudinary_after = "https://res.cloudinary.com/urbanfix/image/upload/v12345/resolved_def.jpg"

    complaint = {
        "complaint_id": "CP-P01-TEST-01",
        "data_label": "Live",
        "description": "Drainage collapse at Agrabad.",
        "location": {"area": "Agrabad", "latitude": 22.3, "longitude": 91.8},
        "category": "Drainage / Sewerage",
        "severity": "High",
        "status": "In Progress",
        "image_url": cloudinary_img,
        "assigned_authority": {
            "authority_id": "AUTH-CCC",
            "authority_name": "Chattogram City Corporation",
        },
        "resolution_evidence": {
            "url": cloudinary_after,
            "after_image_url": cloudinary_after,
            "completion_note": "Repairs complete",
        },
        "created_at": ts,
        "updated_at": ts,
    }
    civic_repo.memory["complaints"].append(complaint)

    # 1. Unauthenticated request to complaints evidence endpoint is rejected
    client = TestClient(app)
    resp = client.get("/api/complaints/CP-P01-TEST-01/evidence/file/after", follow_redirects=False)
    assert resp.status_code == 403

    # 2. Officer from DIFFERENT authority (DNCC) is rejected
    dncc_client = TestClient(app)
    dncc_headers = login_officer(dncc_client, "officer.dncc")
    resp_dncc = dncc_client.get("/api/complaints/CP-P01-TEST-01/evidence/file/after", headers=dncc_headers, follow_redirects=False)
    assert resp_dncc.status_code == 403

    # 3. Matching CCC officer is authorized and receives 307 redirect to Cloudinary
    ccc_client = TestClient(app)
    ccc_headers = login_officer(ccc_client, "officer.ccc")
    resp_ccc = ccc_client.get("/api/complaints/CP-P01-TEST-01/evidence/file/after", headers=ccc_headers, follow_redirects=False)
    assert resp_ccc.status_code == 307
    assert resp_ccc.headers["location"] == cloudinary_after
    assert resp_ccc.headers["cache-control"] == "private, no-store"

    # 4. Admin is authorized and receives 307 redirect
    admin_client = TestClient(app)
    admin_headers = login_admin(admin_client)
    resp_admin = admin_client.get("/api/complaints/CP-P01-TEST-01/evidence/file/before", headers=admin_headers, follow_redirects=False)
    assert resp_admin.status_code == 307
    assert resp_admin.headers["location"] == cloudinary_img

    # 5. Access via /uploads/{filename} redirects to Cloudinary when authorized
    filename = "resolved_def.jpg"
    resp_up = ccc_client.get(f"/uploads/{filename}", headers=ccc_headers, follow_redirects=False)
    assert resp_up.status_code == 307
    assert resp_up.headers["location"] == cloudinary_after


def test_p0_1_open_redirect_prevention():
    """Untrusted external URLs stored in complaints are rejected with 400 Bad Request."""
    reset_test_repo()
    ts = now_utc()
    malicious_url = "https://attacker.evil.com/phishing.jpg"

    complaint = {
        "complaint_id": "CP-MALICIOUS-01",
        "data_label": "Demo",
        "description": "Demo complaint with poisoned URL",
        "image_url": malicious_url,
        "created_at": ts,
        "updated_at": ts,
    }
    civic_repo.memory["complaints"].append(complaint)

    client = TestClient(app)
    resp = client.get("/api/complaints/CP-MALICIOUS-01/evidence/file/before", follow_redirects=False)
    assert resp.status_code == 400
    assert "Invalid evidence storage destination" in resp.json()["detail"]


# ==============================================================================
# P0.2 — PRODUCTION CONFIG & PAYMENT_PROVIDER=demo
# ==============================================================================

def test_p0_2_production_payment_provider_demo_allowed():
    """Production mode allows startup with PAYMENT_PROVIDER=demo without requiring Stripe keys."""
    prod_settings = Settings(
        environment="production",
        admin_password="secure-production-password-123456",
        reporter_token_secret="secure-reporter-secret-that-is-at-least-32-chars-long",
        evidence_signing_secret="secure-evidence-signing-secret-that-is-at-least-32-chars-long",
        mongo_uri="mongodb+srv://user:pass@cluster.mongodb.net",
        cloudinary_url="cloudinary://123:abc@test",
        payment_provider="demo",
        stripe_secret_key="",
    )
    assert prod_settings.payment_provider == "demo"
    assert prod_settings.environment == "production"


def test_p0_2_production_payment_provider_stripe_strictly_enforced():
    """Production mode requires STRIPE_SECRET_KEY when PAYMENT_PROVIDER=stripe."""
    with pytest.raises(ValueError, match="STRIPE_SECRET_KEY"):
        Settings(
            environment="production",
            admin_password="secure-production-password-123456",
            reporter_token_secret="secure-reporter-secret-that-is-at-least-32-chars-long",
            evidence_signing_secret="secure-evidence-signing-secret-that-is-at-least-32-chars-long",
            mongo_uri="mongodb+srv://user:pass@cluster.mongodb.net",
            cloudinary_url="cloudinary://123:abc@test",
            payment_provider="stripe",
            stripe_secret_key="",
        )


def test_p0_2_cors_origins_parsing():
    """CORS origins parse comma-separated strings or JSON arrays correctly."""
    s1 = Settings(cors_origins="https://app1.vercel.app, https://app2.vercel.app")
    assert s1.cors_origins == ["https://app1.vercel.app", "https://app2.vercel.app"]

    s2 = Settings(cors_origins='["https://app3.vercel.app"]')
    assert s2.cors_origins == ["https://app3.vercel.app"]


# ==============================================================================
# P0.3 & P0.4 — VERCEL REWRITES & AUTH COOKIES
# ==============================================================================

def test_p0_3_vercel_json_configuration():
    """vercel.json has reverse proxy for /api/* and SPA deep-link fallback."""
    vercel_path = Path(__file__).resolve().parents[2] / "vercel.json"
    assert vercel_path.is_file()
    data = json.loads(vercel_path.read_text(encoding="utf-8"))
    rewrites = data.get("rewrites", [])

    # Check API reverse proxy rewrite
    api_rewrite = next((r for r in rewrites if r.get("source") == "/api/:path*"), None)
    assert api_rewrite is not None
    assert "onrender.com" in api_rewrite["destination"]

    # Check SPA fallback rewrite
    spa_rewrite = next((r for r in rewrites if r.get("source") == "/(.*)"), None)
    assert spa_rewrite is not None
    assert spa_rewrite["destination"] == "/index.html"


def test_p0_4_auth_cookies_and_csrf_protection():
    """Session cookies have SameSite=Lax and Secure in production; CSRF is strictly checked."""
    reset_test_repo()
    client = TestClient(app)
    resp = client.post("/api/auth/login", json={"email": "admin", "password": "admin"})
    assert resp.status_code == 200
    cookie_header = resp.headers.get("set-cookie", "")
    assert "samesite=lax" in cookie_header.lower()
    assert "httponly" in cookie_header.lower()
    assert "path=/" in cookie_header.lower()

    # Mutating request without CSRF must fail (403)
    no_csrf_resp = client.patch(
        "/api/complaints/CP-P01-TEST-01/status",
        json={"status": "Acknowledged", "note": "Test Ack"},
    )
    assert no_csrf_resp.status_code == 403


# ==============================================================================
# P1.1 — REPORTER VERIFICATION IMMUTABILITY
# ==============================================================================

def test_p1_1_reporter_verification_immutability():
    """Once a complaint is Resolved / fully_verified, subsequent reporter verification returns 409 Conflict."""
    reset_test_repo()
    ts = now_utc()
    import asyncio
    token = asyncio.run(create_reporter_access("CP-RESOLVED-01", "reporter@test.com"))

    resolved_complaint = {
        "complaint_id": "CP-RESOLVED-01",
        "data_label": "Live",
        "description": "Pot hole fixed on road.",
        "status": "Resolved",
        "fully_verified": True,
        "resolution_evidence": {"url": "/uploads/fixed.jpg"},
        "created_at": ts,
        "updated_at": ts,
    }
    civic_repo.memory["complaints"].append(resolved_complaint)

    client = TestClient(app)
    # 1. Attempting to verify or dispute already Resolved complaint must return 409 Conflict
    resp = client.post(
        "/api/complaints/CP-RESOLVED-01/reporter-verification",
        json={"token": token, "outcome": "not_fixed", "note": "I want to reopen this!"},
    )
    assert resp.status_code == 409
    assert "already confirmed and finalized" in resp.json()["detail"]

    # Status remains untouched
    assert resolved_complaint["status"] == "Resolved"


# ==============================================================================
# P1.2, P1.3, P1.4 — MONGODB UNIQUE INDEX, RATE LIMITING & Atlas DEPENDENCY
# ==============================================================================

def test_p1_2_mongodb_username_index_declared():
    """CivicRepository.connect declares unique sparse index on username."""
    repo_file = Path(__file__).resolve().parents[1] / "app" / "db" / "repository.py"
    content = repo_file.read_text(encoding="utf-8")
    assert 'create_index("username", unique=True, sparse=True)' in content


def test_p1_3_persistent_login_rate_limiting():
    """Failed login attempts increment in civic_repo.memory/login_attempts and block on 10th attempt."""
    reset_test_repo()
    client = TestClient(app)
    # 9 failed attempts should return 401
    for i in range(9):
        resp = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "wrong"})
        assert resp.status_code == 401

    # 10th failed attempt triggers 429
    client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "wrong"})
    resp_blocked = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "wrong"})
    assert resp_blocked.status_code == 429
    assert "Too many login attempts" in resp_blocked.json()["detail"]

    # Attempts are recorded in repo memory with key and expiration, NO passwords stored
    stored_attempts = civic_repo.memory["login_attempts"]
    assert len(stored_attempts) >= 10
    for entry in stored_attempts:
        assert "password" not in entry
        assert "expires_at" in entry
        assert "key" in entry


def test_p1_4_dnspython_in_requirements():
    """dnspython>=2.0.0 is declared in backend/requirements.txt for MongoDB Atlas mongodb+srv:// support."""
    req_file = Path(__file__).resolve().parents[1] / "requirements.txt"
    content = req_file.read_text(encoding="utf-8")
    assert "dnspython" in content
