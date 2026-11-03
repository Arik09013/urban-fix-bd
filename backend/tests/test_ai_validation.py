import asyncio
import base64
import json
import logging
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image
import pytest

from app.core.config import settings
from app.db.repository import civic_repo
from app.main import app
from app.services.ai.gemini import analyze_complaint, _fallback_analysis, _optimize_image_for_ai
from app.services.workflow import requires_review


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


def _create_test_image(format="JPEG", color="gray"):
    image = Image.new("RGB", (32, 32), color)
    output = BytesIO()
    image.save(output, format=format)
    return output.getvalue()


def test_roadside_garbage_image_classification(monkeypatch):
    """1. Valid roadside garbage image classification."""
    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            result = {
                "category": "Waste Management",
                "severity": "High",
                "confidence": 0.94,
                "department": "Sanitation Department",
                "summary": "Large pile of unmanaged solid waste dumped along roadside.",
                "reasoning": "Visible roadside garbage pile posing sanitation and mobility hazard.",
                "safety_flag": False,
                "multi_issue_detected": False,
                "is_civic_issue": True,
                "detected_language": "English",
                "citizen_response": "Your waste management report has been logged for municipal cleanup.",
            }
            return {"candidates": [{"content": {"parts": [{"text": json.dumps(result)}]}}]}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, endpoint, **kwargs):
            return FakeResponse()

    monkeypatch.setattr("app.services.ai.gemini.httpx.AsyncClient", FakeClient)
    monkeypatch.setattr(settings, "gemini_api_key", "test-secret-key-123")

    image = _create_test_image()
    analysis = asyncio.run(analyze_complaint(
        "Large roadside garbage dumping",
        category_hint="Waste Management",
        image_bytes=image,
        image_mime_type="image/jpeg",
    ))

    assert analysis["is_civic_issue"] is True
    assert analysis["category"] == "Waste Management"
    assert analysis["department"] == "Sanitation Department"
    assert analysis["visual_verification"] == "verified"
    assert analysis["confidence"] >= 0.80


def test_garbage_with_food_packaging_not_rejected(monkeypatch):
    """2. Garbage image with plastic/food waste is not rejected as food/personal objects."""
    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            result = {
                "category": "Waste Management",
                "severity": "Medium",
                "confidence": 0.89,
                "department": "Sanitation Department",
                "summary": "Accumulation of discarded food containers, plastic bottles and refuse.",
                "reasoning": "Commercial and household packaging dumped in public space constitutes unmanaged solid waste.",
                "safety_flag": False,
                "multi_issue_detected": False,
                "is_civic_issue": True,
                "detected_language": "English",
                "citizen_response": "Thank you for reporting this sanitation issue.",
            }
            return {"candidates": [{"content": {"parts": [{"text": json.dumps(result)}]}}]}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, endpoint, **kwargs):
            return FakeResponse()

    monkeypatch.setattr("app.services.ai.gemini.httpx.AsyncClient", FakeClient)
    monkeypatch.setattr(settings, "gemini_api_key", "test-secret-key-123")

    image = _create_test_image()
    analysis = asyncio.run(analyze_complaint(
        "Plastic containers and litter dumped on sidewalk",
        category_hint="Let AI decide",
        image_bytes=image,
        image_mime_type="image/jpeg",
    ))

    assert analysis["is_civic_issue"] is True
    assert analysis["category"] == "Waste Management"


def test_low_confidence_civic_image_allowed_to_proceed():
    """3. Low-confidence civic image is not blocked and proceeds to Needs Review."""
    # Under 0.75 confidence, even if is_civic_issue is False, it must NOT be hard-rejected
    analysis = {
        "category": "Other",
        "severity": "Low",
        "confidence": 0.50,
        "is_civic_issue": False,
        "visual_verification": "unverified",
        "analysis_source": "fallback-rules",
    }
    payload = {"image_quality": "usable", "location": {"area": "Dhanmondi, Dhaka"}}

    needs_review, reason = requires_review(analysis, payload)
    assert needs_review is True
    assert "review required" in reason.lower()


def test_fallback_mode_does_not_falsely_claim_visual_verification():
    """4. Fallback mode does not falsely claim visual verification."""
    analysis = _fallback_analysis(
        "Civic issue shown in uploaded evidence",
        category_hint="Let AI decide",
        reason="Gemini API key is not configured",
        has_image=True,
    )

    assert analysis["visual_verification"] == "unverified"
    assert analysis["analysis_source"] == "fallback-rules"
    assert analysis["confidence"] < 0.75  # Crucial: Must be < 0.75 to prevent frontend auto-drop
    assert "Automated visual verification unavailable" in analysis["reasoning"]


def test_gemini_unavailable_results_in_needs_review(monkeypatch):
    """5. Gemini unavailable results in Needs Review status."""
    async def connect():
        reset_memory_repository()

    async def seed():
        return None

    monkeypatch.setattr(civic_repo, "connect", connect)
    monkeypatch.setattr(civic_repo, "ensure_demo_data", seed)
    monkeypatch.setattr(settings, "gemini_api_key", "")  # Empty key = fallback mode

    photo = _create_test_image()

    with TestClient(app) as client:
        # Step 1: /analyze returns fallback analysis without crashing
        preview = client.post(
            "/api/complaints/analyze",
            data={"description": "Civic issue shown in uploaded evidence", "category_hint": "Let AI decide"},
            files={"image": ("waste.jpg", photo, "image/jpeg")},
        )
        assert preview.status_code == 200
        preview_body = preview.json()
        assert preview_body["visual_verification"] == "unverified"

        # Step 2: Submission succeeds and is assigned Needs Review
        created = client.post(
            "/api/complaints/with-image",
            data={
                "description": "Roadside waste accumulation",
                "area": "Mirpur 10, Dhaka",
                "category_hint": "Waste Management",
                "analysis_token": preview_body["analysis_token"],
            },
            files={"image": ("waste.jpg", photo, "image/jpeg")},
        )
        assert created.status_code == 200
        body = created.json()
        assert body["status"] == "Needs Review"
        assert body["department"] == "Needs Review"
        assert body["needs_review"] is True


def test_high_confidence_non_civic_image_is_rejected(monkeypatch):
    """6. High-confidence non-civic image is rejected."""
    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            result = {
                "category": "Other",
                "severity": "Low",
                "confidence": 0.95,
                "department": "Citizen Facilitation Cell",
                "summary": "Portrait selfie photo with no municipal or public concern.",
                "reasoning": "Image is a personal selfie without municipal infrastructure or public defect.",
                "safety_flag": False,
                "multi_issue_detected": False,
                "is_civic_issue": False,
                "detected_language": "English",
                "citizen_response": "This photo does not appear to show a civic issue.",
            }
            return {"candidates": [{"content": {"parts": [{"text": json.dumps(result)}]}}]}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, endpoint, **kwargs):
            return FakeResponse()

    monkeypatch.setattr("app.services.ai.gemini.httpx.AsyncClient", FakeClient)
    monkeypatch.setattr(settings, "gemini_api_key", "test-secret-key-123")

    photo = _create_test_image()

    with TestClient(app) as client:
        response = client.post(
            "/api/complaints/with-image",
            data={
                "description": "My profile picture",
                "area": "Gulshan, Dhaka",
                "category_hint": "Other",
            },
            files={"image": ("selfie.jpg", photo, "image/jpeg")},
        )
        assert response.status_code == 422
        assert "does not show a relevant civic issue" in response.json()["detail"]


def test_mime_spoofing_and_invalid_image_remain_rejected(monkeypatch):
    """7. MIME spoofing and invalid image uploads remain rejected."""
    async def connect():
        reset_memory_repository()

    async def seed():
        return None

    monkeypatch.setattr(civic_repo, "connect", connect)
    monkeypatch.setattr(civic_repo, "ensure_demo_data", seed)

    with TestClient(app) as client:
        # Invalid MIME
        res1 = client.post(
            "/api/complaints/analyze",
            data={"description": "Test"},
            files={"image": ("script.sh", b"echo hello", "text/x-shellscript")},
        )
        assert res1.status_code == 415

        # Spoofed MIME (text content labeled as image/jpeg)
        res2 = client.post(
            "/api/complaints/with-image",
            data={"description": "Spoofed file", "area": "Uttara, Dhaka"},
            files={"image": ("fake.jpg", b"NOT AN IMAGE", "image/jpeg")},
        )
        assert res2.status_code in {400, 415}


def test_existing_workflow_and_submission_remain_functional(monkeypatch):
    """8. Existing complaint submission and workflow remain functional."""
    async def connect():
        reset_memory_repository()

    async def seed():
        return None

    monkeypatch.setattr(civic_repo, "connect", connect)
    monkeypatch.setattr(civic_repo, "ensure_demo_data", seed)

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            result = {
                "category": "Road Infrastructure",
                "severity": "High",
                "confidence": 0.95,
                "department": "Roads Department",
                "summary": "Large pothole in road lane.",
                "reasoning": "Damaged asphalt on roadway.",
                "safety_flag": False,
                "multi_issue_detected": False,
                "is_civic_issue": True,
                "detected_language": "English",
                "citizen_response": "Your road report has been received.",
            }
            return {"candidates": [{"content": {"parts": [{"text": json.dumps(result)}]}}]}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, endpoint, **kwargs):
            return FakeResponse()

    monkeypatch.setattr("app.services.ai.gemini.httpx.AsyncClient", FakeClient)
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")

    photo = _create_test_image()

    with TestClient(app) as client:
        created = client.post(
            "/api/complaints/with-image",
            data={
                "description": "Large pothole in roadway",
                "area": "Banani, Dhaka",
                "category_hint": "Road Infrastructure",
            },
            files={"image": ("road.jpg", photo, "image/jpeg")},
        )
        assert created.status_code == 200
        data = created.json()
        assert data["category"] == "Road Infrastructure"
        assert data["ai_department"] == "Roads Department"
        assert data["department"] in {"Roads Department", "Civil Engineering Department"}


def test_api_key_is_never_included_in_logs_or_errors(monkeypatch, caplog):
    """9. API key is never included in logs or error messages upon API failure."""
    SECRET_KEY = "AIzaSySecretApiKey123456789"

    class FailingClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, endpoint, **kwargs):
            import httpx
            request = httpx.Request("POST", endpoint)
            raise httpx.HTTPStatusError("Invalid API key", request=request, response=httpx.Response(400, request=request))

    monkeypatch.setattr("app.services.ai.gemini.httpx.AsyncClient", FailingClient)
    monkeypatch.setattr(settings, "gemini_api_key", SECRET_KEY)

    with caplog.at_level(logging.ERROR):
        analysis = asyncio.run(analyze_complaint("Pothole on main road", image_bytes=_create_test_image()))

    # Verify fallback executed
    assert analysis["analysis_source"] == "fallback-rules"
    assert analysis["analysis_warning"] == "invalid-request"

    # Verify secret key is absent from analysis result and logs
    assert SECRET_KEY not in json.dumps(analysis)
    for record in caplog.records:
        assert SECRET_KEY not in record.message


def test_runtime_model_configuration_is_gemini_3_5_flash_lite():
    """10. Verify runtime model configuration defaults to gemini-3.5-flash-lite."""
    assert settings.gemini_model == "gemini-3.5-flash-lite"


def test_large_image_is_resized_and_aspect_ratio_preserved():
    """11. Verify large images (>1600px) are downscaled preserving aspect ratio."""
    orig_w, orig_h = 2400, 1800
    large_img = Image.new("RGB", (orig_w, orig_h), "orange")
    buf = BytesIO()
    large_img.save(buf, format="JPEG")
    input_bytes = buf.getvalue()

    optimized_bytes, mime = _optimize_image_for_ai(input_bytes, "image/jpeg", max_dimension=1600)
    assert mime == "image/jpeg"
    assert len(optimized_bytes) < len(input_bytes)

    with Image.open(BytesIO(optimized_bytes)) as result_img:
        new_w, new_h = result_img.size
        assert new_w <= 1600
        assert new_h <= 1600
        # Aspect ratio 2400 / 1800 = 1.3333... => 1600 / 1200
        assert new_w == 1600
        assert new_h == 1200
        assert abs((new_w / new_h) - (orig_w / orig_h)) < 0.01


def test_original_image_bytes_remain_unchanged():
    """12. Verify original image bytes remain completely untouched after optimization."""
    orig_bytes = _create_test_image()
    bytes_copy = bytes(orig_bytes)

    optimized_bytes, _ = _optimize_image_for_ai(orig_bytes, "image/jpeg")
    assert orig_bytes == bytes_copy


def test_exif_orientation_handling():
    """13. Verify EXIF orientation tags are handled (transposed) properly."""
    # Create image with width 200, height 100, and EXIF orientation 6 (rotate 90 CW)
    img = Image.new("RGB", (200, 100), "blue")
    exif = img.getexif()
    exif[0x0112] = 6
    buf = BytesIO()
    img.save(buf, format="JPEG", exif=exif)
    input_bytes = buf.getvalue()

    optimized_bytes, mime = _optimize_image_for_ai(input_bytes, "image/jpeg")
    assert mime == "image/jpeg"

    with Image.open(BytesIO(optimized_bytes)) as result_img:
        # Transposed 90 CW turns 200x100 into 100x200
        assert result_img.size == (100, 200)


def test_image_optimization_supports_png_and_webp():
    """14. Verify optimization handles RGBA PNG and WebP images gracefully."""
    # PNG with alpha
    png_img = Image.new("RGBA", (150, 120), (255, 0, 0, 128))
    png_buf = BytesIO()
    png_img.save(png_buf, format="PNG")
    png_bytes, png_mime = _optimize_image_for_ai(png_buf.getvalue(), "image/png")
    assert png_mime == "image/jpeg"
    with Image.open(BytesIO(png_bytes)) as res_png:
        assert res_png.format == "JPEG"
        assert res_png.size == (150, 120)

    # WebP
    webp_img = Image.new("RGB", (180, 90), "green")
    webp_buf = BytesIO()
    webp_img.save(webp_buf, format="WEBP")
    webp_bytes, webp_mime = _optimize_image_for_ai(webp_buf.getvalue(), "image/webp")
    assert webp_mime == "image/jpeg"
    with Image.open(BytesIO(webp_bytes)) as res_webp:
        assert res_webp.format == "JPEG"
        assert res_webp.size == (180, 90)


def test_first_timeout_followed_by_successful_retry(monkeypatch):
    """15. Verify transient timeout on 1st attempt retries and succeeds on 2nd attempt."""
    call_count = 0

    class TransientTimeoutClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, endpoint, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                import httpx
                raise httpx.ReadTimeout("Timed out on attempt 1", request=httpx.Request("POST", endpoint))

            result = {
                "category": "Waste Management",
                "severity": "Medium",
                "confidence": 0.90,
                "department": "Sanitation Department",
                "summary": "Garbage pile cleared on retry.",
                "reasoning": "Visible municipal waste.",
                "safety_flag": False,
                "multi_issue_detected": False,
                "is_civic_issue": True,
                "detected_language": "English",
                "citizen_response": "Thank you for reporting.",
            }
            class SuccessResponse:
                status_code = 200
                def raise_for_status(self):
                    return None
                def json(self):
                    return {"candidates": [{"content": {"parts": [{"text": json.dumps(result)}]}}]}
            return SuccessResponse()

    async def _mock_sleep(seconds):
        return None

    monkeypatch.setattr("app.services.ai.gemini.httpx.AsyncClient", TransientTimeoutClient)
    monkeypatch.setattr(settings, "gemini_api_key", "test-key-retry")
    monkeypatch.setattr(asyncio, "sleep", _mock_sleep)

    analysis = asyncio.run(analyze_complaint("Piled garbage", image_bytes=_create_test_image()))
    assert call_count == 2
    assert analysis["analysis_source"] == "gemini-vision"
    assert analysis["category"] == "Waste Management"
    assert analysis["confidence"] == 0.90


def test_repeated_timeout_triggers_fallback(monkeypatch):
    """16. Verify repeated timeout triggers fallback rules with gemini-timeout warning."""
    call_count = 0

    class PersistentTimeoutClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, endpoint, **kwargs):
            nonlocal call_count
            call_count += 1
            import httpx
            raise httpx.ReadTimeout(f"Timed out on attempt {call_count}", request=httpx.Request("POST", endpoint))

    async def _mock_sleep(seconds):
        return None

    monkeypatch.setattr("app.services.ai.gemini.httpx.AsyncClient", PersistentTimeoutClient)
    monkeypatch.setattr(settings, "gemini_api_key", "test-key-timeout")
    monkeypatch.setattr(asyncio, "sleep", _mock_sleep)

    analysis = asyncio.run(analyze_complaint("Piled garbage on street", image_bytes=_create_test_image()))
    assert call_count == 2  # Max attempts is 2
    assert analysis["analysis_source"] == "fallback-rules"
    assert analysis["analysis_warning"] == "gemini-timeout"
    assert analysis["visual_verification"] == "unverified"


def test_http_401_does_not_retry(monkeypatch):
    """17. Verify permanent HTTP 401 client error does not retry and logs auth-failure."""
    call_count = 0

    class UnauthorizedClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, endpoint, **kwargs):
            nonlocal call_count
            call_count += 1
            import httpx
            req = httpx.Request("POST", endpoint)
            resp = httpx.Response(401, request=req)
            return resp

    monkeypatch.setattr("app.services.ai.gemini.httpx.AsyncClient", UnauthorizedClient)
    monkeypatch.setattr(settings, "gemini_api_key", "bad-key")

    analysis = asyncio.run(analyze_complaint("Broken pavement", image_bytes=_create_test_image()))
    assert call_count == 1  # No retry on 401
    assert analysis["analysis_source"] == "fallback-rules"
    assert analysis["analysis_warning"] == "auth-failure"


def test_http_429_retries_once(monkeypatch):
    """18. Verify transient HTTP 429 rate limit retries once before succeeding."""
    call_count = 0

    class RateLimitedClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, endpoint, **kwargs):
            nonlocal call_count
            call_count += 1
            import httpx
            req = httpx.Request("POST", endpoint)
            if call_count == 1:
                return httpx.Response(429, request=req)

            result = {
                "category": "Street Lighting",
                "severity": "Medium",
                "confidence": 0.88,
                "department": "Power Department",
                "summary": "Broken street lamp.",
                "reasoning": "Non-functional lamp pole.",
                "safety_flag": False,
                "multi_issue_detected": False,
                "is_civic_issue": True,
                "detected_language": "English",
                "citizen_response": "Report logged.",
            }
            class SuccessResponse:
                status_code = 200
                def raise_for_status(self):
                    return None
                def json(self):
                    return {"candidates": [{"content": {"parts": [{"text": json.dumps(result)}]}}]}
            return SuccessResponse()

    async def _mock_sleep(seconds):
        return None

    monkeypatch.setattr("app.services.ai.gemini.httpx.AsyncClient", RateLimitedClient)
    monkeypatch.setattr(settings, "gemini_api_key", "test-key-429")
    monkeypatch.setattr(asyncio, "sleep", _mock_sleep)

    analysis = asyncio.run(analyze_complaint("Dark street lamp", image_bytes=_create_test_image()))
    assert call_count == 2
    assert analysis["analysis_source"] == "gemini-vision"
    assert analysis["category"] == "Street Lighting"


def test_citizen_description_and_ai_summary_are_stored_distinctly(monkeypatch):
    """19. Verify citizen description and AI summary are preserved and stored distinctly."""
    async def connect():
        reset_memory_repository()

    async def seed():
        return None

    monkeypatch.setattr(civic_repo, "connect", connect)
    monkeypatch.setattr(civic_repo, "ensure_demo_data", seed)

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            result = {
                "category": "Waste Management",
                "severity": "Medium",
                "confidence": 0.92,
                "department": "Sanitation Department",
                "summary": "AI generated summary of roadside waste.",
                "reasoning": "Visible plastic and garbage pile.",
                "safety_flag": False,
                "multi_issue_detected": False,
                "is_civic_issue": True,
                "detected_language": "English",
                "citizen_response": "Thank you for reporting.",
            }
            return {"candidates": [{"content": {"parts": [{"text": json.dumps(result)}]}}]}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, endpoint, **kwargs):
            return FakeResponse()

    monkeypatch.setattr("app.services.ai.gemini.httpx.AsyncClient", FakeClient)
    monkeypatch.setattr(settings, "gemini_api_key", "test-key-distinct")

    photo = _create_test_image()

    with TestClient(app) as client:
        res = client.post(
            "/api/complaints/with-image",
            data={
                "description": "Citizen entered custom wording about trash near gate",
                "area": "Mohakhali DOHS, Dhaka",
                "category_hint": "Waste Management",
            },
            files={"image": ("evidence.jpg", photo, "image/jpeg")},
        )
        assert res.status_code == 200
        data = res.json()
        # Verify citizen description is preserved
        assert data["description"] == "Citizen entered custom wording about trash near gate"
        # Verify AI summary is separately preserved
        assert data["summary"] == "AI generated summary of roadside waste."

