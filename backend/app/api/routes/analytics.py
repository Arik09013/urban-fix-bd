from collections import Counter

from fastapi import APIRouter

from app.db.repository import civic_repo
from app.services.analytics.calculations import build_dashboard_stats

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("")
async def analytics_overview():
    complaints = await civic_repo.list_all("complaints")
    offers = await civic_repo.list_all("offers")

    aggregate = await civic_repo.aggregate_complaint_counts()

    categories = Counter(item.get("category", "Other") for item in complaints)
    severities = Counter(item.get("severity", "Medium") for item in complaints)
    departments = Counter(item.get("department", "Unassigned") for item in complaints)
    areas = Counter(item.get("location", {}).get("area", "Unknown") for item in complaints)
    channels = Counter(item.get("channel", "Portal") for item in complaints)
    resolved = sum(1 for item in complaints if item.get("status") == "Resolved")
    active = max(len(complaints) - resolved, 0)
    dashboard_stats = build_dashboard_stats(complaints, offers)

    if aggregate:
        totals = aggregate["totals"]
        categories = Counter(aggregate["categories"])
        severities = Counter(aggregate["severities"])
        channels = Counter(aggregate["channels"])
        departments = Counter(aggregate["departments"])
        areas = Counter(aggregate["areas"])
        resolved = totals.get("resolved", 0)
        active = totals.get("active", 0)

    department_workload = [
        {"department": department, "active": count}
        for department, count in departments.most_common()
    ]
    area_hotspots = [
        {"area": area, "reports": count}
        for area, count in areas.most_common(6)
    ]

    return {
        "category_distribution": dict(categories),
        "severity_distribution": dict(severities),
        "channel_distribution": dict(channels),
        "department_workload": department_workload,
        "area_hotspots": area_hotspots,
        "resolved_vs_active": {"resolved": resolved, "active": active},
        "duplicate_reports": aggregate["totals"].get("duplicates", 0) if aggregate else sum(max(item.get("duplicate_count", 1) - 1, 0) for item in complaints),
        "offers_sent": aggregate["offers_sent"] if aggregate else len(offers),
        "accountability": dashboard_stats["accountability"],
        "methodology": dashboard_stats["methodology"],
    }
