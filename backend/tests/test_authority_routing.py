from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from app.main import app
from app.db.repository import civic_repo, now_utc


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
from app.services.routing.registry import (
    AUTHORITY_REGISTRY,
    get_authority,
    list_authorities,
    get_department_responsibility,
)
from app.services.routing.jurisdiction import (
    resolve_jurisdiction,
    _point_in_polygon,
)
from app.services.routing.engine import route_complaint


client = TestClient(app)


def test_authority_registry_candidates():
    """Verify that expected Bangladesh candidate authorities exist in registry."""
    authorities = list_authorities()
    auth_ids = {a["authority_id"] for a in authorities}
    assert "AUTH-CCC" in auth_ids
    assert "AUTH-DNCC" in auth_ids
    assert "AUTH-DSCC" in auth_ids
    assert "AUTH-CWASA" in auth_ids
    assert "AUTH-DWASA" in auth_ids
    assert "AUTH-DPHE" in auth_ids
    assert "AUTH-BPDB" in auth_ids

    # Critical principle: all initial candidate data must be marked pending_verification
    for auth in authorities:
        assert auth["data_status"] == "pending_verification"
        assert auth["name"]
        assert auth["short_code"]


def test_unknown_authority_returns_none():
    """Unknown authority ID must safely return None without throwing."""
    assert get_authority("AUTH-NONEXISTENT") is None
    assert get_authority("") is None
    assert get_authority(None) is None


def test_category_responsibility_mapping():
    """Verify category mapping rules for primary pilot (Chattogram CCC) and utilities."""
    # Road Infrastructure in Chattogram -> CCC Engineering
    rule_road = get_department_responsibility("Road Infrastructure", "CCC")
    assert rule_road is not None
    assert rule_road["authority_id"] == "AUTH-CCC"
    assert "Engineering Department" in rule_road["department_name"]

    # Waste Management in Chattogram -> CCC Conservancy
    rule_waste = get_department_responsibility("Waste Management", "CCC")
    assert rule_waste is not None
    assert rule_waste["authority_id"] == "AUTH-CCC"
    assert "Conservancy Department" in rule_waste["department_name"]

    # Water Supply in Chattogram -> CWASA
    rule_water = get_department_responsibility("Water Supply", "CCC")
    assert rule_water is not None
    assert rule_water["authority_id"] == "AUTH-CWASA"
    assert "Water Supply" in rule_water["department_name"]


def test_verified_polygon_matching():
    """When verified statutory polygon is provided, resolver returns verified status."""
    # Define a test boundary polygon around Agrabad
    test_polygon = [
        (22.3200, 91.8100),
        (22.3300, 91.8100),
        (22.3300, 91.8200),
        (22.3200, 91.8200),
    ]
    verified_polygons = {"CCC": test_polygon}

    # Point inside polygon
    res_inside = resolve_jurisdiction(
        latitude=22.3250,
        longitude=22.3250 and 91.8150,
        area="Test Ward",
        verified_polygons=verified_polygons,
    )
    assert res_inside["verification_status"] == "verified"
    assert res_inside["jurisdiction_source"] == "verified_polygon_boundary"
    assert res_inside["jurisdiction_short_code"] == "CCC"
    assert res_inside["jurisdiction_confidence"] == 0.99

    # Point outside polygon
    res_outside = resolve_jurisdiction(
        latitude=22.4000,
        longitude=91.9000,
        area="Unknown Forest",
        verified_polygons=verified_polygons,
    )
    assert res_outside["jurisdiction_source"] != "verified_polygon_boundary"


def test_unverified_geographic_match_not_marked_verified():
    """Keyword and bounding-box heuristics must NOT be falsely marked verified."""
    res_keyword = resolve_jurisdiction(area="Agrabad Commercial Area")
    assert res_keyword["jurisdiction_short_code"] == "CCC"
    assert res_keyword["verification_status"] == "pending_verification"
    assert res_keyword["jurisdiction_source"] == "administrative_area_keyword"

    res_bbox = resolve_jurisdiction(latitude=22.33, longitude=91.82, area="Some Unlisted Road")
    assert res_bbox["jurisdiction_short_code"] == "CCC"
    assert res_bbox["verification_status"] == "pending_verification"
    assert res_bbox["jurisdiction_source"] == "geo_bounding_heuristic"


def test_unknown_area_returns_needs_review():
    """When jurisdiction cannot be resolved, router returns needs_review."""
    res = route_complaint(
        category="Road Infrastructure",
        latitude=None,
        longitude=None,
        area="Completely Unrecognized Location 12345",
    )
    assert res["routing_status"] == "needs_review"
    assert res["authority_id"] is None
    assert "review required" in res["assignment_reason"]


def test_missing_coordinates_handled_safely():
    """Missing latitude/longitude should still safely route via area keywords if present."""
    res = route_complaint(
        category="Waste Management",
        latitude=None,
        longitude=None,
        area="Nasirabad Housing Society",
    )
    assert res["routing_status"] == "assigned"
    assert res["authority_id"] == "AUTH-CCC"
    assert res["short_code"] == "CCC"
    assert "Conservancy Department" in res["department"]


def test_ambiguous_responsibility_does_not_force_assignment():
    """Unknown or unmapped civic category must NOT force an assignment."""
    res = route_complaint(
        category="Space Exploration Project",
        latitude=22.3262,
        longitude=91.8124,
        area="Agrabad",
    )
    assert res["routing_status"] == "needs_review"
    assert res["authority_id"] is None


def test_authorities_api_endpoints():
    """Verify GET /api/authorities and /api/authorities/{id}."""
    res = client.get("/api/authorities")
    assert res.status_code == 200
    authorities = res.json()["authorities"]
    assert len(authorities) >= 5

    res_single = client.get("/api/authorities/AUTH-CCC")
    assert res_single.status_code == 200
    data = res_single.json()
    assert data["name"] == "Chattogram City Corporation"
    assert data["short_code"] == "CCC"

    res_missing = client.get("/api/authorities/AUTH-UNKNOWN")
    assert res_missing.status_code == 404


def test_complaint_submission_persists_authority_metadata(monkeypatch):
    """End-to-end complaint submission must persist assigned_authority metadata."""
    reset_memory_repository()

    async def fake_analysis(*_args, **_kwargs):
        return {
            "category": "Road Infrastructure",
            "severity": "High",
            "confidence": 0.94,
            "department": "Roads Department",
            "summary": "Large asphalt road crater blocking traffic in Agrabad.",
            "reasoning": "Visible road damage in commercial corridor.",
            "safety_flag": False,
            "is_civic_issue": True,
            "visual_verification": "verified",
            "analysis_source": "gemini-vision",
        }

    monkeypatch.setattr("app.api.routes.complaints.analyze_complaint", fake_analysis)

    create_res = client.post("/api/complaints", json={
        "description": "Large asphalt road crater blocking traffic near Agrabad.",
        "location": {
            "area": "Agrabad Commercial Area",
            "latitude": 22.3262,
            "longitude": 91.8124,
            "confirmed": True,
        },
        "category_hint": "Road Infrastructure",
    })
    assert create_res.status_code == 200
    complaint = create_res.json()

    assert "assigned_authority" in complaint
    authority = complaint["assigned_authority"]
    assert authority is not None
    assert authority["authority_id"] == "AUTH-CCC"
    assert authority["short_code"] == "CCC"
    assert authority["authority_name"] == "Chattogram City Corporation"
    assert authority["routing_status"] == "assigned"
    assert authority["department"] == "Engineering Department (Road Maintenance)"

    # Verify retrieval
    get_res = client.get(f"/api/complaints/{complaint['complaint_id']}")
    assert get_res.status_code == 200
    retrieved = get_res.json()
    assert retrieved["assigned_authority"]["authority_id"] == "AUTH-CCC"


def test_officer_override_updates_authority(monkeypatch):
    """Admin officer override should update assigned_authority and audit event."""
    import asyncio
    from app.core.security import require_admin
    reset_memory_repository()

    async def fake_analysis(*_args, **_kwargs):
        return {
            "category": "Other",
            "severity": "Low",
            "confidence": 0.50,  # Below threshold -> triggers Needs Review
            "department": "Needs Review",
            "summary": "Unclear issue report.",
            "reasoning": "Low confidence classification.",
            "safety_flag": False,
            "is_civic_issue": True,
            "visual_verification": "verified",
            "analysis_source": "gemini-vision",
        }

    monkeypatch.setattr("app.api.routes.complaints.analyze_complaint", fake_analysis)
    app.dependency_overrides[require_admin] = lambda: {"user_id": "ADMIN-1", "name": "Admin Officer", "role": "admin"}

    try:
        create_res = client.post("/api/complaints", json={
            "description": "Unclear road problem near Agrabad.",
            "location": {"area": "Agrabad", "latitude": 22.3262, "longitude": 91.8124, "confirmed": True},
        })
        assert create_res.status_code == 200
        complaint = create_res.json()
        assert complaint["status"] == "Needs Review"
        assert complaint["assigned_authority"]["routing_status"] == "needs_review"

        # Officer Override
        override_res = client.patch(
            f"/api/complaints/{complaint['complaint_id']}/override",
            json={
                "final_category": "Road Infrastructure",
                "final_severity": "High",
                "final_department": "Engineering Department (Road Maintenance)",
                "final_authority_id": "AUTH-CCC",
                "reason": "Officer verified as Agrabad road crater.",
            },
        )
        assert override_res.status_code == 200
        updated = override_res.json()
        assert updated["status"] == "Submitted"
        assert updated["assigned_authority"]["authority_id"] == "AUTH-CCC"
        assert updated["assigned_authority"]["routing_status"] == "assigned"
        assert updated["assigned_authority"]["routing_method"] == "officer_override"
    finally:
        app.dependency_overrides.pop(require_admin, None)


def test_no_pakistani_demo_data_in_seed():
    """Verify that ensure_demo_data contains no Pakistani references."""
    import asyncio

    async def run_check():
        reset_memory_repository()
        await civic_repo.ensure_demo_data()

        complaints = await civic_repo.list_all("complaints")
        assert len(complaints) == 3
        for c in complaints:
            assert c["data_label"] == "Demo"
            text = f"{c.get('description')} {c.get('location', {}).get('area')}".lower()
            assert "lahore" not in text
            assert "multan" not in text
            assert "karachi" not in text
            assert "johar town" not in text
            # Must have plausible Chattogram coordinates (~22.3, 91.8)
            lat = c["location"]["latitude"]
            lng = c["location"]["longitude"]
            assert 22.0 <= lat <= 23.0
            assert 91.5 <= lng <= 92.5

        discussions = await civic_repo.list_all("discussions")
        for d in discussions:
            text = f"{d.get('area')} {d.get('message')}".lower()
            assert "lahore" not in text
            assert "karachi" not in text

        contractors = await civic_repo.list_all("contractors")
        for ctr in contractors:
            assert "+92" not in ctr.get("contact", "")
            assert "+880" in ctr.get("contact", "")

    asyncio.run(run_check())


# =========================================================================
# Regression Tests for P0 & P1 Critical Safety and Auditability Fixes
# =========================================================================

def test_sitakunda_coords_bbox_does_not_auto_assign_to_ccc():
    """1. Sitakunda coordinates inside the Chattogram bounding box must not auto-assign to CCC."""
    # Sitakunda Upazila coordinates inside the bounding box
    res = route_complaint(
        category="Road Infrastructure",
        latitude=22.48,
        longitude=91.68,
        area="Sitakunda",
    )
    assert res["routing_status"] == "needs_review"
    assert res["assignment_status"] == "needs_review"
    assert res["jurisdiction_data_status"] in ("heuristic_bbox", "unresolved")

    # Even with area=None (pure bbox match)
    res_no_area = route_complaint(
        category="Road Infrastructure",
        latitude=22.48,
        longitude=91.68,
        area=None,
    )
    assert res_no_area["routing_status"] == "needs_review"
    assert res_no_area["assignment_status"] == "needs_review"


def test_hathazari_coords_bbox_does_not_auto_assign_to_ccc():
    """2. Hathazari coordinates inside the bounding box must not auto-assign to CCC."""
    res = route_complaint(
        category="Road Infrastructure",
        latitude=22.50,
        longitude=91.80,
        area="Hathazari",
    )
    assert res["routing_status"] == "needs_review"
    assert res["assignment_status"] == "needs_review"


def test_gulshan_cumilla_does_not_route_to_dncc():
    """3. 'Gulshan, Cumilla' must not route to DNCC."""
    # Via structured area string with city token
    res = route_complaint(
        category="Road Infrastructure",
        area="Gulshan, Cumilla",
    )
    assert res["routing_status"] == "needs_review"
    assert res["short_code"] != "DNCC"
    assert res["assignment_status"] == "needs_review"

    # Via explicit city parameter
    res_city = route_complaint(
        category="Road Infrastructure",
        area="Gulshan",
        city="Cumilla",
    )
    assert res_city["routing_status"] == "needs_review"
    assert res_city["short_code"] != "DNCC"


def test_agrabad_sylhet_does_not_route_to_ccc():
    """4. 'Agrabad, Sylhet' must not route to CCC."""
    res = route_complaint(
        category="Road Infrastructure",
        area="Agrabad, Sylhet",
    )
    assert res["routing_status"] == "needs_review"
    assert res["short_code"] != "CCC"
    assert res["assignment_status"] == "needs_review"

    res_city = route_complaint(
        category="Road Infrastructure",
        area="Agrabad",
        city="Sylhet",
    )
    assert res_city["routing_status"] == "needs_review"
    assert res_city["short_code"] != "CCC"


def test_rajshahi_coords_not_overridden_by_dhaka_keyword():
    """5. Rajshahi coordinates must not be overridden by a conflicting Dhaka keyword."""
    # Rajshahi City coordinates (~24.37, 88.60)
    res = route_complaint(
        category="Road Infrastructure",
        latitude=24.3745,
        longitude=88.6042,
        area="Mirpur",
    )
    assert res["routing_status"] == "needs_review"
    assert res["short_code"] != "DNCC"
    assert res["assignment_status"] == "needs_review"


def test_ambiguous_dhaka_coordinates_require_review():
    """6. Ambiguous Dhaka coordinates must require review."""
    # Coordinates in central Dhaka metro without area keywords
    res = route_complaint(
        category="Road Infrastructure",
        latitude=23.75,
        longitude=90.38,
        area=None,
    )
    assert res["routing_status"] == "needs_review"
    assert res["assignment_status"] == "needs_review"
    assert res["jurisdiction_data_status"] == "heuristic_bbox"


def test_officer_override_semantics_and_status_integrity(monkeypatch):
    """Tests 7, 8, 9, 10, 11:
    7. Officer override must not mutate authority_data_status.
    8. Officer override must not mutate jurisdiction_data_status.
    9. Officer override must set assignment_status = officer_assigned.
    10. initial_assigned_authority must preserve the original routing result.
    11. Repeated overrides must not overwrite the original snapshot.
    """
    from app.core.security import require_admin
    reset_memory_repository()

    async def fake_analysis(*_args, **_kwargs):
        return {
            "category": "Road Infrastructure",
            "severity": "Low",
            "confidence": 0.50,
            "department": "Needs Review",
            "summary": "Pothole on road.",
            "reasoning": "Needs confirmation.",
            "safety_flag": False,
            "is_civic_issue": True,
            "visual_verification": "verified",
            "analysis_source": "gemini-vision",
        }

    monkeypatch.setattr("app.api.routes.complaints.analyze_complaint", fake_analysis)
    app.dependency_overrides[require_admin] = lambda: {"user_id": "ADMIN-1", "name": "Admin Officer", "role": "admin"}

    try:
        # Step A: Create complaint
        create_res = client.post("/api/complaints", json={
            "description": "Road damage in Agrabad.",
            "location": {"area": "Agrabad", "latitude": 22.3262, "longitude": 91.8124, "confirmed": True},
        })
        assert create_res.status_code == 200
        comp = create_res.json()
        cid = comp["complaint_id"]

        # Initial automated snapshot check
        assert "initial_assigned_authority" in comp
        init_snapshot = comp["initial_assigned_authority"]
        assert init_snapshot is not None
        assert init_snapshot["routing_method"] != "officer_override"

        # Step B: First Officer Override
        override1_res = client.patch(
            f"/api/complaints/{cid}/override",
            json={
                "final_category": "Road Infrastructure",
                "final_severity": "High",
                "final_department": "Engineering Department (Road Maintenance)",
                "final_authority_id": "AUTH-CCC",
                "reason": "Officer confirmed Agrabad road crater.",
            },
        )
        assert override1_res.status_code == 200
        up1 = override1_res.json()
        auth1 = up1["assigned_authority"]

        # Test 7: authority_data_status must NOT be "verified"
        assert auth1["authority_data_status"] == "candidate_registry"
        assert auth1["authority_data_status"] != "verified"
        assert auth1["data_status"] == "pending_verification"

        # Test 8: jurisdiction_data_status must NOT be "verified" or "statutory_polygon_verified"
        assert auth1["jurisdiction_data_status"] != "verified"
        assert auth1["jurisdiction_data_status"] != "statutory_polygon_verified"

        # Test 9: assignment_status must be "officer_assigned"
        assert auth1["assignment_status"] == "officer_assigned"

        # Test 10: initial_assigned_authority preserved
        assert up1["initial_assigned_authority"] == init_snapshot
        assert up1["initial_assigned_authority"]["routing_method"] != "officer_override"

        # Step C: Repeated Override (Test 11: Repeated overrides must not overwrite the original snapshot)
        # Re-assign to a utility for test verification
        override2_res = client.patch(
            f"/api/complaints/{cid}/override",
            json={
                "final_category": "Water Supply",
                "final_severity": "Medium",
                "final_department": "Water Supply & Distribution Circle",
                "final_authority_id": "AUTH-CWASA",
                "reason": "Corrected: Underground pipe burst leaking on road.",
            },
        )
        assert override2_res.status_code == 200
        up2 = override2_res.json()
        auth2 = up2["assigned_authority"]

        assert auth2["authority_id"] == "AUTH-CWASA"
        assert auth2["assignment_status"] == "officer_assigned"
        # Original snapshot remains the initial automated triage, NOT the first override!
        assert up2["initial_assigned_authority"] == init_snapshot
        assert up2["initial_assigned_authority"]["authority_id"] != "AUTH-CWASA"

        # Verify audit history captured previous and new authority
        history = up2["status_history"]
        override_events = [h for h in history if h.get("status") == "Officer Override"]
        assert len(override_events) == 2
        assert override_events[1]["previous_authority"]["authority_id"] == "AUTH-CCC"
        assert override_events[1]["new_authority"]["authority_id"] == "AUTH-CWASA"
    finally:
        app.dependency_overrides.pop(require_admin, None)


def test_national_highway_and_ambiguous_sewerage_require_review():
    """12. National highway and ambiguous sewerage incidents must require review unless supported by verified responsibility rules."""
    # Highway incident in Chattogram corridor -> Must NOT auto-assign to CCC
    res_highway = route_complaint(
        category="Road Infrastructure",
        area="Dhaka-Chattogram Highway, Pahartali",
    )
    assert res_highway["routing_status"] == "needs_review"
    assert res_highway["assignment_status"] == "needs_review"
    assert "Ambiguous road jurisdiction" in res_highway["assignment_reason"]

    # Underground sewerage incident in Chattogram -> Must NOT auto-assign to CCC
    res_sewer = route_complaint(
        category="Drainage / Sewerage",
        area="Underground Sewer Line, Muradpur",
    )
    assert res_sewer["routing_status"] == "needs_review"
    assert res_sewer["assignment_status"] == "needs_review"
    assert "Ambiguous sanitation jurisdiction" in res_sewer["assignment_reason"]

    # High-voltage power grid incident in Chattogram -> Must NOT auto-assign to CCC
    res_grid = route_complaint(
        category="Street Lighting",
        area="High Voltage Transformer, Nasirabad",
    )
    assert res_grid["routing_status"] == "needs_review"
    assert res_grid["assignment_status"] == "needs_review"
    assert "Ambiguous electrical jurisdiction" in res_grid["assignment_reason"]


def test_existing_chattogram_pilot_backward_compatible_responses():
    """13. Existing Chattogram pilot cases must retain backward-compatible API responses."""
    # Road Infrastructure in Agrabad
    res_agrabad = route_complaint(
        category="Road Infrastructure",
        area="Agrabad Commercial Area",
    )
    assert res_agrabad["routing_status"] == "assigned"
    assert res_agrabad["assignment_status"] == "auto_assigned"
    assert res_agrabad["authority_id"] == "AUTH-CCC"
    assert res_agrabad["short_code"] == "CCC"
    assert res_agrabad["department"] == "Engineering Department (Road Maintenance)"
    assert res_agrabad["authority_data_status"] == "candidate_registry"
    assert res_agrabad["jurisdiction_data_status"] == "keyword_inferred"
    assert res_agrabad["integration_status"] == "simulated"
    assert res_agrabad["environment"] == "demo"
    assert res_agrabad["data_status"] == "pending_verification"

    # Waste Management in Muradpur
    res_waste = route_complaint(
        category="Waste Management",
        area="Muradpur",
    )
    assert res_waste["routing_status"] == "assigned"
    assert res_waste["authority_id"] == "AUTH-CCC"
    assert res_waste["short_code"] == "CCC"
    assert "Conservancy Department" in res_waste["department"]

    # Water Supply in Nasirabad
    res_water = route_complaint(
        category="Water Supply",
        area="Nasirabad",
    )
    assert res_water["routing_status"] == "assigned"
    assert res_water["authority_id"] == "AUTH-CWASA"
    assert res_water["short_code"] == "CWASA"

