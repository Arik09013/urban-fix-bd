from __future__ import annotations

import json
import base64
import asyncio
import logging
from typing import Optional
from urllib.parse import quote

from io import BytesIO

import httpx
from PIL import Image, ImageOps
from pydantic import BaseModel, Field, field_validator

from app.core.config import settings
from app.models.constants import DEPARTMENT_MAP

logger = logging.getLogger(__name__)


def _optimize_image_for_ai(
    image_bytes: bytes,
    image_mime_type: str | None = None,
    max_dimension: int = 1600,
    quality: int = 85,
) -> tuple[bytes, str]:
    """
    Produce an optimized, stripped analysis copy of an evidence image for Gemini.
    - Preserves aspect ratio with max dimension bounded to 1600px.
    - Never upscales smaller images.
    - Respects EXIF orientation and strips metadata.
    - Converts to efficient JPEG.
    - Preserves original image_bytes unchanged for evidence and storage.
    - If processing fails or image is invalid, returns original bytes safely.
    """
    if not image_bytes:
        return image_bytes, image_mime_type or "image/jpeg"

    try:
        with Image.open(BytesIO(image_bytes)) as source:
            image = ImageOps.exif_transpose(source)
            orig_w, orig_h = image.size

            if orig_w > max_dimension or orig_h > max_dimension:
                image.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)

            output = BytesIO()
            if image.mode in ("RGBA", "LA", "P"):
                background = Image.new("RGB", image.size, (255, 255, 255))
                if image.mode == "P":
                    image = image.convert("RGBA")
                background.paste(image, mask=image.split()[-1] if "A" in image.mode else None)
                background.save(output, format="JPEG", quality=quality, optimize=True)
                return output.getvalue(), "image/jpeg"
            elif image.mode != "RGB":
                image = image.convert("RGB")

            image.save(output, format="JPEG", quality=quality, optimize=True)
            return output.getvalue(), "image/jpeg"
    except Exception as exc:
        logger.warning(f"Could not optimize image for AI analysis ({type(exc).__name__}); using original bytes.")
        return image_bytes, image_mime_type or "image/jpeg"


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
    visual_verification: str = "verified"
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
    if any("\u0980" <= char <= "\u09ff" for char in text):
        return "Bengali"
    if any("\u0600" <= char <= "\u06ff" for char in text):
        return "Urdu"
    roman_markers = {"hai", "hain", "ho", "raha", "rahi", "nahi", "ke", "ka", "ki", "gali", "sadak", "pani"}
    words = {word.strip(".,!?;:").lower() for word in text.split()}
    return "Roman Urdu" if len(words & roman_markers) >= 2 else "English"


def _fallback_analysis(
    description: str,
    category_hint: str | None = None,
    reason: str | None = None,
    has_image: bool = False,
) -> dict:
    text = description.lower()
    multi_issue_hits = 0
    if category_hint and category_hint != "Let AI decide":
        category = category_hint
    elif any(word in text for word in ["pothole", "road", "street", "traffic", "pavement", "footpath", "sidewalk"]):
        category = "Road Infrastructure"
    elif any(word in text for word in ["garbage", "trash", "waste", "dump", "dumping", "litter", "plastic", "debris", "rubbish", "refuse", "dustbin", "dumpster"]):
        category = "Waste Management"
    elif any(word in text for word in ["water", "leak", "pipe", "supply", "pipeline"]):
        category = "Water Supply"
    elif any(word in text for word in ["sewer", "drain", "drainage", "overflow", "waterlogging", "waterlog", "manhole", "gutter"]):
        category = "Drainage / Sewerage"
    elif any(word in text for word in ["light", "lamp", "electric", "pole", "wire"]):
        category = "Street Lighting"
    elif any(word in text for word in ["bridge", "footbridge", "railing", "wall", "park", "bench", "infrastructure"]):
        category = "Public Infrastructure"
    else:
        category = "Other"

    for words in [
        ["pothole", "road", "street", "traffic", "pavement", "footpath"],
        ["garbage", "trash", "waste", "dump", "dumping", "litter", "plastic"],
        ["water", "leak", "pipe"],
        ["sewer", "drain", "drainage", "overflow", "waterlogging", "manhole"],
        ["light", "lamp", "electric", "wire", "pole"],
        ["bridge", "footbridge", "railing", "infrastructure"],
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
        "open manhole",
    ]
    safety_flag = any(word in text for word in safety_terms)
    if safety_flag or any(word in text for word in ["danger", "overflow", "school", "main road", "blocked", "open manhole"]):
        severity = "Critical"
    elif any(word in text for word in ["large", "bad", "damaged", "leakage", "traffic"]):
        severity = "High"
    elif any(word in text for word in ["small", "minor"]):
        severity = "Low"
    else:
        severity = "Medium"

    # In fallback mode, AI visual inspection was not performed.
    # We do NOT falsely claim visual verification or reject legitimate images.
    if has_image:
        visual_verification = "unverified"
        # When category is Other (e.g. initial upload with placeholder text),
        # is_civic_issue is False with low confidence (0.50).
        # This prevents auto-rejection (which requires confidence >= 0.75),
        # keeps the uploaded photo, and ensures routing to Needs Review.
        is_civic_issue = category != "Other"
        confidence = 0.65 if category != "Other" else 0.50
        reasoning = f"Automated visual verification unavailable ({reason or 'engine offline'}). Human review required."
    else:
        visual_verification = "not-applicable"
        is_civic_issue = category != "Other"
        confidence = 0.88 if category != "Other" else 0.62
        reasoning = {
            "Critical": "CRITICAL: Possible public safety impact or blocked access requires urgent review.",
            "High": "HIGH: Visible or reported obstruction likely affects mobility, safety, or public service access.",
            "Medium": "MEDIUM: Civic issue needs action but no immediate severe safety signal was detected.",
            "Low": "LOW: Minor civic issue with limited visible impact from current evidence.",
        }[severity]

    if any(word in text for word in ["blurry", "dark photo", "unclear", "can't see", "cannot see"]):
        confidence = min(confidence, 0.54)

    language = _language_hint(description)
    citizen_response = {
        "Bengali": "আপনার অভিযোগটি সফলভাবে গৃহীত হয়েছে এবং নাগরিক পর্যালোচনার জন্য পাঠানো হয়েছে।",
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
        "is_civic_issue": is_civic_issue,
        "visual_verification": visual_verification,
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
    has_image = bool(image_bytes or image_url)
    if not settings.gemini_api_key:
        return _fallback_analysis(description, category_hint, "Gemini API key is not configured", has_image=has_image)

    prompt = f"""You are an expert municipal triage AI for Urban Fix BD (Bangladesh).
Classify this municipal civic complaint based primarily on the uploaded photographic evidence.
Return ONLY valid JSON matching this schema:
{{
  "category": "<Road Infrastructure | Waste Management | Water Supply | Drainage / Sewerage | Street Lighting | Public Infrastructure | Other>",
  "severity": "<Critical | High | Medium | Low>",
  "confidence": <float between 0.0 and 1.0>,
  "department": "<assigned department>",
  "summary": "<concise summary up to 300 chars>",
  "reasoning": "<concise reasoning up to 500 chars>",
  "safety_flag": <true | false>,
  "multi_issue_detected": <true | false>,
  "is_civic_issue": <true | false>,
  "detected_language": "<English | Bengali | Urdu | other>",
  "citizen_response": "<acknowledgement message in the citizen's detected language>"
}}

BANGLADESH MUNICIPAL CIVIC ISSUE GUIDELINES:
The following are legitimate municipal civic issues that MUST be marked with is_civic_issue=true:
1. Waste Management:
   - Roadside garbage dumping, accumulated plastic waste, overflowing public dustbins or dumpsters, illegal waste disposal, scattered commercial or construction debris.
   - IMPORTANT: Discarded plastic packaging, food wrappers, polythene bags, plastic bottles, cans, and mixed household waste become municipal civic issues when accumulated or dumped in public or outdoor spaces. Do NOT mark roadside waste piles as non-civic personal objects or food.
2. Road Infrastructure:
   - Potholes, broken roads, damaged pavements, broken footpaths/sidewalks, collapsed roadways.
3. Drainage / Sewerage:
   - Drainage blockage, standing water/waterlogging, overflowing open sewage drains, missing or broken drain covers.
4. Open Manholes & Public Hazards:
   - Open manholes, uncovered utility shafts, collapsed drainage slabs (set safety_flag=true and severity=Critical).
5. Street Lighting:
   - Broken streetlights, damaged lamp poles, dark public walkways, non-functional municipal lighting.
6. Exposed Electrical Wires:
   - Hanging live cables, sparking transformers, leaning utility poles, exposed electrical wires (set safety_flag=true and severity=Critical).
7. Public Infrastructure:
   - Damaged footbridges, broken public railings, collapsed boundary walls, broken culverts, ruined public municipal facilities.

NON-CIVIC GUIDELINES:
Set is_civic_issue=false ONLY for clearly non-municipal images:
- Selfies, personal portraits, group photos.
- Screenshots of text/apps.
- Private indoor rooms or home interiors without municipal structural damage.
- Close-up photos of personal belongings in normal domestic use.
- Clean food served on a plate or dining table.
- Memes, artwork, or online graphics.
- Photos without any visible municipal problem or public defect.

EVALUATION RULES:
1. Treat the uploaded image as the PRIMARY evidence. The citizen description/hint is supporting context only and must never override visible photographic evidence.
2. If evidence clearly shows a municipal problem, assign high confidence (>= 0.80).
3. If an image might show a civic issue but is ambiguous, blurry, or borderline, set confidence between 0.40 and 0.69 (do not reject with high confidence; allow human review).
4. For imminent public safety hazards (open manholes, exposed live wires, collapsed roadway, severe deep waterlogging), set safety_flag=true and severity=Critical.
5. Write summary and reasoning in English. Write citizen_response in the citizen's detected language (English or Bengali).

Citizen category hint: {category_hint or 'none'}
Citizen complaint description: {description}
"""

    try:
        model = quote(settings.gemini_model, safe="-._")
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

        read_timeout = max(90.0, float(settings.gemini_timeout_seconds))
        client_timeout = httpx.Timeout(
            connect=15.0,
            read=read_timeout,
            write=30.0,
            pool=10.0,
        )

        async with httpx.AsyncClient(timeout=client_timeout) as client:
            parts = [{"text": prompt}]
            if image_bytes:
                analysis_bytes, analysis_mime = _optimize_image_for_ai(image_bytes, image_mime_type)
                parts.insert(0, {"inlineData": {
                    "mimeType": analysis_mime,
                    "data": base64.b64encode(analysis_bytes).decode("ascii"),
                }})

            gen_config = {
                "responseMimeType": "application/json",
                "maxOutputTokens": 1024,
                "thinkingConfig": {"thinkingLevel": "minimal"},
            }

            response = None
            max_attempts = 2
            for attempt in range(max_attempts):
                try:
                    response = await client.post(
                        endpoint,
                        headers={"x-goog-api-key": settings.gemini_api_key},
                        json={
                            "contents": [{"parts": parts}],
                            "generationConfig": gen_config,
                        },
                    )
                    status = getattr(response, "status_code", 200)

                    # If model rejects thinkingConfig with 400, retry once immediately without thinkingConfig
                    if status == 400 and "thinkingConfig" in gen_config:
                        logger.warning("Gemini API rejected thinkingConfig (HTTP 400); retrying without thinkingConfig.")
                        gen_config.pop("thinkingConfig", None)
                        response = await client.post(
                            endpoint,
                            headers={"x-goog-api-key": settings.gemini_api_key},
                            json={
                                "contents": [{"parts": parts}],
                                "generationConfig": gen_config,
                            },
                        )
                        status = getattr(response, "status_code", 200)

                    # Do not retry permanent client errors
                    if status in {400, 401, 403}:
                        break

                    # Retry once for transient errors (429 rate limit or 5xx server errors)
                    if status in {429, 500, 502, 503, 504}:
                        if attempt < max_attempts - 1:
                            backoff = 1.0 * (2 ** attempt)
                            logger.warning(
                                f"Gemini API returned transient HTTP {status}; retrying in {backoff}s (attempt {attempt + 1}/{max_attempts})."
                            )
                            await asyncio.sleep(backoff)
                            continue

                    break
                except (httpx.TimeoutException, httpx.NetworkError) as exc:
                    if attempt < max_attempts - 1:
                        backoff = 1.0 * (2 ** attempt)
                        logger.warning(
                            f"Gemini API {type(exc).__name__}; retrying in {backoff}s (attempt {attempt + 1}/{max_attempts})."
                        )
                        await asyncio.sleep(backoff)
                        continue
                    else:
                        logger.warning(f"Gemini API {type(exc).__name__} on final attempt.")
                        raise

            if response is not None:
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
            "visual_verification": "verified" if image_bytes else "not-applicable",
            "detected_language": result.detected_language[:40],
            "citizen_response": result.citizen_response[:500],
            "analysis_source": "gemini-vision" if image_bytes else "gemini-text",
            "analysis_warning": None,
        }
    except httpx.TimeoutException:
        error_category = "gemini-timeout"
        logger.warning("Gemini API request timed out (gemini-timeout); activating fallback rules.")
        return _fallback_analysis(description, category_hint, error_category, has_image=has_image)
    except httpx.NetworkError as exc:
        error_category = "network-failure"
        logger.warning(f"Gemini API network failure (network-failure: {type(exc).__name__}); activating fallback rules.")
        return _fallback_analysis(description, category_hint, error_category, has_image=has_image)
    except httpx.HTTPStatusError as exc:
        code = getattr(exc.response, "status_code", 0)
        if code in {401, 403}:
            error_category = "auth-failure"
        elif code == 429:
            error_category = "rate-limit"
        elif code == 400:
            error_category = "invalid-request"
        else:
            error_category = f"http-status-{code}"
        logger.warning(f"Gemini API request failed with HTTP {code} ({error_category}); activating fallback rules.")
        return _fallback_analysis(description, category_hint, error_category, has_image=has_image)
    except (json.JSONDecodeError, KeyError, ValueError) as exc:
        error_category = "invalid-response"
        logger.warning(f"Gemini API response parsing failed (invalid-response: {type(exc).__name__}); activating fallback rules.")
        return _fallback_analysis(description, category_hint, error_category, has_image=has_image)
    except Exception as exc:
        error_category = f"unexpected-failure-{type(exc).__name__}"
        logger.exception(f"Gemini API unexpected failure ({error_category}); activating fallback rules.")
        return _fallback_analysis(description, category_hint, error_category, has_image=has_image)


async def generate_governance_insight(stats: dict) -> str:
    top_category = stats.get("top_category", "Road Infrastructure")
    critical = stats.get("critical_count", 0)
    return (
        f"{top_category} is currently the strongest civic pressure point. "
        f"{critical} critical cases should be reviewed first, then routed to departments or verified local contractors based on work type."
    )
