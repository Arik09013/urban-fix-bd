from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple


# Configurable administrative area mapping (Chattogram primary pilot)
# Note: Marked as "pending_verification" in accordance with Urban Fix BD principles.
# These area keywords serve as candidate heuristics and do not represent official
# gazetted ward boundaries.
CHATTOGRAM_AREA_KEYWORDS = {
    "agrabad",
    "muradpur",
    "nasirabad",
    "gec",
    "gec circle",
    "halishahar",
    "chawkbazar",
    "panchlaish",
    "kotwali",
    "khulshi",
    "patenga",
    "pahartali",
    "bakalia",
    "bayezid",
    "chandgaon",
    "double mooring",
    "sadarghat",
    "anderkilla",
    "lalkhan bazar",
    "sholashahar",
    "oxygen",
    "dewanhat",
    "epz",
    "karnaphuli",
    "bahaddarhat",
    "port zone",
}

DHAKA_NORTH_KEYWORDS = {
    "uttara",
    "gulshan",
    "banani",
    "mirpur",
    "baridhara",
    "badda",
    "mohakhali",
    "cantonment",
    "kafrul",
    "khilkhet",
    "bhatara",
    "rampura",
    "tejgaon",
    "niketan",
    "bashundhara",
    "dohs",
}

DHAKA_SOUTH_KEYWORDS = {
    "dhanmondi",
    "motijheel",
    "old dhaka",
    "lalbagh",
    "shahbagh",
    "paltan",
    "wari",
    "sutrapur",
    "hazaribagh",
    "kamrangirchar",
    "jatrabari",
    "bangshal",
    "new market",
}

# Major cities and districts outside CCC/DNCC/DSCC that conflict with metropolitan routing
CONFLICTING_CITIES = {
    "cumilla", "comilla",
    "sylhet",
    "rajshahi",
    "khulna",
    "barishal", "barisal",
    "rangpur",
    "mymensingh",
    "bogura", "bogra",
    "gazipur",
    "narayanganj",
    "savar",
    "keraniganj",
    "feni",
    "noakhali",
    "brahmanbaria",
    "tangail",
    "pabna",
    "dinajpur",
    "jashore", "jessore",
    "kushtia",
    "faridpur",
    "cox's bazar", "coxsbazar",
}

# Non-CCC upazilas in Chattogram district that do NOT fall under Chattogram City Corporation
NON_CCC_UPAZILAS = {
    "sitakunda", "sitakund",
    "hathazari",
    "boalkhali",
    "patiya",
    "raozan",
    "rangunia",
    "mirsharai", "mirersharai",
    "anwara",
    "sandwip",
    "lohagara",
    "satkania",
    "banshkhali",
    "fatikchhari",
    "chandanaish",
    "karnafuli upazila",
}

# Geographic sanity boundaries for metropolitan jurisdiction keywords
CHATTOGRAM_METRO_GEO_SANITY = {
    "min_lat": 22.10, "max_lat": 22.70,
    "min_lng": 91.60, "max_lng": 92.15,
}

DHAKA_METRO_GEO_SANITY = {
    "min_lat": 23.60, "max_lat": 24.05,
    "min_lng": 90.20, "max_lng": 90.60,
}

# Plausible Geographic Bounding Boxes for Candidate Pilot Heuristic
# IMPORTANT: These bounding boxes are coarse heuristic guidelines for demo/pilot triage,
# NOT official statutory administrative boundary declarations.
CHATTOGRAM_HEURISTIC_BBOX = {
    "min_lat": 22.15,
    "max_lat": 22.50,
    "min_lng": 91.65,
    "max_lng": 91.95,
}

DHAKA_METRO_HEURISTIC_BBOX = {
    "min_lat": 23.65,
    "max_lat": 23.95,
    "min_lng": 90.30,
    "max_lng": 90.52,
}


def _matches_keyword(text: str, keyword: str) -> bool:
    """Exact word-boundary pattern match to avoid overly broad substring collisions."""
    pattern = r'(?:\b|_)' + re.escape(keyword) + r'(?:\b|_)'
    return bool(re.search(pattern, text, flags=re.IGNORECASE))


def _detect_conflicting_city(city_norm: str, area_norm: str) -> Optional[str]:
    """Detect if city metadata or structured area string mentions a known conflicting city."""
    # Check explicit city parameter first
    for c in CONFLICTING_CITIES:
        if _matches_keyword(city_norm, c):
            return c
    # Check tokens in area string (e.g. "Gulshan, Cumilla" or "Agrabad, Sylhet")
    delimiters = r'[,;/|\(\)\-\–]+'
    parts = [p.strip() for p in re.split(delimiters, area_norm) if p.strip()]
    for part in parts:
        for c in CONFLICTING_CITIES:
            if _matches_keyword(part, c):
                return c
    return None


def _point_in_polygon(lat: float, lng: float, polygon: List[Tuple[float, float]]) -> bool:
    """Ray-casting algorithm for testing if a coordinate point is within a polygon.
    
    polygon is a list of (lat, lng) tuples.
    """
    if len(polygon) < 3:
        return False
    inside = False
    n = len(polygon)
    p1_lat, p1_lng = polygon[0]
    for i in range(1, n + 1):
        p2_lat, p2_lng = polygon[i % n]
        if lng > min(p1_lng, p2_lng):
            if lng <= max(p1_lng, p2_lng):
                if lat <= max(p1_lat, p2_lat):
                    if p1_lng != p2_lng:
                        x_inters = (lng - p1_lng) * (p2_lat - p1_lat) / (p2_lng - p1_lng) + p1_lat
                        if p1_lat == p2_lat or lat <= x_inters:
                            inside = not inside
        p1_lat, p1_lng = p2_lat, p2_lng
    return inside


def resolve_jurisdiction(
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    area: Optional[str] = None,
    city: Optional[str] = None,
    verified_polygons: Optional[Dict[str, List[Tuple[float, float]]]] = None,
) -> Dict[str, Any]:
    """Resolve geographic jurisdiction through a structured priority hierarchy:
    
    1. Verified geographic polygon matching (when verified boundary data is supplied)
    2. Explicit verified administrative-area mapping
    3. Area/thana keyword matching (candidate heuristic fallback, validated against city/district)
    4. Geographic bounding box heuristic (demo/pilot candidate, NEVER auto-assigned)
    5. Unmatched / Conflict -> Returns needs_review
    """
    has_coords = (latitude is not None and longitude is not None and
                  isinstance(latitude, (int, float)) and isinstance(longitude, (int, float)))

    # Level 1: Verified Polygon Matching
    if has_coords and verified_polygons:
        for jur_code, poly in verified_polygons.items():
            if _point_in_polygon(latitude, longitude, poly):
                return {
                    "matched_area": area,
                    "matched_jurisdiction": f"{jur_code} Statutory Boundary",
                    "jurisdiction_short_code": jur_code,
                    "jurisdiction_source": "verified_polygon_boundary",
                    "jurisdiction_confidence": 0.99,
                    "jurisdiction_data_status": "statutory_polygon_verified",
                    "verification_status": "verified",
                }

    # Normalize textual inputs
    area_norm = (area or "").strip().lower()
    city_norm = (city or "").strip().lower()

    # Conflict Check 1: Conflicting city / outside district metadata (e.g. "Gulshan, Cumilla" or "Agrabad, Sylhet")
    conflicting_city = _detect_conflicting_city(city_norm, area_norm)
    if conflicting_city:
        return {
            "matched_area": area,
            "matched_jurisdiction": None,
            "jurisdiction_short_code": None,
            "jurisdiction_source": "conflicting_city_metadata",
            "jurisdiction_confidence": 0.0,
            "jurisdiction_data_status": "unresolved",
            "verification_status": "unverified",
        }

    # Conflict Check 2: Non-CCC Upazilas in Chattogram district (e.g. Sitakunda, Hathazari)
    has_non_ccc_upazila = (any(_matches_keyword(area_norm, u) for u in NON_CCC_UPAZILAS) or
                           any(_matches_keyword(city_norm, u) for u in NON_CCC_UPAZILAS))
    if has_non_ccc_upazila:
        return {
            "matched_area": area,
            "matched_jurisdiction": None,
            "jurisdiction_short_code": None,
            "jurisdiction_source": "non_city_corporation_upazila",
            "jurisdiction_confidence": 0.0,
            "jurisdiction_data_status": "unresolved",
            "verification_status": "unverified",
        }

    # Conflict Check 3: Coordinate bounds vs Keyword conflict (e.g. Rajshahi coordinates with Dhaka/Chattogram keyword)
    coords_outside_ctg = has_coords and not (
        CHATTOGRAM_METRO_GEO_SANITY["min_lat"] <= latitude <= CHATTOGRAM_METRO_GEO_SANITY["max_lat"] and
        CHATTOGRAM_METRO_GEO_SANITY["min_lng"] <= longitude <= CHATTOGRAM_METRO_GEO_SANITY["max_lng"]
    )
    coords_outside_dhaka = has_coords and not (
        DHAKA_METRO_GEO_SANITY["min_lat"] <= latitude <= DHAKA_METRO_GEO_SANITY["max_lat"] and
        DHAKA_METRO_GEO_SANITY["min_lng"] <= longitude <= DHAKA_METRO_GEO_SANITY["max_lng"]
    )

    # Check for area keywords
    is_ctg_city = any(_matches_keyword(city_norm, kw) for kw in ("chattogram", "chittagong", "ctg"))
    has_ctg_keyword = any(_matches_keyword(area_norm, kw) for kw in CHATTOGRAM_AREA_KEYWORDS)
    has_dncc_keyword = any(_matches_keyword(area_norm, kw) for kw in DHAKA_NORTH_KEYWORDS)
    has_dscc_keyword = any(_matches_keyword(area_norm, kw) for kw in DHAKA_SOUTH_KEYWORDS)

    # If coordinates are clearly in another region (e.g. Rajshahi), keywords must NOT override them
    if (has_dncc_keyword or has_dscc_keyword) and coords_outside_dhaka:
        return {
            "matched_area": area,
            "matched_jurisdiction": None,
            "jurisdiction_short_code": None,
            "jurisdiction_source": "coordinate_keyword_conflict",
            "jurisdiction_confidence": 0.0,
            "jurisdiction_data_status": "unresolved",
            "verification_status": "unverified",
        }

    if (has_ctg_keyword or is_ctg_city) and coords_outside_ctg:
        return {
            "matched_area": area,
            "matched_jurisdiction": None,
            "jurisdiction_short_code": None,
            "jurisdiction_source": "coordinate_keyword_conflict",
            "jurisdiction_confidence": 0.0,
            "jurisdiction_data_status": "unresolved",
            "verification_status": "unverified",
        }

    # Level 2 & 3: Validated Area & City Keyword Matching
    # Primary Pilot: Chattogram
    if (has_ctg_keyword or is_ctg_city) and not coords_outside_ctg:
        matched_kw = next((kw for kw in CHATTOGRAM_AREA_KEYWORDS if _matches_keyword(area_norm, kw)), None)
        confidence = 0.88 if (has_ctg_keyword and is_ctg_city) else 0.82 if has_ctg_keyword else 0.75
        return {
            "matched_area": matched_kw.title() if matched_kw else (area or "Chattogram City"),
            "matched_jurisdiction": "Chattogram Metropolitan Area",
            "jurisdiction_short_code": "CCC",
            "jurisdiction_source": "administrative_area_keyword",
            "jurisdiction_confidence": confidence,
            "jurisdiction_data_status": "keyword_inferred",
            "verification_status": "pending_verification",
        }

    # Dhaka North Area Matching
    if has_dncc_keyword and not coords_outside_dhaka:
        matched_kw = next((kw for kw in DHAKA_NORTH_KEYWORDS if _matches_keyword(area_norm, kw)), None)
        return {
            "matched_area": matched_kw.title() if matched_kw else area,
            "matched_jurisdiction": "Dhaka North Metropolitan Area",
            "jurisdiction_short_code": "DNCC",
            "jurisdiction_source": "administrative_area_keyword",
            "jurisdiction_confidence": 0.82,
            "jurisdiction_data_status": "keyword_inferred",
            "verification_status": "pending_verification",
        }

    # Dhaka South Area Matching
    if has_dscc_keyword and not coords_outside_dhaka:
        matched_kw = next((kw for kw in DHAKA_SOUTH_KEYWORDS if _matches_keyword(area_norm, kw)), None)
        return {
            "matched_area": matched_kw.title() if matched_kw else area,
            "matched_jurisdiction": "Dhaka South Metropolitan Area",
            "jurisdiction_short_code": "DSCC",
            "jurisdiction_source": "administrative_area_keyword",
            "jurisdiction_confidence": 0.82,
            "jurisdiction_data_status": "keyword_inferred",
            "verification_status": "pending_verification",
        }

    # Level 4: Geographically Plausible Bounding Box Heuristic (Provisional Candidates Only)
    if has_coords:
        # Chattogram Heuristic Bounding Box
        if (CHATTOGRAM_HEURISTIC_BBOX["min_lat"] <= latitude <= CHATTOGRAM_HEURISTIC_BBOX["max_lat"] and
                CHATTOGRAM_HEURISTIC_BBOX["min_lng"] <= longitude <= CHATTOGRAM_HEURISTIC_BBOX["max_lng"]):
            return {
                "matched_area": area or f"Chattogram ({latitude:.4f}, {longitude:.4f})",
                "matched_jurisdiction": "Chattogram Metropolitan Area (Candidate Bounding Box)",
                "jurisdiction_short_code": "CCC",
                "jurisdiction_source": "geo_bounding_heuristic",
                "jurisdiction_confidence": 0.70,
                "jurisdiction_data_status": "heuristic_bbox",
                "verification_status": "pending_verification",
            }

        # Dhaka Metro Heuristic Bounding Box (Ambiguous between DNCC and DSCC if no keyword)
        # Note: Unverified latitude split is removed; ambiguous coordinates require officer review.
        if (DHAKA_METRO_HEURISTIC_BBOX["min_lat"] <= latitude <= DHAKA_METRO_HEURISTIC_BBOX["max_lat"] and
                DHAKA_METRO_HEURISTIC_BBOX["min_lng"] <= longitude <= DHAKA_METRO_HEURISTIC_BBOX["max_lng"]):
            return {
                "matched_area": area or f"Dhaka ({latitude:.4f}, {longitude:.4f})",
                "matched_jurisdiction": "Dhaka Metropolitan Area (Ambiguous DNCC/DSCC Boundary)",
                "jurisdiction_short_code": None,
                "jurisdiction_source": "geo_bounding_heuristic",
                "jurisdiction_confidence": 0.50,
                "jurisdiction_data_status": "heuristic_bbox",
                "verification_status": "pending_verification",
            }

    # Level 5: No Match -> Unmatched / Needs Review
    return {
        "matched_area": area,
        "matched_jurisdiction": None,
        "jurisdiction_short_code": None,
        "jurisdiction_source": "unmatched",
        "jurisdiction_confidence": 0.0,
        "jurisdiction_data_status": "unresolved",
        "verification_status": "unverified",
    }
