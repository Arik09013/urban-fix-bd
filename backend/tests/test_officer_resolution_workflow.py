from __future__ import annotations

import asyncio
from io import BytesIO
import pytest
from PIL import Image
from starlette.testclient import TestClient

from app.main import app
from app.core.config import settings, upload_directory
from app.db.repository import civic_repo, now_utc
from app.services.reporter_access import create_reporter_access


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
        # Add non-demo live CCC complaint
        ccc_complaint = {
            "complaint_id": "CP-CCC-LIVE-01",
            "data_label": "Live",
            "description": "Potholes on Agrabad access road needing immediate patching.",
            "location": {"area": "Agrabad, Chattogram", "latitude": 22.324, "longitude": 91.815},
            "category": "Road Infrastructure",
            "severity": "High",
            "department": "Engineering Department (Road Maintenance)",
            "assigned_authority": {
                "authority_id": "AUTH-CCC",
                "authority_name": "Chattogram City Corporation",
                "short_code": "CCC",
                "department": "Engineering Department (Road Maintenance)",
                "jurisdiction": "Chattogram Metropolitan Area",
                "routing_status": "assigned",
                "assignment_status": "auto_assigned",
                "authority_data_status": "candidate_registry",
                "jurisdiction_data_status": "keyword_inferred",
                "integration_status": "simulated",
                "environment": "demo",
            },
            "image_url": "/uploads/citizen_original_photo.jpg",
            "priority_score": 80,
            "status": "Assigned",
            "created_at": ts,
            "updated_at": ts,
            "status_history": [
                {"status": "Submitted", "note": "Received.", "at": ts},
                {"status": "Assigned", "note": "Routed to CCC.", "at": ts},
            ],
        }
        # Add non-demo live DNCC complaint
        dncc_complaint = {
            "complaint_id": "CP-DNCC-LIVE-01",
            "data_label": "Live",
            "description": "Uncollected waste piling up near Gulshan 2 circle.",
            "location": {"area": "Gulshan 2, Dhaka", "latitude": 23.792, "longitude": 90.415},
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
                "authority_data_status": "candidate_registry",
                "jurisdiction_data_status": "keyword_inferred",
                "integration_status": "simulated",
                "environment": "demo",
            },
            "image_url": "/uploads/dncc_original.jpg",
            "priority_score": 65,
            "status": "In Progress",
            "created_at": ts,
            "updated_at": ts,
            "status_history": [
                {"status": "Submitted", "note": "Received.", "at": ts},
                {"status": "Assigned", "note": "Routed to DNCC.", "at": ts},
                {"status": "In Progress", "note": "Work started.", "at": ts},
            ],
        }
        await civic_repo.insert_one("complaints", ccc_complaint)
        await civic_repo.insert_one("complaints", dncc_complaint)

        # Write dummy files to upload directory for retrieval tests
        upload_dir = upload_directory()
        upload_dir.mkdir(parents=True, exist_ok=True)
        (upload_dir / "citizen_original_photo.jpg").write_bytes(make_test_image())
        (upload_dir / "dncc_original.jpg").write_bytes(make_test_image())

    asyncio.run(_seed())


def login_officer(test_client: TestClient, username: str) -> dict[str, str]:
    resp = test_client.post("/api/auth/demo-officer-login", json={"username": username})
    assert resp.status_code == 200
    csrf = resp.json().get("csrf_token", "")
    return {"x-csrf-token": csrf}


def login_admin(test_client: TestClient) -> dict[str, str]:
    resp = test_client.post("/api/auth/login", json={"email": "admin", "password": settings.admin_password})
    assert resp.status_code == 200
    csrf = resp.json().get("csrf_token", "")
    return {"x-csrf-token": csrf}


def test_1_ccc_officer_acknowledges_ccc_complaint():
    """1. CCC officer acknowledges CCC complaint."""
    seed_test_data()
    client = TestClient(app)
    headers = login_officer(client, "officer.ccc")

    resp = client.patch(
        "/api/complaints/CP-CCC-LIVE-01/status",
        headers=headers,
        json={"status": "Acknowledged", "note": "CCC road maintenance crew assigned to inspect site."},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "Acknowledged"
    assert data["acknowledged_at"] is not None

    # Verify audit event recorded
    audit_events = civic_repo.memory["audit_events"]
    ack_events = [e for e in audit_events if (e.get("action") or e.get("event_type")) in {"complaint_acknowledged", "status_transition"} and e.get("entity_id") == "CP-CCC-LIVE-01"]
    assert len(ack_events) > 0


def test_2_ccc_officer_cannot_update_dncc_complaint():
    """2. CCC officer cannot update DNCC complaint."""
    seed_test_data()
    client = TestClient(app)
    headers = login_officer(client, "officer.ccc")

    # Attempt status update on DNCC complaint
    resp1 = client.patch(
        "/api/complaints/CP-DNCC-LIVE-01/status",
        headers=headers,
        json={"status": "Acknowledged", "note": "Unauthorized CCC attempt"},
    )
    assert resp1.status_code == 403
    assert "Officers cannot modify complaints assigned to other authorities" in resp1.json()["detail"]

    # Attempt progress update on DNCC complaint
    resp2 = client.post(
        "/api/complaints/CP-DNCC-LIVE-01/progress",
        headers=headers,
        json={"note": "Unauthorized progress update"},
    )
    assert resp2.status_code == 403

    # Attempt evidence upload on DNCC complaint
    test_img = make_test_image()
    resp3 = client.post(
        "/api/complaints/CP-DNCC-LIVE-01/evidence/upload",
        headers=headers,
        files={"image": ("test.jpg", test_img, "image/jpeg")},
        data={"completion_note": "Unauthorized evidence upload"},
    )
    assert resp3.status_code == 403


def test_3_officer_cannot_skip_invalid_lifecycle_transitions():
    """3. Officer cannot skip invalid lifecycle transitions (e.g. Assigned -> Resolved)."""
    seed_test_data()
    client = TestClient(app)
    headers = login_officer(client, "officer.ccc")

    # CP-CCC-LIVE-01 is currently 'Assigned'. Moving directly to 'Resolved' must fail.
    resp1 = client.patch(
        "/api/complaints/CP-CCC-LIVE-01/status",
        headers=headers,
        json={"status": "Resolved", "note": "Premature closure attempt"},
    )
    assert resp1.status_code == 409
    assert "Cannot move complaint" in resp1.json()["detail"]

    # Moving directly to 'Evidence Uploaded' without evidence or progress must fail
    resp2 = client.patch(
        "/api/complaints/CP-CCC-LIVE-01/status",
        headers=headers,
        json={"status": "Evidence Uploaded", "note": "Skipping to evidence uploaded"},
    )
    assert resp2.status_code == 409

    # Attempting to upload evidence while still 'Assigned' (not In Progress) must fail
    test_img = make_test_image()
    resp3 = client.post(
        "/api/complaints/CP-CCC-LIVE-01/evidence/upload",
        headers=headers,
        files={"image": ("test.jpg", test_img, "image/jpeg")},
        data={"completion_note": "Attempt before work started"},
    )
    assert resp3.status_code == 409
    assert "Evidence can only be uploaded after work is in progress" in resp3.json()["detail"]


def test_4_officer_can_upload_valid_resolution_evidence():
    """4. Officer can upload valid resolution evidence (multipart)."""
    seed_test_data()
    client = TestClient(app)
    headers = login_officer(client, "officer.ccc")

    # Step through: Assigned -> Acknowledged -> In Progress
    client.patch("/api/complaints/CP-CCC-LIVE-01/status", headers=headers, json={"status": "Acknowledged", "note": "Acked"})
    client.patch("/api/complaints/CP-CCC-LIVE-01/status", headers=headers, json={"status": "In Progress", "note": "Work started"})

    # Add a progress note
    prog_resp = client.post(
        "/api/complaints/CP-CCC-LIVE-01/progress",
        headers=headers,
        json={"note": "Asphalt patch machine deployed to Agrabad sector 2."},
    )
    assert prog_resp.status_code == 200
    assert prog_resp.json()["last_progress_note"] == "Asphalt patch machine deployed to Agrabad sector 2."

    # Upload valid resolution evidence
    test_img = make_test_image(format="JPEG", color=(0, 180, 50))
    resp = client.post(
        "/api/complaints/CP-CCC-LIVE-01/evidence/upload",
        headers=headers,
        files={"image": ("repaired_road.jpg", test_img, "image/jpeg")},
        data={
            "completion_note": "Road resurfacing completed with high-durability bituminous mix.",
            "gps_latitude": "22.3248",
            "gps_longitude": "91.8152",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "Evidence Uploaded"
    assert data["resolution_evidence"] is not None
    assert "/uploads/" in data["resolution_evidence"]["url"]
    assert data["resolution_evidence"]["completion_note"] == "Road resurfacing completed with high-durability bituminous mix."
    assert data["officer_evidence_submitted"] is True
    assert data["resolution_approvals"]["officer_submission"] is True
    assert "contractor" not in data["resolution_approvals"]


def test_5_invalid_image_files_rejected():
    """5. Invalid image files rejected (corrupt/bad magic)."""
    seed_test_data()
    client = TestClient(app)
    headers = login_officer(client, "officer.ccc")

    client.patch("/api/complaints/CP-CCC-LIVE-01/status", headers=headers, json={"status": "Acknowledged", "note": "Acked"})
    client.patch("/api/complaints/CP-CCC-LIVE-01/status", headers=headers, json={"status": "In Progress", "note": "Work started"})

    # Upload malicious / corrupt text masquerading as jpeg
    fake_img = b"PLAIN_TEXT_NOT_A_REAL_IMAGE_BYTES_PAYLOAD"
    resp = client.post(
        "/api/complaints/CP-CCC-LIVE-01/evidence/upload",
        headers=headers,
        files={"image": ("malicious.jpg", fake_img, "image/jpeg")},
        data={"completion_note": "Attempt with corrupt file"},
    )
    assert resp.status_code == 415
    assert "File content does not match" in resp.json()["detail"] or "unsupported" in resp.json()["detail"].lower()


def test_6_oversized_images_rejected(monkeypatch):
    """6. Oversized images rejected."""
    seed_test_data()
    client = TestClient(app)
    headers = login_officer(client, "officer.ccc")

    client.patch("/api/complaints/CP-CCC-LIVE-01/status", headers=headers, json={"status": "Acknowledged", "note": "Acked"})
    client.patch("/api/complaints/CP-CCC-LIVE-01/status", headers=headers, json={"status": "In Progress", "note": "Work started"})

    # Temporarily set max_upload_mb to 1MB and attempt uploading 2MB payload
    monkeypatch.setattr(settings, "max_upload_mb", 1)
    large_img = b"\xff\xd8\xff\xe0" + b"\x00" * (2 * 1024 * 1024)
    resp = client.post(
        "/api/complaints/CP-CCC-LIVE-01/evidence/upload",
        headers=headers,
        files={"image": ("too_large.jpg", large_img, "image/jpeg")},
        data={"completion_note": "Attempt with oversized file"},
    )
    assert resp.status_code == 413
    assert "upload limit" in resp.json()["detail"].lower()


def test_7_original_complaint_image_remains_unchanged():
    """7. Original complaint image remains unchanged."""
    seed_test_data()
    client = TestClient(app)
    headers = login_officer(client, "officer.ccc")

    # Inspect initial complaint image
    initial = client.get("/api/operations/incidents/CP-CCC-LIVE-01").json()["complaint"]
    orig_img = initial["image_url"]
    assert orig_img == "/uploads/citizen_original_photo.jpg"

    # Step through and upload evidence
    client.patch("/api/complaints/CP-CCC-LIVE-01/status", headers=headers, json={"status": "Acknowledged", "note": "Acked"})
    client.patch("/api/complaints/CP-CCC-LIVE-01/status", headers=headers, json={"status": "In Progress", "note": "Work started"})

    test_img = make_test_image()
    resp = client.post(
        "/api/complaints/CP-CCC-LIVE-01/evidence/upload",
        headers=headers,
        files={"image": ("resolution.jpg", test_img, "image/jpeg")},
        data={"completion_note": "Finished"},
    )
    assert resp.status_code == 200
    after = resp.json()

    # Original citizen photo MUST remain preserved
    assert after["image_url"] == orig_img
    # Resolution evidence URL must be separate
    assert after["resolution_evidence"]["url"] != orig_img
    assert after["after_image_url"] != orig_img


def test_8_evidence_access_restricted_to_authorized_users():
    """8. Evidence access restricted to authorized users (unauthorized gets 403)."""
    seed_test_data()
    client = TestClient(app)
    headers = login_officer(client, "officer.ccc")

    client.patch("/api/complaints/CP-CCC-LIVE-01/status", headers=headers, json={"status": "Acknowledged", "note": "Acked"})
    client.patch("/api/complaints/CP-CCC-LIVE-01/status", headers=headers, json={"status": "In Progress", "note": "Work started"})

    test_img = make_test_image()
    upload_res = client.post(
        "/api/complaints/CP-CCC-LIVE-01/evidence/upload",
        headers=headers,
        files={"image": ("evidence_pic.jpg", test_img, "image/jpeg")},
        data={"completion_note": "Evidence upload for access check"},
    )
    assert upload_res.status_code == 200
    ev_url = upload_res.json()["resolution_evidence"]["url"]
    ev_filename = ev_url.split("/")[-1]

    # Create unauthenticated client
    anon_client = TestClient(app)

    # 1. Anonymous request to /uploads/{filename} must get 403
    anon_res = anon_client.get(f"/uploads/{ev_filename}")
    assert anon_res.status_code == 403

    # 2. Anonymous request to dedicated evidence endpoint must get 403
    anon_res2 = anon_client.get("/api/complaints/CP-CCC-LIVE-01/evidence/file/after")
    assert anon_res2.status_code == 403

    # 3. DNCC officer request to CCC evidence must get 403
    dncc_client = TestClient(app)
    login_officer(dncc_client, "officer.dncc")
    dncc_res1 = dncc_client.get(f"/uploads/{ev_filename}")
    assert dncc_res1.status_code == 403
    dncc_res2 = dncc_client.get("/api/complaints/CP-CCC-LIVE-01/evidence/file/after")
    assert dncc_res2.status_code == 403

    # 4. Authorized CCC officer request must succeed (200)
    ccc_res = client.get(f"/uploads/{ev_filename}")
    assert ccc_res.status_code == 200
    assert ccc_res.headers["cache-control"] == "private, no-store"

    # 5. Admin request must succeed (200)
    admin_client = TestClient(app)
    login_admin(admin_client)
    admin_res = admin_client.get(f"/uploads/{ev_filename}")
    assert admin_res.status_code == 200


def test_9_citizen_can_confirm_resolution_with_valid_token():
    """9. Citizen can confirm resolution with valid token."""
    seed_test_data()
    client = TestClient(app)
    headers = login_officer(client, "officer.ccc")

    client.patch("/api/complaints/CP-CCC-LIVE-01/status", headers=headers, json={"status": "Acknowledged", "note": "Acked"})
    client.patch("/api/complaints/CP-CCC-LIVE-01/status", headers=headers, json={"status": "In Progress", "note": "Work started"})

    test_img = make_test_image()
    up = client.post(
        "/api/complaints/CP-CCC-LIVE-01/evidence/upload",
        headers=headers,
        files={"image": ("resolved.jpg", test_img, "image/jpeg")},
        data={"completion_note": "Repairs complete"},
    )
    assert up.status_code == 200
    ev_filename = up.json()["resolution_evidence"]["url"].split("/")[-1]

    # Generate a valid reporter verification token
    token = asyncio.run(create_reporter_access("CP-CCC-LIVE-01", "citizen@chattogram.bd"))

    # Citizen accesses evidence using their token
    anon_client = TestClient(app)
    evidence_view = anon_client.get(f"/uploads/{ev_filename}?token={token}")
    assert evidence_view.status_code == 200

    # Citizen confirms resolution
    confirm_resp = anon_client.post(
        "/api/complaints/CP-CCC-LIVE-01/reporter-verification",
        json={"token": token, "outcome": "fixed", "note": "Road is completely fixed, thank you CCC team."},
    )
    assert confirm_resp.status_code == 200
    data = confirm_resp.json()
    assert data["status"] == "Resolved"
    assert data["citizen_verification"]["fixed"] is True
    assert data["resolution_approvals"]["reporter"] is True
    assert data["fully_verified"] is True


def test_10_citizen_can_reject_and_reopen_with_valid_token():
    """10. Citizen can reject and reopen with valid token."""
    seed_test_data()
    client = TestClient(app)
    headers = login_officer(client, "officer.ccc")

    client.patch("/api/complaints/CP-CCC-LIVE-01/status", headers=headers, json={"status": "Acknowledged", "note": "Acked"})
    client.patch("/api/complaints/CP-CCC-LIVE-01/status", headers=headers, json={"status": "In Progress", "note": "Work started"})

    test_img = make_test_image()
    up = client.post(
        "/api/complaints/CP-CCC-LIVE-01/evidence/upload",
        headers=headers,
        files={"image": ("resolved.jpg", test_img, "image/jpeg")},
        data={"completion_note": "Repairs claimed complete"},
    )
    assert up.status_code == 200

    token = asyncio.run(create_reporter_access("CP-CCC-LIVE-01", "citizen@chattogram.bd"))

    anon_client = TestClient(app)
    reject_resp = anon_client.post(
        "/api/complaints/CP-CCC-LIVE-01/reporter-verification",
        json={"token": token, "outcome": "not_fixed", "note": "Large crater is still open and dangerous at night."},
    )
    assert reject_resp.status_code == 200
    data = reject_resp.json()
    assert data["status"] == "Reopened - Needs Review"
    assert data["needs_review"] is True
    assert data["citizen_verification"]["fixed"] is False
    assert data["resolution_approvals"]["reporter"] is False
    assert data["fully_verified"] is False


def test_11_invalid_verification_token_rejected():
    """11. Invalid verification token rejected."""
    seed_test_data()
    client = TestClient(app)
    headers = login_officer(client, "officer.ccc")

    client.patch("/api/complaints/CP-CCC-LIVE-01/status", headers=headers, json={"status": "Acknowledged", "note": "Acked"})
    client.patch("/api/complaints/CP-CCC-LIVE-01/status", headers=headers, json={"status": "In Progress", "note": "Work started"})
    up = client.post(
        "/api/complaints/CP-CCC-LIVE-01/evidence/upload",
        headers=headers,
        files={"image": ("resolved.jpg", make_test_image(), "image/jpeg")},
        data={"completion_note": "Done"},
    )
    assert up.status_code == 200

    anon_client = TestClient(app)
    resp = anon_client.post(
        "/api/complaints/CP-CCC-LIVE-01/reporter-verification",
        json={"token": "completely-invalid-bogus-token", "outcome": "fixed"},
    )
    assert resp.status_code == 403
    assert "invalid or expired" in resp.json()["detail"].lower()


def test_12_citizen_cannot_verify_another_reporters_complaint():
    """12. Citizen cannot verify another reporter's complaint."""
    seed_test_data()
    client = TestClient(app)
    headers = login_officer(client, "officer.ccc")

    client.patch("/api/complaints/CP-CCC-LIVE-01/status", headers=headers, json={"status": "Acknowledged", "note": "Acked"})
    client.patch("/api/complaints/CP-CCC-LIVE-01/status", headers=headers, json={"status": "In Progress", "note": "Work started"})
    up = client.post(
        "/api/complaints/CP-CCC-LIVE-01/evidence/upload",
        headers=headers,
        files={"image": ("resolved.jpg", make_test_image(), "image/jpeg")},
        data={"completion_note": "Done"},
    )
    assert up.status_code == 200

    # Token generated for CP-DNCC-LIVE-01
    dncc_token = asyncio.run(create_reporter_access("CP-DNCC-LIVE-01", "dncc_user@dhaka.bd"))

    # Attempt to use DNCC reporter token to verify CCC complaint
    anon_client = TestClient(app)
    resp = anon_client.post(
        "/api/complaints/CP-CCC-LIVE-01/reporter-verification",
        json={"token": dncc_token, "outcome": "fixed"},
    )
    assert resp.status_code == 403


def test_13_all_consequential_actions_create_audit_events():
    """13. All consequential actions create audit events."""
    seed_test_data()
    client = TestClient(app)
    headers = login_officer(client, "officer.ccc")

    # 1. Acknowledge
    client.patch("/api/complaints/CP-CCC-LIVE-01/status", headers=headers, json={"status": "Acknowledged", "note": "Acknowledging"})
    # 2. Start work
    client.patch("/api/complaints/CP-CCC-LIVE-01/status", headers=headers, json={"status": "In Progress", "note": "Starting repair"})
    # 3. Progress update
    client.post("/api/complaints/CP-CCC-LIVE-01/progress", headers=headers, json={"note": "50% complete"})
    # 4. Upload evidence
    client.post(
        "/api/complaints/CP-CCC-LIVE-01/evidence/upload",
        headers=headers,
        files={"image": ("resolved.jpg", make_test_image(), "image/jpeg")},
        data={"completion_note": "Road repair finished"},
    )

    token = asyncio.run(create_reporter_access("CP-CCC-LIVE-01", "citizen@chattogram.bd"))
    anon_client = TestClient(app)
    # 5. Citizen confirm
    anon_client.post(
        "/api/complaints/CP-CCC-LIVE-01/reporter-verification",
        json={"token": token, "outcome": "fixed", "note": "Confirmed fixed"},
    )

    audit_events = civic_repo.memory["audit_events"]
    actions = {(e.get("action") or e.get("event_type")) for e in audit_events if e.get("entity_id") == "CP-CCC-LIVE-01"}

    assert "progress_update" in actions
    assert "resolution_evidence_uploaded" in actions
    assert "citizen_confirmed" in actions or "reporter_verification" in actions


def test_14_admin_retains_intended_global_access():
    """14. Admin retains intended global access."""
    seed_test_data()
    admin_client = TestClient(app)
    login_admin(admin_client)

    # Admin accesses CCC complaint workspace
    res_ccc = admin_client.get("/api/operations/incidents/CP-CCC-LIVE-01")
    assert res_ccc.status_code == 200

    # Admin accesses DNCC complaint workspace
    res_dncc = admin_client.get("/api/operations/incidents/CP-DNCC-LIVE-01")
    assert res_dncc.status_code == 200

    # Admin sees all items in operations queue
    queue_resp = admin_client.get("/api/operations/queue")
    assert queue_resp.status_code == 200
    complaint_ids = {item["complaint_id"] for item in queue_resp.json()["items"]}
    assert "CP-CCC-LIVE-01" in complaint_ids
    assert "CP-DNCC-LIVE-01" in complaint_ids


def test_15_existing_phase1_authorization_tests_still_pass():
    """15. Existing Phase 1 authorization tests still pass."""
    seed_test_data()
    client = TestClient(app)
    for username, auth_id in [
        ("officer.ccc", "AUTH-CCC"),
        ("officer.dncc", "AUTH-DNCC"),
        ("officer.dscc", "AUTH-DSCC"),
        ("officer.dwasa", "AUTH-DWASA"),
    ]:
        login = client.post("/api/auth/demo-officer-login", json={"username": username})
        assert login.status_code == 200
        user = login.json()
        assert user["role"] == "officer"
        assert user["authority_id"] == auth_id
        assert user["active"] is True
