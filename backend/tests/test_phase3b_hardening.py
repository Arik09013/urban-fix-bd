from __future__ import annotations

import asyncio
import time
from io import BytesIO
import pytest
from PIL import Image
from starlette.testclient import TestClient

from app.main import app
from app.core.config import Settings, settings
from app.db.repository import civic_repo, now_utc
from app.services.reporter_access import create_reporter_access
from app.services.storage.cloudinary import sign_evidence_access, verify_evidence_signature, create_signed_evidence_url


def make_test_image(format="JPEG", size=(100, 100), color=(0, 200, 100)) -> bytes:
    buf = BytesIO()
    img = Image.new("RGB", size, color=color)
    img.save(buf, format=format)
    return buf.getvalue()


def reset_repo():
    civic_repo.use_memory = True
    civic_repo.connection_error = None
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
    }


def seed_test_data():
    reset_repo()

    async def _seed():
        await civic_repo.ensure_demo_data()
        ts = now_utc()
        # Add non-demo live CCC complaint in Submitted status
        ccc_submitted = {
            "complaint_id": "CP-CCC-SUBMITTED-01",
            "data_label": "Live",
            "description": "Massive drainage blockage near Agrabad Commercial Area.",
            "location": {"area": "Agrabad, Chattogram", "latitude": 22.324, "longitude": 91.815},
            "category": "Road Infrastructure",
            "severity": "High",
            "department": "Engineering Department (Road Maintenance)",
            "assigned_authority": {
                "authority_id": "AUTH-CCC",
                "authority_name": "Chattogram City Corporation",
                "short_code": "CCC",
                "department": "Engineering Department (Road Maintenance)",
                "routing_status": "assigned",
                "assignment_status": "auto_assigned",
                "routing_method": "administrative_area_keyword",
                "routing_confidence": 0.88,
                "authority_data_status": "candidate_registry",
                "jurisdiction_data_status": "keyword_inferred",
                "integration_status": "simulated",
                "environment": "demo",
                "data_status": "pending_verification",
            },
            "priority_score": 75,
            "status": "Submitted",
            "needs_review": False,
            "review_type": None,
            "created_at": ts,
            "updated_at": ts,
            "status_history": [{"status": "Reported", "note": "Citizen report received.", "at": ts}],
        }
        await civic_repo.insert_one("complaints", ccc_submitted)

        # Add routing-uncertain complaint
        uncertain_complaint = {
            "complaint_id": "CP-UNCERTAIN-01",
            "data_label": "Live",
            "description": "Ambiguous boundary issue near border area.",
            "location": {"area": "Unknown Zone", "latitude": 23.5, "longitude": 90.0},
            "category": "Road Infrastructure",
            "severity": "Medium",
            "department": "Needs Review",
            "assigned_authority": {
                "authority_id": None,
                "authority_name": None,
                "short_code": None,
                "department": "Needs Review",
                "routing_status": "needs_review",
                "assignment_status": "needs_review",
            },
            "priority_score": 50,
            "status": "Needs Review",
            "needs_review": True,
            "review_type": "routing_uncertain",
            "created_at": ts,
            "updated_at": ts,
            "status_history": [{"status": "Needs Review", "note": "Routing uncertain.", "at": ts}],
        }
        await civic_repo.insert_one("complaints", uncertain_complaint)

    asyncio.run(_seed())


def login_officer(client: TestClient, username: str) -> dict:
    settings.allow_demo_officer_login = True
    resp = client.post("/api/auth/demo-officer-login", json={"username": username})
    assert resp.status_code == 200, f"Officer login failed: {resp.text}"
    csrf = resp.json()["csrf_token"]
    return {"x-csrf-token": csrf}


def login_admin(client: TestClient) -> dict:
    resp = client.post("/api/auth/login", json={"email": "admin", "password": "admin"})
    assert resp.status_code == 200
    csrf = resp.json()["csrf_token"]
    return {"x-csrf-token": csrf}


# ==============================================================================
# P0.1 — HMAC EVIDENCE SIGNING SECRET TESTS
# ==============================================================================

def test_p0_1_production_secret_validation():
    """Missing or short EVIDENCE_SIGNING_SECRET fails production safety validation."""
    # 1. Missing secret in production
    with pytest.raises(ValueError, match="EVIDENCE_SIGNING_SECRET"):
        Settings(
            environment="production",
            admin_password="secure-production-password-123456",
            reporter_token_secret="secure-reporter-secret-that-is-at-least-32-chars-long",
            evidence_signing_secret="",
            mongo_uri="mongodb+srv://user:pass@cluster.mongodb.net",
            cloudinary_url="cloudinary://123:abc@test",
            payment_provider="stripe",
            stripe_secret_key="sk_live_test",
        )

    # 2. Short secret in production (< 32 chars)
    with pytest.raises(ValueError, match="EVIDENCE_SIGNING_SECRET"):
        Settings(
            environment="production",
            admin_password="secure-production-password-123456",
            reporter_token_secret="secure-reporter-secret-that-is-at-least-32-chars-long",
            evidence_signing_secret="too-short-secret",
            mongo_uri="mongodb+srv://user:pass@cluster.mongodb.net",
            cloudinary_url="cloudinary://123:abc@test",
            payment_provider="stripe",
            stripe_secret_key="sk_live_test",
        )

    # 3. Sufficiently strong secret passes
    valid_settings = Settings(
        environment="production",
        admin_password="secure-production-password-123456",
        reporter_token_secret="secure-reporter-secret-that-is-at-least-32-chars-long",
        evidence_signing_secret="secure-evidence-signing-secret-that-is-at-least-32-chars-long",
        mongo_uri="mongodb+srv://user:pass@cluster.mongodb.net",
        cloudinary_url="cloudinary://123:abc@test",
        payment_provider="stripe",
        stripe_secret_key="sk_live_test",
    )
    assert valid_settings.evidence_signing_secret.startswith("secure-evidence")


def test_p0_1_hmac_signing_and_verification_rules(monkeypatch):
    """Correct secret validates; incorrect secret, expired timestamp, or altered scope fail."""
    test_secret = "test-evidence-secret-that-is-sufficiently-long-32ch"
    monkeypatch.setattr(settings, "evidence_signing_secret", test_secret)

    complaint_id = "CP-CCC-LIVE-01"
    filename = "repaired_street.jpg"
    exp = int(time.time()) + 3600

    # 1. Correct secret generates and validates signature
    sig = sign_evidence_access(complaint_id, filename, exp)
    assert isinstance(sig, str) and len(sig) == 64
    assert verify_evidence_signature(complaint_id, filename, sig, exp) is True

    # 2. Expired signature is rejected
    past_exp = int(time.time()) - 10
    expired_sig = sign_evidence_access(complaint_id, filename, past_exp)
    assert verify_evidence_signature(complaint_id, filename, expired_sig, past_exp) is False

    # 3. Modified complaint ID invalidates signature
    assert verify_evidence_signature("CP-DNCC-99", filename, sig, exp) is False

    # 4. Modified filename invalidates signature
    assert verify_evidence_signature(complaint_id, "other_file.jpg", sig, exp) is False

    # 5. Tampered signature is rejected
    tampered_sig = ("0" if sig[0] != "0" else "1") + sig[1:]
    assert verify_evidence_signature(complaint_id, filename, tampered_sig, exp) is False

    # 6. Missing secret fails closed
    monkeypatch.setattr(settings, "evidence_signing_secret", "")
    with pytest.raises(ValueError, match="EVIDENCE_SIGNING_SECRET is not configured"):
        sign_evidence_access(complaint_id, filename, exp)
    assert verify_evidence_signature(complaint_id, filename, sig, exp) is False


def test_p0_1_create_signed_evidence_url(monkeypatch):
    """create_signed_evidence_url returns scoped URL without exposing secret."""
    test_secret = "test-evidence-secret-that-is-sufficiently-long-32ch"
    monkeypatch.setattr(settings, "evidence_signing_secret", test_secret)

    url = create_signed_evidence_url("CP-123", "proof.jpg", ttl_seconds=1800)
    assert url.startswith("/uploads/proof.jpg?cid=CP-123&exp=")
    assert "&sig=" in url
    assert test_secret not in url


# ==============================================================================
# P0.2 — DEMO OFFICER LOGIN SECURITY TESTS
# ==============================================================================

def test_p0_2_demo_officer_login_disabled_by_default(monkeypatch):
    """Demo officer login is disabled by default in development."""
    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(settings, "allow_demo_officer_login", False)

    client = TestClient(app)
    resp = client.post("/api/auth/demo-officer-login", json={"username": "officer.ccc"})
    assert resp.status_code == 403
    assert "disabled" in resp.json()["detail"].lower()


def test_p0_2_demo_officer_login_allowed_when_explicitly_enabled(monkeypatch):
    """Demo officer login succeeds in development when explicitly opted in."""
    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(settings, "allow_demo_officer_login", True)

    client = TestClient(app)
    resp = client.post("/api/auth/demo-officer-login", json={"username": "officer.ccc"})
    assert resp.status_code == 200
    assert resp.json()["role"] == "officer"
    assert resp.json()["authority_id"] == "AUTH-CCC"


def test_p0_2_demo_officer_login_always_rejected_in_production(monkeypatch):
    """Demo officer login is unconditionally rejected in production, even if opted in."""
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "allow_demo_officer_login", True)

    client = TestClient(app)
    resp = client.post("/api/auth/demo-officer-login", json={"username": "officer.ccc"})
    assert resp.status_code == 403
    assert "production" in resp.json()["detail"].lower()


def test_p0_2_normal_authenticated_login_works_regardless(monkeypatch):
    """Standard password authentication continues working normally."""
    seed_test_data()
    monkeypatch.setattr(settings, "allow_demo_officer_login", False)

    client = TestClient(app)
    # Admin login with credentials
    admin_resp = client.post("/api/auth/login", json={"email": "admin", "password": "admin"})
    assert admin_resp.status_code == 200
    assert admin_resp.json()["role"] == "admin"


# ==============================================================================
# P1.1 — REOPENED COMPLAINT WORKFLOW & ROUTING UNCERTAINTY TESTS
# ==============================================================================

def test_p1_1_reopened_complaint_enters_officer_reinspection_workflow(monkeypatch):
    """Citizen dispute marks review_type='citizen_dispute' and allows officer reinspection."""
    monkeypatch.setattr(settings, "evidence_signing_secret", "test-secret-at-least-32-chars-long-min!")
    seed_test_data()
    client = TestClient(app)
    headers = login_officer(client, "officer.ccc")

    # Acknowledge and progress live CCC complaint
    client.patch("/api/complaints/CP-CCC-SUBMITTED-01/status", headers=headers, json={"status": "Acknowledged"})
    client.patch("/api/complaints/CP-CCC-SUBMITTED-01/status", headers=headers, json={"status": "In Progress"})

    # Upload evidence
    test_img = make_test_image()
    up = client.post(
        "/api/complaints/CP-CCC-SUBMITTED-01/evidence/upload",
        headers=headers,
        files={"image": ("work_done.jpg", test_img, "image/jpeg")},
        data={"completion_note": "Drainage unblocked."},
    )
    assert up.status_code == 200

    # Citizen disputes resolution
    token = asyncio.run(create_reporter_access("CP-CCC-SUBMITTED-01", "reporter@chattogram.bd"))
    anon_client = TestClient(app)
    dispute_resp = anon_client.post(
        "/api/complaints/CP-CCC-SUBMITTED-01/reporter-verification",
        json={"token": token, "outcome": "not_fixed", "note": "Water still accumulating during heavy rain."},
    )
    assert dispute_resp.status_code == 200
    complaint_data = dispute_resp.json()
    assert complaint_data["status"] == "Reopened - Needs Review"

    # Verify backend record state
    stored = asyncio.run(civic_repo.find_one("complaints", "complaint_id", "CP-CCC-SUBMITTED-01"))
    assert stored["status"] == "Reopened - Needs Review"
    assert stored["needs_review"] is True
    assert stored["review_type"] == "citizen_dispute"
    assert "previous_resolution_evidence" in stored
    assert stored["citizen_verification"]["outcome"] == "not_fixed"

    # Officer can acknowledge reinspection (clearing needs_review & review_type)
    reack_resp = client.patch(
        "/api/complaints/CP-CCC-SUBMITTED-01/status",
        headers=headers,
        json={"status": "Acknowledged", "note": "Officer acknowledged dispute and scheduled re-excavation."},
    )
    assert reack_resp.status_code == 200
    reack_data = reack_resp.json()
    assert reack_data["status"] == "Acknowledged"
    assert reack_data["needs_review"] is False
    assert reack_data.get("review_type") is None

    # Check reinspection audit event
    audit_events = civic_repo.memory["audit_events"]
    actions = {e.get("action") for e in audit_events if e.get("entity_id") == "CP-CCC-SUBMITTED-01"}
    assert "reinspection_acknowledged" in actions

    # Officer can start work again
    restart_resp = client.patch(
        "/api/complaints/CP-CCC-SUBMITTED-01/status",
        headers=headers,
        json={"status": "In Progress", "note": "Re-excavation team on site."},
    )
    assert restart_resp.status_code == 200
    assert restart_resp.json()["status"] == "In Progress"


def test_p1_1_routing_uncertain_complaint_blocked_from_officer_dispatch():
    """Officers cannot dispatch or modify complaints with review_type='routing_uncertain'."""
    seed_test_data()
    client = TestClient(app)
    headers = login_officer(client, "officer.ccc")

    # Officer tries to acknowledge routing-uncertain complaint
    resp = client.patch(
        "/api/complaints/CP-UNCERTAIN-01/status",
        headers=headers,
        json={"status": "Acknowledged", "note": "Officer attempting dispatch on uncertain routing"},
    )
    assert resp.status_code == 403
    assert "routing-uncertain" in resp.json()["detail"].lower()


# ==============================================================================
# P1.2 — SUBMITTED COMPLAINT ACKNOWLEDGMENT TESTS
# ==============================================================================

def test_p1_2_officer_can_acknowledge_submitted_complaint_directly():
    """Assigned authority officer can acknowledge freshly Submitted complaints directly."""
    seed_test_data()
    client = TestClient(app)
    headers = login_officer(client, "officer.ccc")

    # Complaint is in 'Submitted' status
    stored = asyncio.run(civic_repo.find_one("complaints", "complaint_id", "CP-CCC-SUBMITTED-01"))
    assert stored["status"] == "Submitted"

    # Officer acknowledges directly from Submitted status
    ack_resp = client.patch(
        "/api/complaints/CP-CCC-SUBMITTED-01/status",
        headers=headers,
        json={"status": "Acknowledged", "note": "Officer acknowledged directly from workspace."},
    )
    assert ack_resp.status_code == 200
    data = ack_resp.json()
    assert data["status"] == "Acknowledged"
    assert data["assigned_at"] is not None
    assert data["acknowledged_at"] is not None

    # Duplicate acknowledgment request is handled safely and returns existing record
    dup_resp = client.patch(
        "/api/complaints/CP-CCC-SUBMITTED-01/status",
        headers=headers,
        json={"status": "Acknowledged", "note": "Duplicate click"},
    )
    assert dup_resp.status_code == 200
    assert dup_resp.json()["status"] == "Acknowledged"


def test_p1_2_other_authority_officer_cannot_acknowledge():
    """DNCC officer cannot acknowledge CCC submitted complaint."""
    seed_test_data()
    client = TestClient(app)
    dncc_headers = login_officer(client, "officer.dncc")

    resp = client.patch(
        "/api/complaints/CP-CCC-SUBMITTED-01/status",
        headers=dncc_headers,
        json={"status": "Acknowledged"},
    )
    assert resp.status_code == 403


# ==============================================================================
# TRUTHFULNESS — APPROVAL FLAGS & SIMULATED SEMANTICS TESTS
# ==============================================================================

def test_truthfulness_officer_upload_sets_truthful_submission_flags():
    """Evidence upload sets officer_evidence_submitted without fake contractor or external approval."""
    seed_test_data()
    client = TestClient(app)
    headers = login_officer(client, "officer.ccc")

    client.patch("/api/complaints/CP-CCC-SUBMITTED-01/status", headers=headers, json={"status": "Acknowledged"})
    client.patch("/api/complaints/CP-CCC-SUBMITTED-01/status", headers=headers, json={"status": "In Progress"})

    up = client.post(
        "/api/complaints/CP-CCC-SUBMITTED-01/evidence/upload",
        headers=headers,
        files={"image": ("proof.jpg", make_test_image(), "image/jpeg")},
        data={"completion_note": "Municipal crew completed patch."},
    )
    assert up.status_code == 200
    data = up.json()

    # Truthful officer evidence submission state is recorded
    assert data["officer_evidence_submitted"] is True
    assert data["resolution_approvals"]["officer_submission"] is True

    # No fake contractor approval for municipal direct-work
    assert "contractor" not in data["resolution_approvals"]

    # Complaint is NOT marked fully_verified or Resolved yet
    assert data.get("fully_verified") is not True
    assert data["status"] == "Evidence Uploaded"
