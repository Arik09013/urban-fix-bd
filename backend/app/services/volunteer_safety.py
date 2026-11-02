from __future__ import annotations


DANGEROUS_TERMS = {
    "electric": "Electrical hazard",
    "wire": "Electrical hazard",
    "gas": "Gas hazard",
    "fire": "Fire emergency",
    "collapse": "Structural hazard",
    "structural": "Structural hazard",
    "crime": "Public-safety incident",
    "weapon": "Public-safety incident",
    "traffic emergency": "Traffic emergency",
    "chemical": "Hazardous material",
    "hazardous": "Hazardous material",
    "pothole": "Road repair",
    "asphalt": "Road repair",
    "sewer": "Biohazard and confined infrastructure",
    "drain": "Drainage infrastructure",
    "water supply": "Utility infrastructure",
    "street light": "Electrical infrastructure",
    "manhole": "Confined-space hazard",
}

LOW_RISK_TERMS = {"litter", "cleanup", "clean-up", "graffiti", "painting", "beautification", "planting", "poster removal"}


def volunteer_eligibility(complaint: dict) -> tuple[bool, str]:
    text = " ".join(str(complaint.get(key, "")) for key in ("category", "summary", "description")).lower()
    for term, reason in DANGEROUS_TERMS.items():
        if term in text:
            return False, f"Not eligible for volunteer work: {reason}. A qualified authority team is required."
    if complaint.get("safety_flag") or complaint.get("severity") == "Critical":
        return False, "Not eligible for volunteer work: critical or public-safety issues require trained responders."
    if not any(term in text for term in LOW_RISK_TERMS):
        return False, "Not eligible by default: only explicitly recognized low-risk cleanup and beautification tasks may use community participation."
    return True, "Eligible for supervised low-risk micro-maintenance subject to authority approval."
