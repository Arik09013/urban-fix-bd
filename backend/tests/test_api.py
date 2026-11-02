from copy import deepcopy
import hashlib
import hmac
import json
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from app.db.repository import civic_repo
from app.main import app


def reset_memory_repository():
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


def admin_login(client):
    response = client.post("/api/auth/login", json={"email": "admin", "password": "admin"})
    assert response.status_code == 200
    return {"X-CSRF-Token": response.json()["csrf_token"]}


def youth_register(client):
    response = client.post("/api/auth/register", json={
        "name": "Ali Youth Team", "email": "ali@example.com",
        "password": "strong-pass-123", "phone": "03001234567",
    })
    assert response.status_code == 200
    return {"X-CSRF-Token": response.json()["csrf_token"]}


def jpeg_with_gps() -> bytes:
    image = Image.new("RGB", (12, 12), "gray")
    exif = Image.Exif()
    exif[36867] = "2026:08:29 12:30:00"
    exif[34853] = {
        1: "N", 2: (31.0, 30.0, 0.0),
        3: "E", 4: (74.0, 20.0, 0.0),
        31: 12.0,
    }
    output = BytesIO()
    image.save(output, format="JPEG", exif=exif)
    return output.getvalue()


def test_photo_location_and_signed_analysis_are_reused(monkeypatch):
    calls = 0

    async def connect():
        reset_memory_repository()

    async def seed():
        return None

    async def fake_analysis(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        return {
            "category": "Road Infrastructure", "severity": "High", "confidence": 0.93,
            "department": "Roads Department", "summary": "Road damage detected.",
            "reasoning": "Visible road damage requires repair.", "safety_flag": False,
            "multi_issue_detected": False, "is_civic_issue": True,
        }

    async def fake_storage(_image):
        return "https://res.cloudinary.com/demo/evidence.jpg"

    monkeypatch.setattr(civic_repo, "connect", connect)
    monkeypatch.setattr(civic_repo, "ensure_demo_data", seed)
    monkeypatch.setattr("app.api.routes.complaints.analyze_complaint", fake_analysis)
    monkeypatch.setattr("app.api.routes.complaints.store_upload", fake_storage)
    photo = jpeg_with_gps()

    with TestClient(app) as client:
        preview = client.post(
            "/api/complaints/analyze",
            data={"description": "Civic issue shown in uploaded evidence", "category_hint": "Let AI decide"},
            files={"image": ("road.jpg", photo, "image/jpeg")},
        )
        assert preview.status_code == 200
        preview_body = preview.json()
        assert preview_body["photo_location"] == {
            "latitude": 31.5, "longitude": 74.3333333, "accuracy_meters": 12.0,
            "captured_at": "2026-08-29T12:30:00", "source": "photo_exif",
        }

        created = client.post(
            "/api/complaints/with-image",
            data={
                "description": "Road damage detected.", "area": "Detected road location",
                "category_hint": "Road Infrastructure", "latitude": "31.5",
                "longitude": "74.3333333", "location_source": "photo_exif",
                "location_confirmed": "true", "location_accuracy_meters": "12",
                "photo_captured_at": "2026-08-29T12:30:00",
                "analysis_token": preview_body["analysis_token"],
            },
            files={"image": ("road.jpg", photo, "image/jpeg")},
        )
        assert created.status_code == 200
        assert calls == 1
        assert created.json()["location"]["source"] == "photo_exif"
        assert created.json()["location"]["confirmed"] is True
        public_location = client.get("/api/complaints").json()["complaints"][0]["location"]
        assert public_location["source"] == "photo_exif"
        assert "accuracy_meters" not in public_location
        assert "captured_at" not in public_location


def test_persisted_mongo_style_session_datetime_is_accepted(monkeypatch):
    async def connect():
        reset_memory_repository()

    async def seed():
        return None

    monkeypatch.setattr(civic_repo, "connect", connect)
    monkeypatch.setattr(civic_repo, "ensure_demo_data", seed)
    with TestClient(app) as client:
        youth_register(client)
        civic_repo.memory["sessions"][0]["expires_at"] = civic_repo.memory["sessions"][0]["expires_at"].replace(tzinfo=None)
        response = client.get("/api/auth/me")
        assert response.status_code == 200
        assert response.json()["email"] == "ali@example.com"


def test_successful_logins_do_not_trigger_failure_rate_limit(monkeypatch):
    async def connect():
        reset_memory_repository()

    async def seed():
        return None

    monkeypatch.setattr(civic_repo, "connect", connect)
    monkeypatch.setattr(civic_repo, "ensure_demo_data", seed)
    with TestClient(app) as client:
        for _ in range(12):
            response = client.post("/api/auth/login", json={"email": "admin", "password": "admin"})
            assert response.status_code == 200


def test_health_and_api_root(monkeypatch):
    async def connect():
        reset_memory_repository()

    async def seed():
        return None

    monkeypatch.setattr(civic_repo, "connect", connect)
    monkeypatch.setattr(civic_repo, "ensure_demo_data", seed)
    with TestClient(app) as client:
        assert client.get("/api").status_code == 200
        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.json()["database"] == "memory-demo"
        homepage = client.get("/")
        assert homepage.status_code == 200
        assert "Report civic problems in Pakistan" in homepage.text
        assert "Sitemap:" in client.get("/robots.txt").text
        sitemap = client.get("/sitemap.xml").text
        assert "<urlset" in sitemap
        assert "/issues/potholes" in sitemap
        for path in ("/how-it-works", "/methodology", "/privacy", "/issues/drainage", "/cities/multan"):
            page = client.get(path)
            assert page.status_code == 200
            assert 'rel="canonical"' in page.text


def test_complaint_create_track_and_dashboard(monkeypatch):
    async def connect():
        reset_memory_repository()

    async def seed():
        return None

    async def fake_analysis(*_args, **_kwargs):
        return {
            "category": "Road Infrastructure",
            "severity": "High",
            "confidence": 0.93,
            "department": "Roads Department",
            "summary": "Pothole affecting traffic.",
            "reasoning": "Road damage requires repair.",
            "safety_flag": False,
            "multi_issue_detected": False,
        }

    monkeypatch.setattr(civic_repo, "connect", connect)
    monkeypatch.setattr(civic_repo, "ensure_demo_data", seed)
    monkeypatch.setattr("app.api.routes.complaints.analyze_complaint", fake_analysis)

    with TestClient(app) as client:
        response = client.post("/api/complaints", json={
            "description": "Large pothole outside the market",
            "location": {"area": "Main Market", "latitude": 31.5, "longitude": 74.3},
            "image_quality": "usable",
        })
        assert response.status_code == 200
        complaint = response.json()
        complaint_id = complaint["complaint_id"]
        assert len(complaint_id) == 9

        tracked = client.get(f"/api/track/{complaint_id}")
        assert tracked.status_code == 200
        assert tracked.json()["complaint_id"] == complaint_id
        assert tracked.json()["complaint"]["description"] == "Large pothole outside the market"
        assert client.get(f"/api/track/{complaint_id.removeprefix('CP-').lower()}").status_code == 200

        assert client.get("/api/dashboard").status_code == 401
        admin_headers = admin_login(client)
        dashboard = client.get("/api/dashboard")
        assert dashboard.status_code == 200
        assert dashboard.json()["stats"]["active_issues"] == 1

        analyzed = client.post(
            "/api/complaints/analyze",
            data={"description": "Large pothole outside the market"},
        )
        assert analyzed.status_code == 200
        assert analyzed.json()["category"] == "Road Infrastructure"

        workspace = client.get(f"/api/operations/incidents/{complaint_id}")
        assert workspace.status_code == 200
        assert workspace.json()["complaint"]["complaint_id"] == complaint_id
        assert workspace.json()["recommended_action"]

        filtered_queue = client.get("/api/operations/queue", params={
            "state": "unresolved", "days": 1, "category": "Road Infrastructure",
            "severity": "High", "search": "Main Market",
        })
        assert filtered_queue.status_code == 200
        assert filtered_queue.json()["count"] == 1
        assert filtered_queue.json()["items"][0]["complaint_id"] == complaint_id


def test_invalid_image_type_is_rejected(monkeypatch):
    async def connect():
        reset_memory_repository()

    async def seed():
        return None

    monkeypatch.setattr(civic_repo, "connect", connect)
    monkeypatch.setattr(civic_repo, "ensure_demo_data", seed)
    with TestClient(app) as client:
        response = client.post(
            "/api/complaints/with-image",
            data={"description": "Broken road", "area": "Main Market"},
            files={"image": ("evidence.txt", b"not an image", "text/plain")},
        )
        assert response.status_code == 415


def test_spoofed_image_mime_is_rejected(monkeypatch):
    async def connect():
        reset_memory_repository()
    async def seed():
        return None
    monkeypatch.setattr(civic_repo, "connect", connect)
    monkeypatch.setattr(civic_repo, "ensure_demo_data", seed)
    with TestClient(app) as client:
        response = client.post(
            "/api/complaints/with-image",
            data={"description": "Broken road", "area": "Main Market"},
            files={"image": ("fake.jpg", b"this is not really a jpeg", "image/jpeg")},
        )
        assert response.status_code == 415


def test_public_list_redacts_private_reporter_fields_and_is_paginated(monkeypatch):
    async def connect():
        reset_memory_repository()
    async def seed():
        return None
    monkeypatch.setattr(civic_repo, "connect", connect)
    monkeypatch.setattr(civic_repo, "ensure_demo_data", seed)
    with TestClient(app) as client:
        civic_repo.memory["complaints"].append({
            "complaint_id": "CP-PRIVATE", "priority_score": 10, "category": "Road Infrastructure",
            "status": "Submitted", "location": {"area": "Block C", "latitude": 31.5204123, "longitude": 74.3587123},
            "reporter_contact": "private@example.com", "source_fingerprint": "secret-device",
        })
        response = client.get("/api/complaints", params={"page": 1, "limit": 1})
        assert response.status_code == 200
        item = response.json()["complaints"][0]
        assert "reporter_contact" not in item and "source_fingerprint" not in item
        assert item["location"]["latitude"] == 31.52
        assert response.json()["pagination"]["total"] == 1


def test_status_machine_and_idempotent_report_creation(monkeypatch):
    async def connect():
        reset_memory_repository()
    async def seed():
        return None
    async def fake_analysis(*_args, **_kwargs):
        return {"category": "Road Infrastructure", "severity": "High", "confidence": .95,
                "department": "Roads Department", "summary": "Road damage", "reasoning": "Visible pothole",
                "safety_flag": False, "multi_issue_detected": False, "is_civic_issue": True}
    monkeypatch.setattr(civic_repo, "connect", connect)
    monkeypatch.setattr(civic_repo, "ensure_demo_data", seed)
    monkeypatch.setattr("app.api.routes.complaints.analyze_complaint", fake_analysis)
    with TestClient(app) as client:
        payload = {"description": "Large unique pothole", "location": {"area": "Unique Road"}}
        first = client.post("/api/complaints", headers={"Idempotency-Key": "report-123"}, json=payload)
        second = client.post("/api/complaints", headers={"Idempotency-Key": "report-123"}, json=payload)
        assert first.json()["complaint_id"] == second.json()["complaint_id"]
        assert len(civic_repo.memory["complaints"]) == 1
        # Manual complaint cleanup must not leave an orphaned idempotency key
        # that prevents the citizen from submitting again.
        civic_repo.memory["complaints"].clear()
        third = client.post("/api/complaints", headers={"Idempotency-Key": "report-123"}, json=payload)
        assert third.status_code == 200
        assert third.json()["complaint_id"] != first.json()["complaint_id"]
        assert len(civic_repo.memory["complaints"]) == 1
        admin_headers = admin_login(client)
        invalid = client.patch(f"/api/complaints/{third.json()['complaint_id']}/status", headers=admin_headers, json={"status": "Resolved"})
        assert invalid.status_code == 409
        assigned = client.patch(f"/api/complaints/{third.json()['complaint_id']}/status", headers=admin_headers, json={"status": "Assigned", "note": "Roads team accepted ownership"})
        assert assigned.status_code == 200
        assert assigned.json()["sla_started_at"] == third.json()["sla_started_at"]
        audit = client.get(f"/api/operations/audit/complaint/{third.json()['complaint_id']}")
        assert audit.status_code == 200
        assert audit.json()["events"][0]["action"] == "status_transition"


def test_dangerous_issue_cannot_be_claimed_by_youth(monkeypatch):
    async def connect():
        reset_memory_repository()
    async def seed():
        return None
    monkeypatch.setattr(civic_repo, "connect", connect)
    monkeypatch.setattr(civic_repo, "ensure_demo_data", seed)
    with TestClient(app) as client:
        civic_repo.memory["complaints"].append({
            "complaint_id": "CP-DANGER", "description": "Exposed live electrical wire",
            "summary": "Electrical danger", "category": "Street Lighting", "severity": "Critical",
            "safety_flag": True, "location": {"area": "School Road"}, "status": "Submitted",
        })
        headers = youth_register(client)
        response = client.post("/api/repair-requests", headers=headers, json={
            "complaint_id": "CP-DANGER", "estimated_price": 1000,
            "plan": "Attempt a dangerous electrical repair without trained workers.", "estimated_hours": 1,
        })
        assert response.status_code == 403
        assert "trained responders" in response.json()["detail"] or "qualified authority" in response.json()["detail"]


def test_signed_whatsapp_webhook_is_idempotent(monkeypatch):
    async def connect():
        reset_memory_repository()
    async def seed():
        return None
    async def fake_analysis(*_args, **_kwargs):
        return {"category": "Waste Management", "severity": "Medium", "confidence": .9,
                "department": "Sanitation Department", "summary": "Waste report", "reasoning": "Visible waste",
                "safety_flag": False, "multi_issue_detected": False, "is_civic_issue": True}
    monkeypatch.setattr(civic_repo, "connect", connect)
    monkeypatch.setattr(civic_repo, "ensure_demo_data", seed)
    monkeypatch.setattr("app.api.routes.complaints.analyze_complaint", fake_analysis)
    monkeypatch.setattr("app.api.routes.whatsapp.settings.whatsapp_webhook_secret", "test-secret")
    raw = json.dumps({"provider_message_id": "wamid-1", "message": "Waste pile near market", "area": "Market"}, separators=(",", ":")).encode()
    signature = "sha256=" + hmac.new(b"test-secret", raw, hashlib.sha256).hexdigest()
    with TestClient(app) as client:
        first = client.post("/api/whatsapp/webhook", content=raw, headers={"Content-Type": "application/json", "X-Hub-Signature-256": signature})
        second = client.post("/api/whatsapp/webhook", content=raw, headers={"Content-Type": "application/json", "X-Hub-Signature-256": signature})
        assert first.status_code == 200 and second.status_code == 200
        assert first.json()["tracking_id"] == second.json()["tracking_id"]
        assert second.json()["duplicate"] is True
        assert len(civic_repo.memory["complaints"]) == 1


def test_community_repair_escrow_requires_proof(monkeypatch):
    async def connect():
        reset_memory_repository()

    async def seed():
        return None

    monkeypatch.setattr(civic_repo, "connect", connect)
    monkeypatch.setattr(civic_repo, "ensure_demo_data", seed)
    with TestClient(app) as client:
        civic_repo.memory["complaints"].append({
            "complaint_id": "CP-ROAD1", "description": "Low-risk litter cleanup", "summary": "Community litter cleanup",
            "category": "Waste Management", "severity": "Low", "location": {"area": "Test Road"}, "status": "Submitted", "status_history": [],
        })
        youth_headers = youth_register(client)
        created = client.post("/api/repair-requests", headers=youth_headers, json={
            "complaint_id": "CP-ROAD1", "applicant_name": "Ali Youth Team",
            "applicant_contact": "03001234567", "estimated_price": 12000,
                "plan": "Collect the litter with gloves and bag it for municipal pickup.", "estimated_hours": 6,
        })
        assert created.status_code == 200
        request_id = created.json()["request_id"]
        assert created.json()["applicant_user_id"]
        duplicate = client.post("/api/repair-requests", headers=youth_headers, json={
            "complaint_id": "CP-ROAD1", "estimated_price": 12500,
                "plan": "Submit the same active cleanup proposal a second time.", "estimated_hours": 7,
        })
        assert duplicate.status_code == 409

        assert client.post(f"/api/repair-requests/{request_id}/release-funds", headers=youth_headers).status_code == 403
        assert client.post("/api/auth/logout", headers=youth_headers).status_code == 200
        relogin = client.post("/api/auth/login", json={"email": "ali@example.com", "password": "strong-pass-123"})
        assert relogin.status_code == 200
        youth_headers = {"X-CSRF-Token": relogin.json()["csrf_token"]}
        own_jobs = client.get("/api/repair-requests")
        assert [job["request_id"] for job in own_jobs.json()["requests"]] == [request_id]

        admin_headers = admin_login(client)
        early_release = client.post(f"/api/repair-requests/{request_id}/release-funds", headers=admin_headers)
        assert early_release.status_code == 400

        approved = client.patch(f"/api/repair-requests/{request_id}/decision", headers=admin_headers, json={
            "approved": True, "approved_budget": 12000,
        })
        assert approved.json()["funds_status"] == "Budget Reserved"

        relogin = client.post("/api/auth/login", json={"email": "ali@example.com", "password": "strong-pass-123"})
        youth_headers = {"X-CSRF-Token": relogin.json()["csrf_token"]}
        proof = client.post(f"/api/repair-requests/{request_id}/proof", headers=youth_headers, json={
            "after_image_url": "https://example.com/fixed.jpg",
                "completion_note": "Litter collected and transferred for municipal pickup.",
        })
        assert proof.status_code == 200

        admin_headers = admin_login(client)
        released = client.post(f"/api/repair-requests/{request_id}/release-funds", headers=admin_headers)
        assert released.status_code == 200
        assert released.json()["funds_status"] == "Released"
        assert released.json()["payment_provider"] == "demo"
        assert released.json()["payment_reference"].startswith("demo-")
        assert civic_repo.memory["complaints"][0]["status"] == "Resolved"
        approvals = civic_repo.memory["complaints"][0]["resolution_approvals"]
        assert approvals == {"contractor": True, "government": True}

        reporter_approval = client.post("/api/complaints/CP-ROAD1/resolution-approval", headers=admin_headers, json={
            "stakeholder": "reporter", "approved": True,
        })
        assert reporter_approval.status_code == 403
        assert civic_repo.memory["complaints"][0]["fully_verified"] is True


def test_private_reporter_verification_resolves_and_receipt_is_public(monkeypatch):
    async def connect(): reset_memory_repository()
    async def seed(): return None
    monkeypatch.setattr(civic_repo, "connect", connect)
    monkeypatch.setattr(civic_repo, "ensure_demo_data", seed)
    with TestClient(app) as client:
        created = client.post("/api/complaints", json={
            "description": "Litter outside the park; call 03001234567",
            "location": {"area": "Test Park"},
            "reporter_contact": "reporter@example.com",
        })
        assert created.status_code == 200
        token = created.json()["reporter_verification_token"]
        complaint = civic_repo.memory["complaints"][0]
        complaint["resolution_evidence"] = {"after_image_url": "/uploads/fixed.jpg"}
        complaint["resolution_approvals"] = {"contractor": True, "government": True}
        verified = client.post(f"/api/complaints/{complaint['complaint_id']}/reporter-verification", json={"token": token, "outcome": "fixed"})
        assert verified.status_code == 200
        assert verified.json()["status"] == "Resolved"
        receipt = client.get(f"/api/track/{complaint['complaint_id']}/receipt")
        assert receipt.status_code == 200
        assert receipt.json()["receipt_hash"].startswith("sha256:")
        assert "03001234567" not in receipt.text
