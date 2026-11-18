from __future__ import annotations

import asyncio
from io import BytesIO
import pytest
from PIL import Image
from starlette.testclient import TestClient

from app.main import app
from app.core.config import settings, upload_directory
from app.db.repository import civic_repo, now_utc


def make_test_image(format="JPEG", size=(100, 100), color=(0, 200, 100)) -> bytes:
    buf = BytesIO()
    img = Image.new("RGB", size, color=color)
    img.save(buf, format=format)
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _isolate_test_storage(monkeypatch):
    monkeypatch.setattr(settings, "cloudinary_url", None)
    monkeypatch.setattr(settings, "cloudinary_cloud_name", None)
    monkeypatch.setattr(settings, "cloudinary_api_key", None)
    monkeypatch.setattr(settings, "cloudinary_api_secret", None)


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


def seed_accountability_test_data():
    reset_repo()

    async def _seed():
        await civic_repo.ensure_demo_data()
        ts = now_utc()

        # Add live CCC complaints in various states
        ccc_1 = {
            "complaint_id": "CP-CCC-ACC-01",
            "data_label": "Live",
            "description": "Severe road crater on Agrabad Boulevard.",
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
            },
            "image_url": "/uploads/ccc_before_1.jpg",
            "status": "In Progress",
            "created_at": ts,
            "updated_at": ts,
            "status_history": [{"status": "Assigned", "at": ts}, {"status": "In Progress", "at": ts}],
        }

        ccc_2 = {
            "complaint_id": "CP-CCC-ACC-02",
            "data_label": "Live",
            "description": "Drainage blocked on Jubilee Road.",
            "location": {"area": "Jubilee Road, Chattogram", "latitude": 22.335, "longitude": 91.831},
            "category": "Drainage & Waterlogging",
            "severity": "Medium",
            "department": "Conservancy & Drainage Department",
            "assigned_authority": {
                "authority_id": "AUTH-CCC",
                "authority_name": "Chattogram City Corporation",
                "short_code": "CCC",
                "department": "Conservancy & Drainage Department",
                "routing_status": "assigned",
            },
            "image_url": "/uploads/ccc_before_2.jpg",
            "status": "Assigned",
            "created_at": ts,
            "updated_at": ts,
            "status_history": [{"status": "Assigned", "at": ts}],
        }

        # Add live DNCC complaint for authority isolation testing
        dncc_1 = {
            "complaint_id": "CP-DNCC-ACC-01",
            "data_label": "Live",
            "description": "Streetlight failure in Uttara Sector 7.",
            "location": {"area": "Uttara, Dhaka", "latitude": 23.875, "longitude": 90.380},
            "category": "Street Lighting",
            "severity": "Low",
            "department": "Electrical Engineering Department",
            "assigned_authority": {
                "authority_id": "AUTH-DNCC",
                "authority_name": "Dhaka North City Corporation",
                "short_code": "DNCC",
                "department": "Electrical Engineering Department",
                "routing_status": "assigned",
            },
            "image_url": "/uploads/dncc_before_1.jpg",
            "status": "In Progress",
            "created_at": ts,
            "updated_at": ts,
            "status_history": [{"status": "Assigned", "at": ts}],
        }

        await civic_repo.insert_one("complaints", ccc_1)
        await civic_repo.insert_one("complaints", ccc_2)
        await civic_repo.insert_one("complaints", dncc_1)

        upload_dir = upload_directory()
        upload_dir.mkdir(parents=True, exist_ok=True)
        (upload_dir / "ccc_before_1.jpg").write_bytes(make_test_image())
        (upload_dir / "ccc_before_2.jpg").write_bytes(make_test_image())
        (upload_dir / "dncc_before_1.jpg").write_bytes(make_test_image())

    asyncio.run(_seed())


def login_officer(client: TestClient, username: str) -> dict[str, str]:
    resp = client.post("/api/auth/demo-officer-login", json={"username": username})
    assert resp.status_code == 200
    csrf = resp.json().get("csrf_token", "")
    return {"x-csrf-token": csrf}


def login_admin(client: TestClient) -> dict[str, str]:
    resp = client.post("/api/auth/login", json={"email": "admin", "password": settings.admin_password})
    assert resp.status_code == 200
    csrf = resp.json().get("csrf_token", "")
    return {"x-csrf-token": csrf}


def test_work_history_strictly_scoped_by_authority():
    """Verify that officers only receive tasks belonging to their authority."""
    seed_accountability_test_data()
    client = TestClient(app)
    headers = login_officer(client, "officer.ccc")

    resp = client.get("/api/operations/work-history", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert "stats" in data

    # All returned items must belong to AUTH-CCC
    item_ids = [item["id"] for item in data["items"]]
    assert "CP-CCC-ACC-01" in item_ids
    assert "CP-CCC-ACC-02" in item_ids
    assert "CP-DNCC-ACC-01" not in item_ids


def test_work_history_completed_tasks_never_disappear():
    """Verify that when a task is Resolved, it remains permanently accessible in work history."""
    seed_accountability_test_data()
    client = TestClient(app)
    ccc_headers = login_officer(client, "officer.ccc")

    # Upload evidence to move CP-CCC-ACC-01 to Evidence Uploaded
    img_bytes = make_test_image(color=(10, 150, 220))
    resp_upload = client.post(
        "/api/complaints/CP-CCC-ACC-01/evidence/upload",
        headers=ccc_headers,
        data={"completion_note": "Asphalt laid and roller compacted."},
        files={"image": ("proof.jpg", img_bytes, "image/jpeg")},
    )
    assert resp_upload.status_code == 200

    # Admin verifies and approves the work -> Resolved
    admin_headers = login_admin(client)
    resp_verify = client.post(
        "/api/operations/verify/CP-CCC-ACC-01",
        headers=admin_headers,
        json={"action": "approve", "note": "Verified by municipal chief engineer."},
    )
    assert resp_verify.status_code == 200
    assert resp_verify.json()["status"] == "Resolved"

    # CCC officer checks work history - Resolved task MUST STILL BE RETURNED!
    resp_hist = client.get("/api/operations/work-history", headers=ccc_headers)
    assert resp_hist.status_code == 200
    history_items = resp_hist.json()["items"]
    resolved_item = next((i for i in history_items if i["id"] == "CP-CCC-ACC-01"), None)
    assert resolved_item is not None
    assert resolved_item["status"] == "Resolved"
    assert resolved_item["admin_verified"] is True
    assert resolved_item["work_completed_at"] is not None

    # Stats should record verified: 1
    assert resp_hist.json()["stats"]["verified"] >= 1


def test_evidence_versioning_and_superseding():
    """Verify that uploading replacement evidence appends new immutable versions."""
    seed_accountability_test_data()
    client = TestClient(app)
    headers = login_officer(client, "officer.ccc")

    # 1. Upload initial evidence (Version 1)
    img1 = make_test_image(color=(50, 50, 50))
    resp1 = client.post(
        "/api/complaints/CP-CCC-ACC-01/evidence/upload",
        headers=headers,
        data={"completion_note": "Initial patch completed."},
        files={"image": ("v1.jpg", img1, "image/jpeg")},
    )
    assert resp1.status_code == 200
    c1 = resp1.json()
    assert len(c1.get("evidence_versions", [])) == 1
    assert c1["evidence_versions"][0]["version"] == 1
    assert c1["evidence_versions"][0]["completion_note"] == "Initial patch completed."
    assert c1["status"] == "Evidence Uploaded"

    # 2. Upload replacement evidence (Version 2)
    img2 = make_test_image(color=(70, 70, 70))
    resp2 = client.post(
        "/api/complaints/CP-CCC-ACC-01/evidence/upload",
        headers=headers,
        data={"completion_note": "Replacement patch with high-grade bitumen."},
        files={"image": ("v2.jpg", img2, "image/jpeg")},
    )
    assert resp2.status_code == 200
    c2 = resp2.json()
    versions = c2.get("evidence_versions", [])
    assert len(versions) == 2
    assert versions[0]["version"] == 1
    assert versions[0]["verification_status"] == "superseded"
    assert versions[1]["version"] == 2
    assert versions[1]["completion_note"] == "Replacement patch with high-grade bitumen."
    assert versions[1]["verification_status"] == "pending"


def test_edit_evidence_note_endpoint():
    """Verify PATCH /api/complaints/{id}/evidence/note updates note and audit trail."""
    seed_accountability_test_data()
    client = TestClient(app)
    headers = login_officer(client, "officer.ccc")

    # Upload evidence first
    img = make_test_image()
    client.post(
        "/api/complaints/CP-CCC-ACC-01/evidence/upload",
        headers=headers,
        data={"completion_note": "Original note."},
        files={"image": ("proof.jpg", img, "image/jpeg")},
    )

    # Edit note
    resp = client.patch(
        "/api/complaints/CP-CCC-ACC-01/evidence/note",
        headers=headers,
        json={"completion_note": "Updated detailed field notes after compaction testing."},
    )
    assert resp.status_code == 200
    updated = resp.json()
    assert updated["resolution_evidence"]["completion_note"] == "Updated detailed field notes after compaction testing."

    # Check audit log
    audit_events = civic_repo.memory["audit_events"]
    note_events = [e for e in audit_events if e.get("action") == "evidence_note_updated" and e.get("entity_id") == "CP-CCC-ACC-01"]
    assert len(note_events) > 0


def test_admin_verification_queue_and_rejection_with_mandatory_note():
    """Verify admin verification queue, mandatory rejection note, and correction lifecycle."""
    seed_accountability_test_data()
    client = TestClient(app)
    ccc_headers = login_officer(client, "officer.ccc")

    # Submit evidence
    img = make_test_image()
    client.post(
        "/api/complaints/CP-CCC-ACC-01/evidence/upload",
        headers=ccc_headers,
        data={"completion_note": "Completed repair."},
        files={"image": ("proof.jpg", img, "image/jpeg")},
    )

    admin_headers = login_admin(client)

    # 1. Check admin verification queue
    queue_resp = client.get("/api/operations/verification-queue?status=pending", headers=admin_headers)
    assert queue_resp.status_code == 200
    queue_data = queue_resp.json()
    assert queue_data["stats"]["pending_count"] >= 1
    assert any(i["id"] == "CP-CCC-ACC-01" for i in queue_data["items"])

    # 2. Reject without note -> Must fail with 422
    fail_resp = client.post(
        "/api/operations/verify/CP-CCC-ACC-01",
        headers=admin_headers,
        json={"action": "reject", "note": ""},
    )
    assert fail_resp.status_code in {400, 422}

    # 3. Reject with valid reason
    rej_resp = client.post(
        "/api/operations/verify/CP-CCC-ACC-01",
        headers=admin_headers,
        json={"action": "reject", "note": "Water ponding visible. Re-level and seal surface edges."},
    )
    assert rej_resp.status_code == 200
    rej_data = rej_resp.json()
    assert rej_data["status"] == "Rejected"
    assert rej_data["rejection_reason"] == "Water ponding visible. Re-level and seal surface edges."

    # 4. Officer views work history -> Sees Rejected item with admin feedback
    hist_resp = client.get("/api/operations/work-history", headers=ccc_headers)
    rej_item = next(i for i in hist_resp.json()["items"] if i["id"] == "CP-CCC-ACC-01")
    assert rej_item["status"] == "Rejected"
    assert rej_item["rejection_reason"] is not None

    # 5. Officer logs back in and resubmits corrected evidence -> Transitions back to Evidence Uploaded
    ccc_headers = login_officer(client, "officer.ccc")
    corrected_img = make_test_image(color=(100, 200, 100))
    resubmit_resp = client.post(
        "/api/complaints/CP-CCC-ACC-01/evidence/upload",
        headers=ccc_headers,
        data={"completion_note": "Corrected surface leveling and edge seals applied."},
        files={"image": ("corrected.jpg", corrected_img, "image/jpeg")},
    )
    assert resubmit_resp.status_code == 200
    resub_data = resubmit_resp.json()
    assert resub_data["status"] == "Evidence Uploaded"
    assert len(resub_data["evidence_versions"]) == 2
    assert resub_data["rejection_reason"] is None


def test_public_tracking_privacy_shields_unverified_evidence():
    """Verify that unverified or rejected evidence is shielded from unauthenticated public tracking."""
    seed_accountability_test_data()
    client = TestClient(app)
    ccc_headers = login_officer(client, "officer.ccc")

    # Officer uploads evidence (unverified state: Evidence Uploaded)
    img = make_test_image()
    client.post(
        "/api/complaints/CP-CCC-ACC-01/evidence/upload",
        headers=ccc_headers,
        data={"completion_note": "Awaiting verification proof."},
        files={"image": ("proof.jpg", img, "image/jpeg")},
    )

    # Public unauthenticated user tracks complaint
    public_resp = client.get("/api/complaints/CP-CCC-ACC-01")
    assert public_resp.status_code == 200
    public_data = public_resp.json()
    # Unverified evidence photo must NOT be exposed to public
    assert public_data.get("after_image_url") is None
    assert public_data.get("resolution_evidence") is None

    # Now Admin approves the work
    admin_headers = login_admin(client)
    client.post(
        "/api/operations/verify/CP-CCC-ACC-01",
        headers=admin_headers,
        json={"action": "approve", "note": "Verified clean repair."},
    )

    # Public unauthenticated user tracks verified complaint
    verified_resp = client.get("/api/complaints/CP-CCC-ACC-01")
    assert verified_resp.status_code == 200
    verified_data = verified_resp.json()
    # Verified evidence photo and verification details must NOW be visible
    assert verified_data.get("after_image_url") is not None
    assert verified_data.get("verification_status") == "Verified"
    assert verified_data.get("work_completed_at") is not None
