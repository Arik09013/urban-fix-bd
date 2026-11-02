from fastapi import APIRouter, HTTPException, Query
import httpx

from app.db.repository import civic_repo, now_utc

router = APIRouter(prefix="/api/geo", tags=["geocoding"])


@router.get("/reverse")
async def reverse_geocode(
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
):
    cache_key = f"{latitude:.5f},{longitude:.5f}"
    cached = await civic_repo.find_one("geocoding_cache", "cache_key", cache_key)
    if cached:
        return cached
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={"lat": latitude, "lon": longitude, "format": "jsonv2", "addressdetails": 1, "zoom": 18, "accept-language": "en"},
                headers={"User-Agent": "UrbanFixAI/1.0 (civic issue location lookup)"},
            )
            response.raise_for_status()
        result = response.json()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Address lookup is temporarily unavailable ({type(exc).__name__})")
    address = result.get("address", {})
    record = {
        "cache_key": cache_key,
        "display_name": result.get("display_name") or f"{latitude:.5f}, {longitude:.5f}",
        "area": address.get("suburb") or address.get("neighbourhood") or address.get("village") or address.get("town") or address.get("city"),
        "city": address.get("city") or address.get("town") or address.get("county"),
        "state": address.get("state"),
        "country": address.get("country"),
        "latitude": latitude,
        "longitude": longitude,
        "source": "OpenStreetMap Nominatim",
        "created_at": now_utc(),
    }
    return await civic_repo.insert_one("geocoding_cache", record)
