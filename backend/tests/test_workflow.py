from datetime import datetime, timezone
import asyncio
import base64
import json

from app.services.priority import calculate_priority
from app.services.workflow import duplicate_assessment, find_duplicate_incident, requires_review, sla_state
from app.services.ai.gemini import analyze_complaint
from app.core.config import settings
from app.services.lifecycle import InvalidTransition, validate_transition
import pytest


def test_priority_is_bounded_and_explainable():
    score, breakdown = calculate_priority(
        "Critical",
        duplicate_count=20,
        affected_count=20,
        location_impact=20,
        waiting_hours=100,
        safety_flag=True,
    )
    assert score == 100
    assert set(breakdown) == {
        "severity",
        "duplicates_and_affected",
        "age",
        "location_impact",
        "critical_safety",
    }


def test_low_confidence_requires_review():
    needs_review, reason = requires_review(
        {"confidence": 0.4, "multi_issue_detected": False},
        {"image_quality": "usable", "location": {"area": "Main Market"}},
    )
    assert needs_review is True
    assert "confidence" in reason.lower()


def test_uncertain_duplicate_is_scored_but_not_silently_merged():
    existing = [{
        "category": "Road Infrastructure",
        "description": "Large pothole outside market",
        "location": {"area": "Block C"},
    }]
    duplicate = find_duplicate_incident(
        {"description": "Another pothole", "location": {"area": "Block C"}},
        {"category": "Road Infrastructure"},
        existing,
    )
    assessment = duplicate_assessment(
        {"description": "Another pothole", "location": {"area": "Block C"}},
        {"category": "Road Infrastructure"}, existing,
    )
    assert duplicate is None
    assert assessment["complaint"] is existing[0]
    assert 0 < assessment["confidence"] < 0.82


def test_sla_state_is_timezone_safe():
    result = sla_state(datetime.now(timezone.utc), 120)
    assert result["sla_status"] == "On Track"
    assert "remaining" in result["sla_remaining_label"]


def test_progress_cannot_repeat_or_skip_required_steps():
    with pytest.raises(InvalidTransition, match="already In Progress"):
        validate_transition({"status": "In Progress"}, "In Progress")
    with pytest.raises(InvalidTransition, match="Cannot move complaint"):
        validate_transition({"status": "In Progress"}, "Resolved")
    validate_transition({"status": "In Progress"}, "Resolution Submitted")


def test_gemini_receives_inline_image_bytes(monkeypatch):
    captured = {}

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            result = {
                "category": "Road Infrastructure", "severity": "Critical", "confidence": 0.97,
                "summary": "Open manhole", "reasoning": "Immediate public safety hazard",
                "safety_flag": True, "multi_issue_detected": False, "is_civic_issue": True,
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
            captured.update(kwargs["json"])
            return FakeResponse()

    monkeypatch.setattr("app.services.ai.gemini.httpx.AsyncClient", FakeClient)
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    image = b"fake-jpeg-content"
    result = asyncio.run(analyze_complaint(
        "No caption provided", category_hint="Let AI decide",
        image_bytes=image, image_mime_type="image/jpeg",
    ))
    part = captured["contents"][0]["parts"][0]["inlineData"]
    assert base64.b64decode(part["data"]) == image
    assert part["mimeType"] == "image/jpeg"
    assert result["analysis_source"] == "gemini-vision"
