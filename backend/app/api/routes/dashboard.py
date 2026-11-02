from fastapi import APIRouter, Depends
from app.core.security import require_admin

from app.db.repository import civic_repo
from app.services.ai.gemini import generate_governance_insight
from app.services.analytics.calculations import build_dashboard_stats
from app.core.config import settings

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("")
async def dashboard_overview(_admin: dict = Depends(require_admin)):
    complaints = await civic_repo.list_all("complaints")
    offers = await civic_repo.list_all("offers")
    stats = build_dashboard_stats(complaints, offers)
    aggregate = await civic_repo.aggregate_complaint_counts()
    if aggregate:
        totals = aggregate["totals"]
        stats.update({
            "active_issues": totals.get("active", 0),
            "critical_queue": totals.get("critical", 0),
            "critical_count": totals.get("critical", 0),
            "needs_review": totals.get("needs_review", 0),
            "offers_sent": aggregate["offers_sent"],
            "resolution_rate": round(totals.get("resolved", 0) / max(totals.get("total", 0), 1) * 100),
            "category_counts": aggregate["categories"],
            "severity_counts": aggregate["severities"],
            "top_category": max(aggregate["categories"], key=aggregate["categories"].get) if aggregate["categories"] else "None",
        })
    insight = await generate_governance_insight(stats)
    return {
        "stats": stats,
        "priority_queue": sorted(complaints, key=lambda item: item["priority_score"], reverse=True)[:10],
        "map_markers": [
            {
                "complaint_id": item["complaint_id"],
                "area": item["location"]["area"],
                "latitude": item["location"].get("latitude"),
                "longitude": item["location"].get("longitude"),
                "severity": item["severity"],
                "priority_score": item["priority_score"],
                "status": item["status"],
                "safety_flag": item.get("safety_flag", False),
                "hotspot_warning": item.get("hotspot_warning", False),
            }
            for item in complaints
        ],
        "needs_review": [item for item in complaints if item.get("needs_review")],
        "system_health": {
            "ai": "gemini-configured" if settings.gemini_api_key else "deterministic-fallback",
            "database": "memory-demo" if civic_repo.use_memory else "mongodb",
            "messaging": "future-module-disabled",
            "privacy": "public map hides reporter identity",
        },
        "insight": insight,
    }
