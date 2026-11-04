from io import BytesIO
import pytest
from fastapi import UploadFile
from fastapi.testclient import TestClient

from PIL import Image
from app.core.config import settings, upload_directory
from app.db.repository import civic_repo


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
        "report_owners": [],
        "audit_logs": [],
        "idempotency_keys": [],
    }
from app.main import app
from app.services.storage.cloudinary import (
    get_cloudinary_config,
    cloudinary_configured,
    record_storage_error,
    reset_storage_error,
    get_last_storage_error,
    create_signed_evidence_url,
    verify_evidence_signature,
    store_upload,
)
from app.services.reporter_access import create_reporter_access


@pytest.fixture(autouse=True)
def clean_storage_state():
    reset_storage_error()
    yield
    reset_storage_error()


def test_cloudinary_config_parsing_from_parts(monkeypatch):
    monkeypatch.setattr(settings, "cloudinary_url", None)
    monkeypatch.setattr(settings, "cloudinary_cloud_name", "test-cloud")
    monkeypatch.setattr(settings, "cloudinary_api_key", "123456789")
    monkeypatch.setattr(settings, "cloudinary_api_secret", "secret-xyz")

    config = get_cloudinary_config()
    assert config is not None
    assert config["cloud_name"] == "test-cloud"
    assert config["api_key"] == "123456789"
    assert config["api_secret"] == "secret-xyz"
    assert cloudinary_configured() is True


def test_cloudinary_config_parsing_from_url(monkeypatch):
    monkeypatch.setattr(settings, "cloudinary_cloud_name", None)
    monkeypatch.setattr(settings, "cloudinary_api_key", None)
    monkeypatch.setattr(settings, "cloudinary_api_secret", None)
    monkeypatch.setattr(settings, "cloudinary_url", "cloudinary://987654321:my_secret_token@my_cloud_name")

    config = get_cloudinary_config()
    assert config is not None
    assert config["cloud_name"] == "my_cloud_name"
    assert config["api_key"] == "987654321"
    assert config["api_secret"] == "my_secret_token"
    assert cloudinary_configured() is True


def test_cloudinary_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "cloudinary_url", None)
    monkeypatch.setattr(settings, "cloudinary_cloud_name", None)
    monkeypatch.setattr(settings, "cloudinary_api_key", None)
    monkeypatch.setattr(settings, "cloudinary_api_secret", None)

    assert get_cloudinary_config() is None
    assert cloudinary_configured() is False


def test_health_reports_storage_error_fallback(monkeypatch):
    reset_memory_repository()
    civic_repo.use_memory = False
    civic_repo.connection_error = False

    monkeypatch.setattr(settings, "cloudinary_cloud_name", "test-cloud")
    monkeypatch.setattr(settings, "cloudinary_api_key", "123")
    monkeypatch.setattr(settings, "cloudinary_api_secret", "secret")

    with TestClient(app) as client:
        # Before error: configured
        h1 = client.get("/api/health").json()
        assert h1["storage"] == "cloudinary-configured"
        assert h1.get("storage_error") is None

        # Record error (simulating signature failure)
        record_storage_error("SignatureMismatch")
        h2 = client.get("/api/health").json()
        assert h2["storage"] == "cloudinary-error-fallback"
        assert h2["storage_error"] == "SignatureMismatch"
        assert h2["status"] == "degraded"

        sh = client.get("/api/system-health").json()
        assert sh["storage"]["status"] == "degraded"
        assert sh["storage"]["error"] == "SignatureMismatch"

        # After reset
        reset_storage_error()
        h3 = client.get("/api/health").json()
        assert h3["storage"] == "cloudinary-configured"
        assert h3.get("storage_error") is None


def test_production_upload_failure_handling(monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "cloudinary_url", None)
    monkeypatch.setattr(settings, "cloudinary_cloud_name", None)

    # 1. Unconfigured in production raises 503
    buf = BytesIO()
    Image.new("RGB", (10, 10), color="blue").save(buf, format="JPEG")
    valid_bytes = buf.getvalue()

    dummy_file = UploadFile(filename="test.jpg", file=BytesIO(valid_bytes), headers={"content-type": "image/jpeg"})
    import asyncio
    with pytest.raises(Exception) as excinfo:
        asyncio.run(store_upload(dummy_file))
    assert excinfo.value.status_code == 503


def test_secure_tracking_authorization_and_image_signing(monkeypatch):
    reset_memory_repository()

    async def connect():
        reset_memory_repository()

    async def seed():
        return None

    monkeypatch.setattr(civic_repo, "connect", connect)
    monkeypatch.setattr(civic_repo, "ensure_demo_data", seed)

    # Create dummy local upload file on disk
    upload_root = upload_directory()
    upload_root.mkdir(parents=True, exist_ok=True)
    test_img_path = upload_root / "evidence_test.jpg"
    buf = BytesIO()
    Image.new("RGB", (20, 20), color="green").save(buf, format="JPEG")
    test_img_path.write_bytes(buf.getvalue())

    with TestClient(app) as client:
        # Create a complaint
        resp = client.post("/api/complaints", json={
            "description": "Exposed high voltage wiring near children park",
            "location": {"area": "Dhanmondi", "latitude": 23.74, "longitude": 90.37},
            "image_url": "/uploads/evidence_test.jpg",
            "image_quality": "usable",
            "reporter_contact": "01711223344",
        })
        assert resp.status_code == 200
        created = resp.json()
        cid = created["complaint_id"]
        token = created.get("reporter_verification_token")
        assert token is not None

        # 1. Anonymous direct access to /uploads/evidence_test.jpg receives 403
        anon_img = client.get("/uploads/evidence_test.jpg")
        assert anon_img.status_code == 403
        assert "Unauthorized" in anon_img.json()["detail"]

        # 2. Anonymous tracking request receives complaint without private raw upload URL
        anon_track = client.get(f"/api/track/{cid}").json()
        assert anon_track["complaint_id"] == cid
        assert anon_track["complaint"]["image_url"] is None

        # 3. Authorized tracking request (with reporter token) receives signed image URL
        auth_track = client.get(f"/api/track/{cid}?token={token}").json()
        signed_url = auth_track["complaint"]["image_url"]
        assert signed_url is not None
        assert "sig=" in signed_url
        assert "exp=" in signed_url
        assert f"cid={cid}" in signed_url

        # 4. Loading the signed image URL succeeds (200)
        img_resp = client.get(signed_url)
        assert img_resp.status_code == 200

        # 5. Accessing with reporter token directly in query or header succeeds (200)
        token_img = client.get(f"/uploads/evidence_test.jpg?token={token}")
        assert token_img.status_code == 200

        header_img = client.get("/uploads/evidence_test.jpg", headers={"x-reporter-token": token})
        assert header_img.status_code == 200

        # 6. Forged or expired HMAC signature fails (403)
        bad_sig_url = f"/uploads/evidence_test.jpg?cid={cid}&exp=1999999999&sig=tampered_signature"
        bad_sig_resp = client.get(bad_sig_url)
        assert bad_sig_resp.status_code == 403
