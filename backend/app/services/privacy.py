from __future__ import annotations

import re


PRIVATE_COMPLAINT_FIELDS = {
    "reporter_name", "reporter_contact", "source_fingerprint", "affected_sources",
    "internal_notes", "private_metadata", "location_geo",
}

PII_PATTERNS = (
    (re.compile(r"(?<!\d)(?:\+?880[-\s]?)?0?1[3-9]\d{8}(?!\d)"), "[phone redacted]"),
    (re.compile(r"(?<!\d)(?:\+?92[-\s]?)?0?3\d{2}[-\s]?\d{7}(?!\d)"), "[phone redacted]"),
    (re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I), "[email redacted]"),
    (re.compile(r"(?<!\d)\d{5}-?\d{7}-?\d(?!\d)"), "[identifier redacted]"),
    (re.compile(r"(?<!\d)(?:\d{10}|\d{13}|\d{17})(?!\d)"), "[identifier redacted]"),
)


def redact_public_text(value):
    if not isinstance(value, str):
        return value
    for pattern, replacement in PII_PATTERNS:
        value = pattern.sub(replacement, value)
    return value


def public_complaint(item: dict) -> dict:
    result = {key: value for key, value in item.items() if key not in PRIVATE_COMPLAINT_FIELDS}
    for field in ("description", "summary", "ai_reasoning", "review_reason", "completion_notes"):
        if field in result and isinstance(result[field], str):
            result[field] = redact_public_text(result[field])
    location = dict(result.get("location") or {})
    # Public coordinates are sufficiently accurate for civic discovery without
    # publishing device-level precision.
    if isinstance(location.get("latitude"), (int, float)):
        location["latitude"] = round(location["latitude"], 3)
    if isinstance(location.get("longitude"), (int, float)):
        location["longitude"] = round(location["longitude"], 3)
    location.pop("accuracy_meters", None)
    location.pop("captured_at", None)
    result["location"] = location
    result["status_history"] = [
        {
            key: redact_public_text(value)
            for key, value in event.items()
            if key not in {"actor_id", "officer_id", "uploaded_by", "source_fingerprint"}
        }
        for event in result.get("status_history", [])
    ]
    result["public_reporter_visible"] = False

    # Public verification transparency
    is_verified = bool(item.get("admin_verified") or item.get("status") == "Resolved" or item.get("fully_verified"))
    result["is_verified"] = is_verified
    if is_verified:
        result["verification_status"] = "Verified"
        result["work_completed_at"] = item.get("work_completed_at") or item.get("resolved_at") or item.get("updated_at")
        result["completion_description"] = redact_public_text(item.get("completion_notes") or (item.get("resolution_evidence") or {}).get("completion_note"))
    else:
        status = item.get("status", "")
        if status in {"Evidence Uploaded", "Verification", "Resolution Submitted"}:
            result["verification_status"] = "Pending Verification"
        elif status == "Rejected":
            result["verification_status"] = "Rejected - Correction Required"
        else:
            result["verification_status"] = "Unverified"
        # Protect unverified or rejected evidence from being presented as verified work to the general public
        result["after_image_url"] = None
        if "resolution_evidence" in result:
            result["resolution_evidence"] = None

    return result
