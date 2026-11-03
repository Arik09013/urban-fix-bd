from __future__ import annotations

import asyncio
import pytest
from starlette.testclient import TestClient

from app.main import app
from app.core.config import settings
from app.db.repository import civic_repo, now_utc
from app.services.routing.registry import get_authority


client = TestClient(app)


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
        # Add a DNCC complaint for cross-authority tests
        ts = now_utc()
        dncc_complaint = {
            "complaint_id": "CP-DNCC-101",
            "data_label": "Demo",
            "description": "Overflowing waste in Mirpur 10 transit zone.",
            "location": {"area": "Mirpur 10, Dhaka", "latitude": 23.8069, "longitude": 90.3687},
            "category": "Waste Management",
            "severity": "Medium",
            "department": "Waste Management Department",
            "assigned_authority": {
                "authority_id": "AUTH-DNCC",
                "authority_name": "Dhaka North City Corporation",
                "short_code": "DNCC",
                "department": "Waste Management Department",
                "jurisdiction": "Dhaka North Metropolitan Area",
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
            "initial_assigned_authority": {
                "authority_id": "AUTH-DNCC",
                "authority_name": "Dhaka North City Corporation",
                "short_code": "DNCC",
                "department": "Waste Management Department",
                "routing_status": "assigned",
            },
            "priority_score": 70,
            "status": "In Progress",
            "created_at": ts,
            "updated_at": ts,
            "status_history": [{"status": "In Progress", "note": "Assigned to DNCC.", "at": ts}],
        }
        await civic_repo.insert_one("complaints", dncc_complaint)
    asyncio.run(_seed())


def test_1_ccc_officer_can_access_ccc_complaint():
    """1. CCC officer can access CCC-assigned complaint workspace and queue."""
    seed_test_data()
    # Login as demo CCC officer
    resp = client.post("/api/auth/demo-officer-login", json={"username": "officer.ccc"})
    assert resp.status_code == 200
    user = resp.json()
    assert user["role"] == "officer"
    assert user["authority_id"] == "AUTH-CCC"

    # CCC officer accesses CCC complaint workspace (CP-9082 is assigned to AUTH-CCC)
    ws_resp = client.get("/api/operations/incidents/CP-9082")
    assert ws_resp.status_code == 200
    assert ws_resp.json()["complaint"]["complaint_id"] == "CP-9082"
    assert ws_resp.json()["complaint"]["assigned_authority"]["authority_id"] == "AUTH-CCC"

    # CCC officer retrieves queue: must only see CCC complaints
    queue_resp = client.get("/api/operations/queue")
    assert queue_resp.status_code == 200
    items = queue_resp.json()["items"]
    assert len(items) > 0
    for item in items:
        assert item["assigned_authority"]["authority_id"] == "AUTH-CCC"


def test_2_ccc_officer_cannot_access_dncc_complaint():
    """2. CCC officer cannot access DNCC-assigned complaint workspace."""
    seed_test_data()
    resp = client.post("/api/auth/demo-officer-login", json={"username": "officer.ccc"})
    assert resp.status_code == 200

    # CP-DNCC-101 is assigned to AUTH-DNCC
    ws_resp = client.get("/api/operations/incidents/CP-DNCC-101")
    assert ws_resp.status_code == 403
    assert "other authority" in ws_resp.json()["detail"].lower()


def test_3_dncc_officer_cannot_modify_ccc_complaint():
    """3. DNCC officer cannot modify CCC complaint status or submit evidence."""
    seed_test_data()
    login_resp = client.post("/api/auth/demo-officer-login", json={"username": "officer.dncc"})
    assert login_resp.status_code == 200
    csrf = login_resp.json()["csrf_token"]

    # DNCC officer tries to modify status of CCC complaint CP-9082
    patch_resp = client.patch(
        "/api/complaints/CP-9082/status",
        headers={"x-csrf-token": csrf},
        json={"status": "Acknowledged", "note": "DNCC attempting to touch CCC complaint"},
    )
    assert patch_resp.status_code == 403
    assert "other authorities" in patch_resp.json()["detail"].lower()

    # DNCC officer tries to upload evidence to CCC complaint
    ev_resp = client.post(
        "/api/complaints/CP-9082/evidence",
        headers={"x-csrf-token": csrf},
        json={"after_image_url": "https://example.com/proof.jpg", "completion_note": "Remedial work finished."},
    )
    assert ev_resp.status_code == 403
    assert "other authorities" in ev_resp.json()["detail"].lower()


def test_4_officer_cannot_perform_admin_only_authority_override():
    """4. Officer cannot perform admin-only authority override."""
    seed_test_data()
    login_resp = client.post("/api/auth/demo-officer-login", json={"username": "officer.ccc"})
    assert login_resp.status_code == 200
    csrf = login_resp.json()["csrf_token"]

    # Override endpoint must strictly require admin
    override_resp = client.patch(
        "/api/complaints/CP-9082/override",
        headers={"x-csrf-token": csrf},
        json={"final_authority_id": "AUTH-DNCC", "reason": "Officer attempting override"},
    )
    assert override_resp.status_code == 403
    assert "administrator access required" in override_resp.json()["detail"].lower()


def test_5_officer_cannot_create_another_officer_account():
    """5. Officer cannot create another officer account; public registration cannot register officers."""
    seed_test_data()
    # Attempt via public registration
    reg_resp = client.post(
        "/api/auth/register",
        json={
            "name": "Malicious Officer",
            "email": "malicious@urbanfix.bd",
            "password": "SecurePassword123!",
            "account_type": "officer",
        },
    )
    assert reg_resp.status_code == 422  # Rejected by schema regex pattern ^(youth|contractor)$

    # Attempt via admin endpoint while logged in as an officer
    login_resp = client.post("/api/auth/demo-officer-login", json={"username": "officer.ccc"})
    csrf = login_resp.json()["csrf_token"]

    prov_resp = client.post(
        "/api/auth/officers",
        headers={"x-csrf-token": csrf},
        json={
            "name": "Rogue Officer",
            "username": "officer.rogue",
            "email": "rogue@urbanfix.bd",
            "password": "Password12345!",
            "authority_id": "AUTH-CCC",
            "department": "Engineering Department (Road Maintenance)",
        },
    )
    assert prov_resp.status_code == 403
    assert "administrator access required" in prov_resp.json()["detail"].lower()


def test_6_admin_retains_intended_global_access():
    """6. Admin retains intended global access across authorities and management functions."""
    seed_test_data()
    # Admin login
    login_resp = client.post("/api/auth/login", json={"email": "admin", "password": "admin"})
    assert login_resp.status_code == 200
    admin_csrf = login_resp.json()["csrf_token"]

    # Admin can access CCC complaint workspace
    ccc_ws = client.get("/api/operations/incidents/CP-9082")
    assert ccc_ws.status_code == 200

    # Admin can access DNCC complaint workspace
    dncc_ws = client.get("/api/operations/incidents/CP-DNCC-101")
    assert dncc_ws.status_code == 200

    # Admin can view full global queue
    queue = client.get("/api/operations/queue")
    assert queue.status_code == 200
    ids = {item["complaint_id"] for item in queue.json()["items"]}
    assert "CP-9082" in ids
    assert "CP-DNCC-101" in ids

    # Admin can provision new officer
    prov_resp = client.post(
        "/api/auth/officers",
        headers={"x-csrf-token": admin_csrf},
        json={
            "name": "Nasreen Akter",
            "username": "officer.nasreen",
            "email": "nasreen@urbanfix.bd",
            "password": "AdminCreated123!",
            "authority_id": "AUTH-DSCC",
            "department": "Engineering Department (Roads & Bridges)",
        },
    )
    assert prov_resp.status_code == 200
    assert prov_resp.json()["username"] == "officer.nasreen"
    assert prov_resp.json()["authority_id"] == "AUTH-DSCC"


def test_7_citizen_cannot_access_private_operations_workspace():
    """7. Citizen cannot access internal operations workspace or queue."""
    seed_test_data()
    # Register and login citizen
    reg_resp = client.post(
        "/api/auth/register",
        json={
            "name": "Citizen Rafiq",
            "email": "rafiq@urbanfix.bd",
            "password": "Password123!",
            "account_type": "youth",
        },
    )
    assert reg_resp.status_code == 200
    citizen_csrf = reg_resp.json()["csrf_token"]

    # Citizen tries to access internal incident workspace
    ws_resp = client.get("/api/operations/incidents/CP-9082")
    assert ws_resp.status_code == 403
    assert "access required" in ws_resp.json()["detail"].lower()

    # Citizen tries to access internal operations queue
    q_resp = client.get("/api/operations/queue")
    assert q_resp.status_code == 403

    # Citizen tries to update status
    st_resp = client.patch(
        "/api/complaints/CP-9082/status",
        headers={"x-csrf-token": citizen_csrf},
        json={"status": "Acknowledged"},
    )
    assert st_resp.status_code == 403


def test_8_anonymous_reporter_verification_still_works():
    """8. Anonymous reporter verification token workflow works as intended."""
    seed_test_data()
    # 1. Admin login to set up resolution evidence
    adm_login = client.post("/api/auth/login", json={"email": "admin", "password": "admin"})
    csrf = adm_login.json()["csrf_token"]

    # 2. Reporter submits complaint
    intake = client.post(
        "/api/complaints",
        json={
            "description": "Hazardous road crater near GEC Circle.",
            "location": {"area": "GEC Circle, Chattogram", "latitude": 22.3587, "longitude": 91.8215},
            "category_hint": "Road Infrastructure",
            "reporter_contact": "+8801700999888",
        },
    )
    assert intake.status_code == 200
    complaint_data = intake.json()
    complaint_id = complaint_data["complaint_id"]
    token = complaint_data.get("reporter_verification_token")
    assert token is not None

    # Advance: Submitted -> Assigned -> In Progress
    assign_resp = client.patch(
        f"/api/complaints/{complaint_id}/status",
        headers={"x-csrf-token": csrf},
        json={"status": "Assigned", "note": "Assigned to department."},
    )
    assert assign_resp.status_code == 200

    adv_resp = client.patch(
        f"/api/complaints/{complaint_id}/status",
        headers={"x-csrf-token": csrf},
        json={"status": "In Progress", "note": "Crew dispatched."},
    )
    assert adv_resp.status_code == 200

    # Upload evidence
    ev_resp = client.post(
        f"/api/complaints/{complaint_id}/evidence",
        headers={"x-csrf-token": csrf},
        json={"after_image_url": "https://example.com/fixed.jpg", "completion_note": "Pothole filled and sealed."},
    )
    assert ev_resp.status_code == 200

    # 3. Unauthorized verification attempt with invalid token
    bad_resp = client.post(
        f"/api/complaints/{complaint_id}/reporter-verification",
        json={"token": "invalid-token-1234567890abcdef", "outcome": "fixed"},
    )
    assert bad_resp.status_code == 403
    assert "invalid or expired" in bad_resp.json()["detail"].lower()

    # 4. Legitimate verification attempt by anonymous reporter with valid token
    good_resp = client.post(
        f"/api/complaints/{complaint_id}/reporter-verification",
        json={"token": token, "outcome": "not_fixed", "note": "Asphalt is still uneven."},
    )
    assert good_resp.status_code == 200
    res_data = good_resp.json()
    assert res_data["status"] == "Reopened - Needs Review"
    assert res_data["needs_review"] is True


def test_9_unauthenticated_requests_are_rejected():
    """9. Unauthenticated requests are rejected with 401 Unauthorized."""
    seed_test_data()
    # Client with no cookies
    unauth_client = TestClient(app)

    # Queue
    r1 = unauth_client.get("/api/operations/queue")
    assert r1.status_code == 401
    assert "login required" in r1.json()["detail"].lower()

    # Incident workspace
    r2 = unauth_client.get("/api/operations/incidents/CP-9082")
    assert r2.status_code == 401

    # Status update
    r3 = unauth_client.patch("/api/complaints/CP-9082/status", json={"status": "Acknowledged"})
    assert r3.status_code == 401

    # Officer creation
    r4 = unauth_client.post("/api/auth/officers", json={"name": "Test", "email": "test@test.com", "password": "pass"})
    assert r4.status_code == 401


def test_10_frontend_supplied_authority_cannot_override_session_authority():
    """10. Frontend-supplied authority_id query parameter cannot expand or override officer permissions."""
    seed_test_data()
    login_resp = client.post("/api/auth/demo-officer-login", json={"username": "officer.ccc"})
    assert login_resp.status_code == 200

    # CCC officer requests DNCC queue via query param ?authority_id=AUTH-DNCC
    spoofed = client.get("/api/operations/queue?authority_id=AUTH-DNCC")
    assert spoofed.status_code == 403
    assert "other authorities" in spoofed.json()["detail"].lower()

    # CCC officer requests own authority queue via query param ?authority_id=AUTH-CCC
    valid_filter = client.get("/api/operations/queue?authority_id=AUTH-CCC")
    assert valid_filter.status_code == 200
    for item in valid_filter.json()["items"]:
        assert item["assigned_authority"]["authority_id"] == "AUTH-CCC"
