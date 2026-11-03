from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from app.services.routing.jurisdiction import resolve_jurisdiction
from app.services.routing.registry import (
    get_authority,
    get_department_responsibility,
)


def _detect_responsibility_ambiguity(category: str, area: str) -> Optional[str]:
    """Detect if location or category details indicate institutional responsibility ambiguity.
    
    Prevents silent misrouting of national highways, port corridors, underground sewerage,
    and power grid infrastructure to municipal city corporations.
    """
    cat_l = (category or "").lower()
    area_l = (area or "").lower()

    # 1. National highway, port access roads, elevated expressways (RHD / CPA / CDA overlap)
    highway_keywords = ("highway", "national highway", "expressway", "flyover", "port access", "port connecting", "rhd", "cpa")
    if any(kw in area_l or kw in cat_l for kw in highway_keywords):
        return "Ambiguous road jurisdiction between City Corporation, Roads & Highways Department (RHD), and Port/Development Authorities; officer review required."

    # 2. Underground domestic sewerage vs municipal surface drainage (CWASA / DWASA overlap)
    sewerage_keywords = ("underground sewer", "sewer line", "sewerage pipe", "sewage leak", "septic", "blackwater")
    if any(kw in area_l or kw in cat_l for kw in sewerage_keywords) or (cat_l in ("underground sewerage", "sewerage") and "drainage" not in cat_l):
        return "Ambiguous sanitation jurisdiction between City Corporation surface drainage and WASA underground sewerage network; officer review required."

    # 3. High voltage grid vs municipal street lighting (BPDB / DESCO / DPDC overlap)
    grid_keywords = ("power grid", "high voltage", "transformer", "substation", "transmission line")
    if any(kw in area_l or kw in cat_l for kw in grid_keywords):
        return "Ambiguous electrical jurisdiction between municipal street lighting and Power Development Board (BPDB/DESCO/DPDC); officer review required."

    return None


def route_complaint(
    category: str,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    area: Optional[str] = None,
    city: Optional[str] = None,
    verified_polygons: Optional[Dict[str, List[Tuple[float, float]]]] = None,
) -> Dict[str, Any]:
    """Deterministic routing engine that resolves the responsible public authority
    and municipal department based on complaint category and geographic jurisdiction.
    
    Principles:
    - Pure, deterministic, and testable without external network dependencies.
    - AI classifies the civic problem; deterministic routing rules determine assignment.
    - When jurisdiction or department responsibility cannot be matched with confidence,
      returns routing_status='needs_review' rather than inventing an unverified assignment.
    - Heuristic bounding boxes NEVER auto-assign; they return provisional candidates requiring review.
    - Decoupled lifecycle status fields provide full transparency across authority, jurisdiction,
      assignment, integration, and environment.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    cat_clean = (category or "").strip()
    area_clean = (area or "").strip()

    # Step 1: Resolve Geographic Jurisdiction
    jur_info = resolve_jurisdiction(
        latitude=latitude,
        longitude=longitude,
        area=area,
        city=city,
        verified_polygons=verified_polygons,
    )

    jur_code = jur_info.get("jurisdiction_short_code")
    jur_name = jur_info.get("matched_jurisdiction")
    jur_source = jur_info.get("jurisdiction_source", "unmatched")
    jur_conf = jur_info.get("jurisdiction_confidence", 0.0)
    jur_data_status = jur_info.get("jurisdiction_data_status", "unresolved")

    # Step 2: Guard against unmatched, conflict, or low-confidence jurisdiction
    if not jur_code or jur_source in ("unmatched", "conflicting_city_metadata", "coordinate_keyword_conflict", "non_city_corporation_upazila") or jur_conf <= 0.0:
        return {
            "routing_status": "needs_review",
            "assignment_status": "needs_review",
            "authority_id": None,
            "authority_name": None,
            "short_code": None,
            "department": "Needs Review",
            "jurisdiction": jur_name,
            "routing_method": jur_source,
            "routing_confidence": 0.0,
            "authority_data_status": "unverified",
            "jurisdiction_data_status": jur_data_status,
            "integration_status": "simulated",
            "environment": "demo",
            "data_status": "pending_verification",
            "assignment_reason": (
                "Location conflicts with outside administrative territory; officer review required."
                if ("conflict" in jur_source or "non_city" in jur_source)
                else "Jurisdiction could not be determined from the provided location; officer review required."
            ),
            "assigned_at": now_iso,
        }

    # Step 3: Check for Institutional Responsibility Ambiguity (Requirement 5 & Test 12)
    ambiguity_reason = _detect_responsibility_ambiguity(cat_clean, area_clean)
    if ambiguity_reason:
        return {
            "routing_status": "needs_review",
            "assignment_status": "needs_review",
            "authority_id": None,
            "authority_name": None,
            "short_code": jur_code,
            "department": "Needs Review",
            "jurisdiction": jur_name,
            "routing_method": f"ambiguous-responsibility-{jur_source}",
            "routing_confidence": round(jur_conf * 0.5, 2),
            "authority_data_status": "unverified",
            "jurisdiction_data_status": jur_data_status,
            "integration_status": "simulated",
            "environment": "demo",
            "data_status": "pending_verification",
            "assignment_reason": ambiguity_reason,
            "assigned_at": now_iso,
        }

    # Step 4: Guard against Bounding Box Heuristic auto-assignment (Requirement 1 & Tests 1, 2, 6)
    # A geo_bounding_heuristic match must NEVER result in a finalized automatic authority assignment.
    # Preserve candidate authority details, but mark routing_status='needs_review'.
    if jur_source == "geo_bounding_heuristic":
        rule = get_department_responsibility(cat_clean, jur_code)
        auth = get_authority(rule["authority_id"]) if rule else None
        return {
            "routing_status": "needs_review",
            "assignment_status": "needs_review",
            "authority_id": auth["authority_id"] if auth else None,
            "authority_name": auth["name"] if auth else None,
            "short_code": jur_code,
            "department": rule["department_name"] if rule else "Needs Review",
            "jurisdiction": jur_name,
            "routing_method": jur_source,
            "routing_confidence": round(jur_conf, 2),
            "authority_data_status": auth.get("authority_data_status", "candidate_registry") if auth else "unverified",
            "jurisdiction_data_status": "heuristic_bbox",
            "integration_status": "simulated",
            "environment": "demo",
            "data_status": "pending_verification",
            "assignment_reason": (
                f"Candidate authority {auth['name'] if auth else jur_name} identified via geographic bounding box heuristic, "
                "but requires officer review before dispatch."
            ),
            "assigned_at": now_iso,
        }

    # Step 5: Match category against verified/candidate department responsibilities
    rule = get_department_responsibility(cat_clean, jur_code)
    if not rule:
        # Category not recognized in this jurisdiction -> Needs Review
        return {
            "routing_status": "needs_review",
            "assignment_status": "needs_review",
            "authority_id": None,
            "authority_name": None,
            "short_code": jur_code,
            "department": "Needs Review",
            "jurisdiction": jur_name,
            "routing_method": f"unmapped-category-{jur_source}",
            "routing_confidence": round(jur_conf * 0.5, 2),
            "authority_data_status": "unverified",
            "jurisdiction_data_status": jur_data_status,
            "integration_status": "simulated",
            "environment": "demo",
            "data_status": "pending_verification",
            "assignment_reason": f"No department responsibility rule found for category '{cat_clean}' in jurisdiction '{jur_code}'.",
            "assigned_at": now_iso,
        }

    # Step 6: Retrieve Authority Details
    auth = get_authority(rule["authority_id"])
    if not auth:
        return {
            "routing_status": "needs_review",
            "assignment_status": "needs_review",
            "authority_id": rule["authority_id"],
            "authority_name": None,
            "short_code": jur_code,
            "department": rule.get("department_name", "Needs Review"),
            "jurisdiction": jur_name,
            "routing_method": jur_source,
            "routing_confidence": 0.0,
            "authority_data_status": "unverified",
            "jurisdiction_data_status": jur_data_status,
            "integration_status": "simulated",
            "environment": "demo",
            "data_status": "pending_verification",
            "assignment_reason": f"Registered authority ID '{rule['authority_id']}' could not be loaded.",
            "assigned_at": now_iso,
        }

    # Step 7: Finalized deterministic assignment (Only verified polygon or verified/candidate administrative area keyword)
    return {
        "routing_status": "assigned",
        "assignment_status": "auto_assigned",
        "authority_id": auth["authority_id"],
        "authority_name": auth["name"],
        "short_code": auth["short_code"],
        "department": rule["department_name"],
        "jurisdiction": jur_name,
        "routing_method": jur_source,
        "routing_confidence": round(jur_conf, 2),
        "authority_data_status": auth.get("authority_data_status", "candidate_registry"),
        "jurisdiction_data_status": jur_data_status,
        "integration_status": "simulated",
        "environment": "demo",
        "data_status": rule.get("verification_status", "pending_verification"),
        "assignment_reason": f"Matched to {auth['name']} ({rule['department_name']}) via {jur_source}.",
        "assigned_at": now_iso,
    }
