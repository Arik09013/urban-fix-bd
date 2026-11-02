def proof_requirements_for_work(work_type: str) -> list[str]:
    base = ["before_photo", "after_photo", "gps_location", "timestamp", "completion_note"]
    if "streetlight" in work_type.lower():
        return base + ["safety_confirmation"]
    if "pothole" in work_type.lower() or "road" in work_type.lower():
        return base + ["surface_closeup"]
    return base


def calculate_contractor_trust_delta(status: str, citizen_confirmed: bool, admin_approved: bool) -> int:
    if status == "Approved" and citizen_confirmed and admin_approved:
        return 4
    if status == "Rejected":
        return -8
    if status == "Proof Submitted":
        return 1
    return 0
