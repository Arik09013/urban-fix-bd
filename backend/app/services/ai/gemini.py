from __future__ import annotations

import json
import base64
import asyncio
import logging
from typing import Optional
from urllib.parse import quote

import httpx
from pydantic import BaseModel, Field, field_validator

from app.core.config import settings
from app.models.constants import DEPARTMENT_MAP

logger = logging.getLogger(__name__)


class StructuredAnalysis(BaseModel):
    category: str
    severity: str
    confidence: float = Field(ge=0, le=1)
    department: Optional[str] = None
    summary: str = Field(max_length=300)
    reasoning: str = Field(max_length=500)
    safety_flag: bool = False
    multi_issue_detected: bool = False
    is_civic_issue: bool = True
    detected_language: str = "English"
    citizen_response: str = "Your report has been received for civic review."

    @field_validator("safety_flag", "multi_issue_detected", "is_civic_issue", mode="before")
    @classmethod
    def strict_boolean(cls, value):
        if isinstance(value, bool):
            return value
        if isinstance(value, str) and value.strip().lower() in {"true", "false"}:
            return value.strip().lower() == "true"
        raise ValueError("Expected a boolean")


def _language_hint(text: str) -> str:
    if any("\u0600" <= char <= "\u06ff" for char in text):
        return "Urdu"
    roman_markers = {"hai", "hain", "ho", "raha", "rahi", "nahi", "ke", "ka", "ki", "gali", "sadak", "pani"}
    words = {word.strip(".,!?;:").lower() for word in text.split()}
    return "Roman Urdu" if len(words & roman_markers) >= 2 else "English"


def _fallback_analysis(description: str, category_hint: str | None = None, reason: str | None = None) -> dict:
    text = description.lower()
    multi_issue_hits = 0
    if category_hint and category_hint != "Let AI decide":
        category = category_hint
    elif any(word in text for word in ["pothole", "road", "street", "traffic"]):
        category = "Road Infrastructure"
    elif any(word in text for word in ["garbage", "trash", "waste", "dump"]):
        category = "Waste Management"
    elif any(word in text for word in ["water", "leak", "pipe"]):
        category = "Water Supply"
    elif any(word in text for word in ["sewer", "drain", "overflow"]):
        category = "Drainage / Sewerage"
    elif any(word in text for word in ["light", "lamp", "electric"]):
        category = "Street Lighting"
    else:
        category = "Other"

    for words in [
        ["pothole", "road", "street", "traffic"],
        ["garbage", "trash", "waste", "dump"],
        ["water", "leak", "pipe"],
        ["sewer", "drain", "overflow"],
        ["light", "lamp", "electric", "wire"],
    ]:
        if any(word in text for word in words):
            multi_issue_hits += 1

    safety_terms = [
        "exposed wire",
        "exposed electrical wire",
        "electrical wire",
        "electric wire",
        "electric shock",
        "live wire",
        "flooded road",
        "collapse",
        "danger",
    ]
    safety_flag = any(word in text for word in safety_terms)
    if safety_flag or any(word in text for word in ["danger", "overflow", "school", "main road", "blocked"]):
        severity = "Critical"
    elif any(word in text for word in ["large", "bad", "damaged", "leakage", "traffic"]):
        severity = "High"
    elif any(word in text for word in ["small", "minor"]):
        severity = "Low"
    else:
        severity = "Medium"

    confidence = 0.88 if category != "Other" else 0.62
    if any(word in text for word in ["blurry", "dark photo", "unclear", "can't see", "cannot see"]):
        confidence = 0.54

    reasoning = {
        "Critical": "CRITICAL: Possible public safety impact or blocked access requires urgent review.",
        "High": "HIGH: Visible or reported obstruction likely affects mobility, safety, or public service access.",
        "Medium": "MEDIUM: Civic issue needs action but no immediate severe safety signal was detected.",
        "Low": "LOW: Minor civic issue with limited visible impact from current evidence.",
    }[severity]

    language = _language_hint(description)
    citizen_response = {
        "Urdu": "آپ کی رپورٹ موصول ہو گئی ہے اور انسانی جائزے کے لیے بھیج دی گئی ہے۔",
        "Roman Urdu": "Aap ki report mil gayi hai aur insani jaizay ke liye bhej di gayi hai.",
    }.get(language, "Your report has been received and sent for civic review.")
    return {
        "category": category,
        "severity": severity,
        "confidence": confidence,
        "department": DEPARTMENT_MAP.get(category, "Citizen Facilitation Cell"),
        "summary": f"{category} issue reported by citizen and ready for municipal triage.",
        "reasoning": reasoning,
        "safety_flag": safety_flag,
        "multi_issue_detected": multi_issue_hits > 1,
        "is_civic_issue": category != "Other",
        "analysis_source": "fallback-rules",
        "analysis_warning": reason,
        "detected_language": language,
        "citizen_response": citizen_response,
    }


async def analyze_complaint(
    description: str,
    image_url: str | None = None,
    category_hint: str | None = None,
    image_bytes: bytes | None = None,
    image_mime_type: str | None = None,
) -> dict:
    if not settings.gemini_api_key:
        return _fallback_analysis(description, category_hint, "Gemini API key is not configured")

    prompt = f"""Classify this municipal civic complaint. Return only JSON with keys:
category, severity, confidence, department, summary, reasoning, safety_flag, multi_issue_detected, is_civic_issue, detected_language, citizen_response.
Allowed categories: {', '.join(DEPARTMENT_MAP)} or Other.
Allowed severity: Critical, High, Medium, Low.
Confidence must be a number from 0 to 1. Keep summary and reasoning concise.
Treat the image as the primary evidence. The citizen hint is weak context only and must not override visible evidence.
Understand English, Urdu, and Roman Urdu. Write the operational summary and reasoning in English, but write citizen_response in the citizen's detected language.
Set is_civic_issue=false for selfies, screenshots, ordinary personal objects, food, memes, indoor scenes, or images without a visible municipal problem.
For an uncovered manhole, collapsed roadway, exposed utility, or immediate traffic danger, use Critical severity.
Citizen category hint: {category_hint or 'none'}
Complaint: {description}
"""

    try:
        model = quote(settings.gemini_model, safe="-._")
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        async with httpx.AsyncClient(timeout=float(settings.gemini_timeout_seconds)) as client:
            parts = [{"text": prompt}]
            if image_bytes:
                parts.insert(0, {"inlineData": {
                    "mimeType": image_mime_type or "image/jpeg",
                    "data": base64.b64encode(image_bytes).decode("ascii"),
                }})
            response = None
            for attempt in range(2):
                response = await client.post(
                    endpoint,
                    headers={"x-goog-api-key": settings.gemini_api_key},
                    json={
                        "contents": [{"parts": parts}],
                        "generationConfig": {
                            "responseMimeType": "application/json",
                            "maxOutputTokens": 1024,
                            "thinkingConfig": {"thinkingLevel": "minimal"},
                        },
                    },
                )
                if getattr(response, "status_code", 200) not in {429, 500, 502, 503, 504} or attempt == 1:
                    break
                await asyncio.sleep(0.4 * (2 ** attempt))
            response.raise_for_status()
        text = response.json()["candidates"][0]["content"]["parts"][0]["text"]
        result = StructuredAnalysis.model_validate(json.loads(text))
        category = result.category
        severity = result.severity
        if category not in DEPARTMENT_MAP and category != "Other":
            category = "Other"
        if severity not in {"Critical", "High", "Medium", "Low"}:
            severity = "Medium"
        confidence = result.confidence
        return {
            "category": category,
            "severity": severity,
            "confidence": confidence,
            "department": DEPARTMENT_MAP.get(category, "Citizen Facilitation Cell"),
            "summary": result.summary,
            "reasoning": result.reasoning,
            "safety_flag": result.safety_flag,
            "multi_issue_detected": result.multi_issue_detected,
            "is_civic_issue": result.is_civic_issue,
            "detected_language": result.detected_language[:40],
            "citizen_response": result.citizen_response[:500],
            "analysis_source": "gemini-vision" if image_bytes else "gemini-text",
            "analysis_warning": None,
        }
    except Exception as exc:
        logger.exception("Gemini analysis failed; using fallback rules")
        return _fallback_analysis(description, category_hint, f"Gemini request failed: {type(exc).__name__}")


async def generate_governance_insight(stats: dict) -> str:
    top_category = stats.get("top_category", "Road Infrastructure")
    critical = stats.get("critical_count", 0)
    return (
        f"{top_category} is currently the strongest civic pressure point. "
        f"{critical} critical cases should be reviewed first, then routed to departments or verified local contractors based on work type."
    )
