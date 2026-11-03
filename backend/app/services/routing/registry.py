from __future__ import annotations

from typing import Any, Dict, List, Optional
from datetime import datetime, timezone


# Authority Types
AUTHORITY_TYPES = {
    "city_corporation",
    "pourashava",
    "specialized_utility",
    "national_agency",
    "infrastructure_authority",
}

# Administrative Levels
ADMINISTRATIVE_LEVELS = {
    "city_corporation",
    "metropolitan",
    "national",
    "district",
}


# Candidate Authority Registry
# Note: In accordance with Urban Fix BD principles, all initial candidate authorities
# are marked with data_status="pending_verification" until official operational
# boundaries, contact channels, and department responsibilities are formally verified.
AUTHORITY_REGISTRY: Dict[str, Dict[str, Any]] = {
    "AUTH-CCC": {
        "authority_id": "AUTH-CCC",
        "name": "Chattogram City Corporation",
        "short_code": "CCC",
        "authority_type": "city_corporation",
        "administrative_level": "city_corporation",
        "jurisdictions": ["Chattogram Metropolitan Area", "Chattogram City"],
        "departments": [
            "Engineering Department (Road Maintenance)",
            "Conservancy Department (Waste Management)",
            "Drainage & Flood Management Circle",
            "Electrical Division (Street Lighting)",
            "Civil Works & Public Amenities",
            "Citizen Public Grievance Cell",
        ],
        "official_website": None,
        "official_contact": None,
        "data_status": "pending_verification",
        "authority_data_status": "candidate_registry",
        "integration_status": "simulated",
        "environment": "demo",
        "data_source": "Bangladesh Local Government Division (Candidate Registry)",
        "last_verified_at": None,
    },
    "AUTH-DNCC": {
        "authority_id": "AUTH-DNCC",
        "name": "Dhaka North City Corporation",
        "short_code": "DNCC",
        "authority_type": "city_corporation",
        "administrative_level": "city_corporation",
        "jurisdictions": ["Dhaka North Metropolitan Area", "Dhaka North"],
        "departments": [
            "Civil Engineering Department",
            "Waste Management Department",
            "Drainage Circle",
            "Electrical & Mechanical Division",
            "Citizen Service Center",
        ],
        "official_website": None,
        "official_contact": None,
        "data_status": "pending_verification",
        "authority_data_status": "candidate_registry",
        "integration_status": "simulated",
        "environment": "demo",
        "data_source": "Bangladesh Local Government Division (Candidate Registry)",
        "last_verified_at": None,
    },
    "AUTH-DSCC": {
        "authority_id": "AUTH-DSCC",
        "name": "Dhaka South City Corporation",
        "short_code": "DSCC",
        "authority_type": "city_corporation",
        "administrative_level": "city_corporation",
        "jurisdictions": ["Dhaka South Metropolitan Area", "Dhaka South"],
        "departments": [
            "Civil Engineering Department",
            "Waste Management Department",
            "Drainage Division",
            "Electrical Division",
            "Public Grievance Redress Cell",
        ],
        "official_website": None,
        "official_contact": None,
        "data_status": "pending_verification",
        "authority_data_status": "candidate_registry",
        "integration_status": "simulated",
        "environment": "demo",
        "data_source": "Bangladesh Local Government Division (Candidate Registry)",
        "last_verified_at": None,
    },
    "AUTH-CWASA": {
        "authority_id": "AUTH-CWASA",
        "name": "Chattogram Water Supply and Sewerage Authority",
        "short_code": "CWASA",
        "authority_type": "specialized_utility",
        "administrative_level": "metropolitan",
        "jurisdictions": ["Chattogram Metropolitan Area"],
        "departments": [
            "Water Supply & Distribution Circle",
            "Sewerage & Sanitation Maintenance Division",
        ],
        "official_website": None,
        "official_contact": None,
        "data_status": "pending_verification",
        "authority_data_status": "candidate_registry",
        "integration_status": "simulated",
        "environment": "demo",
        "data_source": "Ministry of Local Government, Rural Development & Co-operatives (Candidate Registry)",
        "last_verified_at": None,
    },
    "AUTH-DWASA": {
        "authority_id": "AUTH-DWASA",
        "name": "Dhaka Water Supply and Sewerage Authority",
        "short_code": "DWASA",
        "authority_type": "specialized_utility",
        "administrative_level": "metropolitan",
        "jurisdictions": ["Dhaka Metropolitan Area"],
        "departments": [
            "Water Maintenance Division",
            "Sewerage Network Operations",
        ],
        "official_website": None,
        "official_contact": None,
        "data_status": "pending_verification",
        "authority_data_status": "candidate_registry",
        "integration_status": "simulated",
        "environment": "demo",
        "data_source": "Ministry of Local Government, Rural Development & Co-operatives (Candidate Registry)",
        "last_verified_at": None,
    },
    "AUTH-DPHE": {
        "authority_id": "AUTH-DPHE",
        "name": "Department of Public Health Engineering",
        "short_code": "DPHE",
        "authority_type": "national_agency",
        "administrative_level": "national",
        "jurisdictions": ["Non-metropolitan Municipalities and Rural Bangladesh"],
        "departments": [
            "Rural Water Supply & Environmental Sanitation",
        ],
        "official_website": None,
        "official_contact": None,
        "data_status": "pending_verification",
        "authority_data_status": "candidate_registry",
        "integration_status": "simulated",
        "environment": "demo",
        "data_source": "Department of Public Health Engineering (Candidate Registry)",
        "last_verified_at": None,
    },
    "AUTH-BPDB": {
        "authority_id": "AUTH-BPDB",
        "name": "Bangladesh Power Development Board",
        "short_code": "BPDB",
        "authority_type": "infrastructure_authority",
        "administrative_level": "national",
        "jurisdictions": ["National Power Grid Distribution Areas (incl. Chattogram)"],
        "departments": [
            "Urban Distribution Division",
        ],
        "official_website": None,
        "official_contact": None,
        "data_status": "pending_verification",
        "authority_data_status": "candidate_registry",
        "integration_status": "simulated",
        "environment": "demo",
        "data_source": "Power Division, Ministry of Power, Energy and Mineral Resources (Candidate Registry)",
        "last_verified_at": None,
    },
    "AUTH-DESCO": {
        "authority_id": "AUTH-DESCO",
        "name": "Dhaka Electric Supply Company Limited",
        "short_code": "DESCO",
        "authority_type": "infrastructure_authority",
        "administrative_level": "metropolitan",
        "jurisdictions": ["Dhaka North Metropolitan Area"],
        "departments": [
            "Street Lighting & Network Maintenance",
        ],
        "official_website": None,
        "official_contact": None,
        "data_status": "pending_verification",
        "authority_data_status": "candidate_registry",
        "integration_status": "simulated",
        "environment": "demo",
        "data_source": "Power Division (Candidate Registry)",
        "last_verified_at": None,
    },
    "AUTH-DPDC": {
        "authority_id": "AUTH-DPDC",
        "name": "Dhaka Power Distribution Company Limited",
        "short_code": "DPDC",
        "authority_type": "infrastructure_authority",
        "administrative_level": "metropolitan",
        "jurisdictions": ["Dhaka South Metropolitan Area"],
        "departments": [
            "Distribution & Network Maintenance",
        ],
        "official_website": None,
        "official_contact": None,
        "data_status": "pending_verification",
        "authority_data_status": "candidate_registry",
        "integration_status": "simulated",
        "environment": "demo",
        "data_source": "Power Division (Candidate Registry)",
        "last_verified_at": None,
    },
    "AUTH-LGED": {
        "authority_id": "AUTH-LGED",
        "name": "Local Government Engineering Department",
        "short_code": "LGED",
        "authority_type": "national_agency",
        "administrative_level": "national",
        "jurisdictions": ["Upazila & Union Infrastructure across Bangladesh"],
        "departments": [
            "Rural and Municipal Infrastructure Maintenance",
        ],
        "official_website": None,
        "official_contact": None,
        "data_status": "pending_verification",
        "authority_data_status": "candidate_registry",
        "integration_status": "simulated",
        "environment": "demo",
        "data_source": "Local Government Engineering Department (Candidate Registry)",
        "last_verified_at": None,
    },
    "AUTH-RHD": {
        "authority_id": "AUTH-RHD",
        "name": "Roads and Highways Department",
        "short_code": "RHD",
        "authority_type": "national_agency",
        "administrative_level": "national",
        "jurisdictions": ["National & Regional Highways across Bangladesh"],
        "departments": [
            "Highway Maintenance & Road Safety Division",
        ],
        "official_website": None,
        "official_contact": None,
        "data_status": "pending_verification",
        "authority_data_status": "candidate_registry",
        "integration_status": "simulated",
        "environment": "demo",
        "data_source": "Road Transport and Highways Division (Candidate Registry)",
        "last_verified_at": None,
    },
}


# Department Responsibility Rules
# Maps (category, jurisdiction_short_code) to specific candidate authority and department.
# In accordance with project requirements, separate entries exist for different geographic areas.
DEPARTMENT_RESPONSIBILITY_MAP: List[Dict[str, Any]] = [
    # Chattogram Pilot Area
    {
        "category": "Road Infrastructure",
        "authority_id": "AUTH-CCC",
        "department_name": "Engineering Department (Road Maintenance)",
        "jurisdiction_short_code": "CCC",
        "verification_status": "pending_verification",
        "source_reference": "Chattogram City Corporation Citizen Charter (Candidate)",
    },
    {
        "category": "Waste Management",
        "authority_id": "AUTH-CCC",
        "department_name": "Conservancy Department (Waste Management)",
        "jurisdiction_short_code": "CCC",
        "verification_status": "pending_verification",
        "source_reference": "Chattogram City Corporation Citizen Charter (Candidate)",
    },
    {
        "category": "Water Supply",
        "authority_id": "AUTH-CWASA",
        "department_name": "Water Supply & Distribution Circle",
        "jurisdiction_short_code": "CCC",
        "verification_status": "pending_verification",
        "source_reference": "CWASA Operational Scope (Candidate)",
    },
    {
        "category": "Drainage / Sewerage",
        "authority_id": "AUTH-CCC",
        "department_name": "Drainage & Flood Management Circle",
        "jurisdiction_short_code": "CCC",
        "verification_status": "pending_verification",
        "source_reference": "CCC Monsoon Action Plan (Candidate)",
    },
    {
        "category": "Street Lighting",
        "authority_id": "AUTH-CCC",
        "department_name": "Electrical Division (Street Lighting)",
        "jurisdiction_short_code": "CCC",
        "verification_status": "pending_verification",
        "source_reference": "CCC Engineering Division (Candidate)",
    },
    {
        "category": "Public Infrastructure",
        "authority_id": "AUTH-CCC",
        "department_name": "Civil Works & Public Amenities",
        "jurisdiction_short_code": "CCC",
        "verification_status": "pending_verification",
        "source_reference": "CCC Municipal Works (Candidate)",
    },
    {
        "category": "Other",
        "authority_id": "AUTH-CCC",
        "department_name": "Citizen Public Grievance Cell",
        "jurisdiction_short_code": "CCC",
        "verification_status": "pending_verification",
        "source_reference": "CCC Public Facilitation (Candidate)",
    },

    # Dhaka North Area
    {
        "category": "Road Infrastructure",
        "authority_id": "AUTH-DNCC",
        "department_name": "Civil Engineering Department",
        "jurisdiction_short_code": "DNCC",
        "verification_status": "pending_verification",
        "source_reference": "DNCC Engineering Division (Candidate)",
    },
    {
        "category": "Waste Management",
        "authority_id": "AUTH-DNCC",
        "department_name": "Waste Management Department",
        "jurisdiction_short_code": "DNCC",
        "verification_status": "pending_verification",
        "source_reference": "DNCC Waste Management (Candidate)",
    },
    {
        "category": "Water Supply",
        "authority_id": "AUTH-DWASA",
        "department_name": "Water Maintenance Division",
        "jurisdiction_short_code": "DNCC",
        "verification_status": "pending_verification",
        "source_reference": "DWASA Scope of Service (Candidate)",
    },
    {
        "category": "Drainage / Sewerage",
        "authority_id": "AUTH-DNCC",
        "department_name": "Drainage Circle",
        "jurisdiction_short_code": "DNCC",
        "verification_status": "pending_verification",
        "source_reference": "DNCC Drainage Division (Candidate)",
    },
    {
        "category": "Street Lighting",
        "authority_id": "AUTH-DNCC",
        "department_name": "Electrical & Mechanical Division",
        "jurisdiction_short_code": "DNCC",
        "verification_status": "pending_verification",
        "source_reference": "DNCC Electrical Division (Candidate)",
    },
    {
        "category": "Public Infrastructure",
        "authority_id": "AUTH-DNCC",
        "department_name": "Civil Engineering Department",
        "jurisdiction_short_code": "DNCC",
        "verification_status": "pending_verification",
        "source_reference": "DNCC Municipal Works (Candidate)",
    },
    {
        "category": "Other",
        "authority_id": "AUTH-DNCC",
        "department_name": "Citizen Service Center",
        "jurisdiction_short_code": "DNCC",
        "verification_status": "pending_verification",
        "source_reference": "DNCC Public Grievance (Candidate)",
    },

    # Dhaka South Area
    {
        "category": "Road Infrastructure",
        "authority_id": "AUTH-DSCC",
        "department_name": "Civil Engineering Department",
        "jurisdiction_short_code": "DSCC",
        "verification_status": "pending_verification",
        "source_reference": "DSCC Engineering Division (Candidate)",
    },
    {
        "category": "Waste Management",
        "authority_id": "AUTH-DSCC",
        "department_name": "Waste Management Department",
        "jurisdiction_short_code": "DSCC",
        "verification_status": "pending_verification",
        "source_reference": "DSCC Waste Management (Candidate)",
    },
    {
        "category": "Water Supply",
        "authority_id": "AUTH-DWASA",
        "department_name": "Water Maintenance Division",
        "jurisdiction_short_code": "DSCC",
        "verification_status": "pending_verification",
        "source_reference": "DWASA Scope of Service (Candidate)",
    },
    {
        "category": "Drainage / Sewerage",
        "authority_id": "AUTH-DSCC",
        "department_name": "Drainage Division",
        "jurisdiction_short_code": "DSCC",
        "verification_status": "pending_verification",
        "source_reference": "DSCC Drainage Division (Candidate)",
    },
    {
        "category": "Street Lighting",
        "authority_id": "AUTH-DSCC",
        "department_name": "Electrical Division",
        "jurisdiction_short_code": "DSCC",
        "verification_status": "pending_verification",
        "source_reference": "DSCC Electrical Division (Candidate)",
    },
    {
        "category": "Public Infrastructure",
        "authority_id": "AUTH-DSCC",
        "department_name": "Civil Engineering Department",
        "jurisdiction_short_code": "DSCC",
        "verification_status": "pending_verification",
        "source_reference": "DSCC Municipal Works (Candidate)",
    },
    {
        "category": "Other",
        "authority_id": "AUTH-DSCC",
        "department_name": "Public Grievance Redress Cell",
        "jurisdiction_short_code": "DSCC",
        "verification_status": "pending_verification",
        "source_reference": "DSCC Public Facilitation (Candidate)",
    },
]


def get_authority(authority_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve an authority by its ID."""
    if not authority_id:
        return None
    auth = AUTHORITY_REGISTRY.get(authority_id)
    return dict(auth) if auth else None


def list_authorities(authority_type: Optional[str] = None) -> List[Dict[str, Any]]:
    """Return all registered candidate authorities, optionally filtered by type."""
    items = list(AUTHORITY_REGISTRY.values())
    if authority_type:
        items = [i for i in items if i.get("authority_type") == authority_type]
    return [dict(i) for i in items]


def get_department_responsibility(category: str, jurisdiction_short_code: str) -> Optional[Dict[str, Any]]:
    """Lookup the department responsibility for a category and jurisdiction code."""
    for rule in DEPARTMENT_RESPONSIBILITY_MAP:
        if (rule["category"].strip().lower() == category.strip().lower() and
                rule["jurisdiction_short_code"] == jurisdiction_short_code):
            return dict(rule)
    return None
