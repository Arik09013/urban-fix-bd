from __future__ import annotations

from copy import deepcopy
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import logging
import secrets

from app.core.config import settings

try:
    from motor.motor_asyncio import AsyncIOMotorClient
except ImportError:
    AsyncIOMotorClient = None

logger = logging.getLogger(__name__)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def public_id(prefix: str, length: int = 10) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return f"{prefix}-" + "".join(secrets.choice(alphabet) for _ in range(length))


def clean_mongo_doc(doc: dict | None) -> dict | None:
    if not doc:
        return None
    item = dict(doc)
    item.pop("_id", None)
    return item


class CivicRepository:
    def __init__(self) -> None:
        self.client = None
        self.db = None
        self.use_memory = True
        self.connection_error = None
        self.memory = {
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

    async def connect(self) -> None:
        allow_memory_fallback = settings.allow_memory_fallback and settings.environment != "production"
        if AsyncIOMotorClient is None:
            self.connection_error = "MongoDB driver is unavailable"
            self.use_memory = True
            if not allow_memory_fallback:
                raise RuntimeError(self.connection_error)
            return
        try:
            self.client = AsyncIOMotorClient(
                settings.mongo_uri,
                serverSelectionTimeoutMS=10000,
                tz_aware=True,
            )
            await self.client.admin.command("ping")
            self.db = self.client[settings.mongo_db_name]
            await self.db.users.create_index("email", unique=True)
            await self.db.sessions.create_index("token_hash", unique=True)
            await self.db.sessions.create_index("expires_at", expireAfterSeconds=0)
            await self.db.repair_requests.create_index([("applicant_user_id", 1), ("created_at", -1)])
            await self.db.complaints.create_index("complaint_id", unique=True)
            await self.db.offers.create_index("offer_id", unique=True)
            await self.db.repair_requests.create_index("request_id", unique=True)
            await self.db.audit_events.create_index("event_id", unique=True)
            await self.db.complaints.create_index([("status", 1), ("priority_score", -1), ("created_at", -1)])
            await self.db.complaints.create_index([("category", 1), ("severity", 1), ("created_at", -1)])
            await self.db.complaints.create_index([("location.latitude", 1), ("location.longitude", 1)])
            await self.db.complaints.create_index([("location_geo", "2dsphere")])
            await self.db.audit_events.create_index([("entity_type", 1), ("entity_id", 1), ("created_at", -1)])
            await self.db.idempotency_keys.create_index("key", unique=True)
            await self.db.idempotency_keys.create_index("expires_at", expireAfterSeconds=0)
            await self.db.webhook_events.create_index("provider_event_id", unique=True)
            await self.db.report_owners.create_index("token_hash", unique=True)
            await self.db.report_owners.create_index("expires_at", expireAfterSeconds=0)
            await self.db.discussion_votes.create_index([("post_id", 1), ("user_id", 1)], unique=True)
            self.use_memory = False
            self.connection_error = None
        except Exception as exc:
            self.client = None
            self.db = None
            self.use_memory = True
            self.connection_error = f"{type(exc).__name__}: {exc}"
            if not allow_memory_fallback:
                logger.error("MongoDB unavailable and fallback is disabled: %s", self.connection_error)
                raise RuntimeError(
                    "MongoDB connection failed. Check Atlas network access and DNS resolution, "
                    "or enable ALLOW_MEMORY_FALLBACK for local development."
                ) from exc
            logger.warning(
                "MongoDB is temporarily unavailable; UrbanFix started in non-persistent local mode: %s",
                self.connection_error,
            )

    async def close(self) -> None:
        if self.client:
            self.client.close()

    @asynccontextmanager
    async def transaction(self):
        """Atomic unit for related domain and audit writes.

        Memory mode snapshots state for deterministic tests. MongoDB uses a
        session transaction and therefore requires a replica set/Atlas.
        """
        if self.use_memory or self.client is None:
            snapshot = deepcopy(self.memory)
            try:
                yield None
            except Exception:
                self.memory = snapshot
                raise
            return
        async with await self.client.start_session() as session:
            async with session.start_transaction():
                yield session

    async def storage_status(self) -> dict:
        if self.use_memory or self.db is None:
            return {"mode": "memory", "used_mb": 0, "threshold_mb": settings.mongo_cleanup_threshold_mb}
        stats = await self.db.command("dbStats", scale=1024 * 1024)
        return {
            "mode": "mongodb",
            "used_mb": round(float(stats.get("dataSize", 0)), 2),
            "storage_mb": round(float(stats.get("storageSize", 0)), 2),
            "threshold_mb": settings.mongo_cleanup_threshold_mb,
        }

    async def enforce_storage_budget(self) -> int:
        """Report storage pressure without silently destroying accountability data."""
        if self.use_memory or self.db is None:
            return 0
        try:
            status = await self.storage_status()
            if status["used_mb"] <= settings.mongo_cleanup_threshold_mb:
                return 0
            logger.error("MongoDB storage budget exceeded (%s MB). Automatic deletion is disabled; archive through a reviewed retention process.", status["used_mb"])
            return 0
        except Exception as exc:
            logger.error("MongoDB retention check failed without blocking the write: %s", exc)
            return 0

    async def ensure_demo_data(self) -> None:
        if await self.count("discussions") == 0:
            await self.insert_many("discussions", [
                {
                    "post_id": "DISC-1001",
                    "author_name": "Tanvir",
                    "area": "Agrabad, Chattogram",
                    "topic": "Clean streets",
                    "message": "Civic responsibility starts when shopkeepers and commuters stop throwing waste onto public pedestrian paths.",
                    "upvotes": 18,
                    "created_at": now_utc(),
                },
                {
                    "post_id": "DISC-1002",
                    "author_name": "Nusrat",
                    "area": "GEC Circle, Chattogram",
                    "topic": "Report with proof",
                    "message": "Clear photos and accurate GPS pins help ward supervisors and cleanup crews respond much faster.",
                    "upvotes": 11,
                    "created_at": now_utc(),
                },
            ])

        if await self.count("complaints") == 0:
            ts = now_utc()
            await self.insert_many("complaints", [
            {
                "complaint_id": "CP-9082", "data_label": "Demo",
                "description": "Large asphalt crater near Agrabad Commercial Area access road. Motor vehicles and rickshaws are swerving sharply into oncoming traffic.",
                "location": {"area": "Agrabad Commercial Area", "latitude": 22.3262, "longitude": 91.8124},
                "image_url": None,
                "category": "Road Infrastructure",
                "severity": "High",
                "confidence": 0.93,
                "summary": "Asphalt road damage causing hazardous traffic obstruction near Agrabad commercial corridor.",
                "department": "Engineering Department (Road Maintenance)",
                "assigned_authority": {
                    "authority_id": "AUTH-CCC",
                    "authority_name": "Chattogram City Corporation",
                    "short_code": "CCC",
                    "department": "Engineering Department (Road Maintenance)",
                    "jurisdiction": "Chattogram Metropolitan Area",
                    "routing_status": "assigned",
                    "assignment_status": "auto_assigned",
                    "routing_method": "administrative_area_keyword",
                    "routing_confidence": 0.88,
                    "authority_data_status": "candidate_registry",
                    "jurisdiction_data_status": "keyword_inferred",
                    "integration_status": "simulated",
                    "environment": "demo",
                    "data_status": "pending_verification",
                    "assignment_reason": "Matched to Chattogram City Corporation (Engineering Department (Road Maintenance)) via administrative_area_keyword.",
                    "assigned_at": ts.isoformat(),
                },
                "initial_assigned_authority": {
                    "authority_id": "AUTH-CCC",
                    "authority_name": "Chattogram City Corporation",
                    "short_code": "CCC",
                    "department": "Engineering Department (Road Maintenance)",
                    "jurisdiction": "Chattogram Metropolitan Area",
                    "routing_status": "assigned",
                    "assignment_status": "auto_assigned",
                    "routing_method": "administrative_area_keyword",
                    "routing_confidence": 0.88,
                    "authority_data_status": "candidate_registry",
                    "jurisdiction_data_status": "keyword_inferred",
                    "integration_status": "simulated",
                    "environment": "demo",
                    "data_status": "pending_verification",
                    "assignment_reason": "Matched to Chattogram City Corporation (Engineering Department (Road Maintenance)) via administrative_area_keyword.",
                    "assigned_at": ts.isoformat(),
                },
                "priority_score": 84,
                "priority_breakdown": {"severity": 38, "citizen_signal": 22, "waiting_time": 10, "location_impact": 14},
                "duplicate_count": 7,
                "status": "Assigned",
                "channel": "Portal",
                "created_at": ts,
                "updated_at": ts,
                "status_history": [
                    {"status": "Submitted", "note": "Citizen report received.", "at": ts},
                    {"status": "AI Analyzed", "note": "Classified as road infrastructure.", "at": ts},
                    {"status": "Assigned", "note": "Routed to Chattogram City Corporation — Engineering Department (Road Maintenance).", "at": ts},
                ],
            },
            {
                "complaint_id": "CP-7194", "data_label": "Demo",
                "description": "Severe waterlogging and overflow along Muradpur main road following morning rainfall. Commuters and school students cannot cross the junction.",
                "location": {"area": "Muradpur Junction", "latitude": 22.3654, "longitude": 91.8291},
                "image_url": None,
                "category": "Drainage / Sewerage",
                "severity": "Critical",
                "confidence": 0.91,
                "summary": "Monsoon drainage overflow causing critical standing water at major transit intersection.",
                "department": "Drainage & Flood Management Circle",
                "assigned_authority": {
                    "authority_id": "AUTH-CCC",
                    "authority_name": "Chattogram City Corporation",
                    "short_code": "CCC",
                    "department": "Drainage & Flood Management Circle",
                    "jurisdiction": "Chattogram Metropolitan Area",
                    "routing_status": "assigned",
                    "assignment_status": "auto_assigned",
                    "routing_method": "administrative_area_keyword",
                    "routing_confidence": 0.88,
                    "authority_data_status": "candidate_registry",
                    "jurisdiction_data_status": "keyword_inferred",
                    "integration_status": "simulated",
                    "environment": "demo",
                    "data_status": "pending_verification",
                    "assignment_reason": "Matched to Chattogram City Corporation (Drainage & Flood Management Circle) via administrative_area_keyword.",
                    "assigned_at": ts.isoformat(),
                },
                "initial_assigned_authority": {
                    "authority_id": "AUTH-CCC",
                    "authority_name": "Chattogram City Corporation",
                    "short_code": "CCC",
                    "department": "Drainage & Flood Management Circle",
                    "jurisdiction": "Chattogram Metropolitan Area",
                    "routing_status": "assigned",
                    "assignment_status": "auto_assigned",
                    "routing_method": "administrative_area_keyword",
                    "routing_confidence": 0.88,
                    "authority_data_status": "candidate_registry",
                    "jurisdiction_data_status": "keyword_inferred",
                    "integration_status": "simulated",
                    "environment": "demo",
                    "data_status": "pending_verification",
                    "assignment_reason": "Matched to Chattogram City Corporation (Drainage & Flood Management Circle) via administrative_area_keyword.",
                    "assigned_at": ts.isoformat(),
                },
                "priority_score": 94,
                "priority_breakdown": {"severity": 46, "citizen_signal": 20, "waiting_time": 8, "location_impact": 20},
                "duplicate_count": 12,
                "status": "Submitted",
                "channel": "Portal",
                "created_at": ts,
                "updated_at": ts,
                "status_history": [{"status": "Submitted", "note": "Citizen report received.", "at": ts}],
            },
            {
                "complaint_id": "CP-5510", "data_label": "Demo",
                "description": "Unmanaged solid waste accumulation beside residential street near Nasirabad Housing Society.",
                "location": {"area": "Nasirabad Housing Society", "latitude": 22.3587, "longitude": 91.8215},
                "image_url": None,
                "category": "Waste Management",
                "severity": "Medium",
                "confidence": 0.88,
                "summary": "Overflowing municipal waste pile obstructing pedestrian pathway.",
                "department": "Conservancy Department (Waste Management)",
                "assigned_authority": {
                    "authority_id": "AUTH-CCC",
                    "authority_name": "Chattogram City Corporation",
                    "short_code": "CCC",
                    "department": "Conservancy Department (Waste Management)",
                    "jurisdiction": "Chattogram Metropolitan Area",
                    "routing_status": "assigned",
                    "assignment_status": "auto_assigned",
                    "routing_method": "administrative_area_keyword",
                    "routing_confidence": 0.88,
                    "authority_data_status": "candidate_registry",
                    "jurisdiction_data_status": "keyword_inferred",
                    "integration_status": "simulated",
                    "environment": "demo",
                    "data_status": "pending_verification",
                    "assignment_reason": "Matched to Chattogram City Corporation (Conservancy Department (Waste Management)) via administrative_area_keyword.",
                    "assigned_at": ts.isoformat(),
                },
                "initial_assigned_authority": {
                    "authority_id": "AUTH-CCC",
                    "authority_name": "Chattogram City Corporation",
                    "short_code": "CCC",
                    "department": "Conservancy Department (Waste Management)",
                    "jurisdiction": "Chattogram Metropolitan Area",
                    "routing_status": "assigned",
                    "assignment_status": "auto_assigned",
                    "routing_method": "administrative_area_keyword",
                    "routing_confidence": 0.88,
                    "authority_data_status": "candidate_registry",
                    "jurisdiction_data_status": "keyword_inferred",
                    "integration_status": "simulated",
                    "environment": "demo",
                    "data_status": "pending_verification",
                    "assignment_reason": "Matched to Chattogram City Corporation (Conservancy Department (Waste Management)) via administrative_area_keyword.",
                    "assigned_at": ts.isoformat(),
                },
                "priority_score": 67,
                "priority_breakdown": {"severity": 30, "citizen_signal": 12, "waiting_time": 5, "location_impact": 20},
                "duplicate_count": 4,
                "status": "Resolved",
                "resolution_approvals": {"contractor": True, "government": True},
                "fully_verified": True,
                "channel": "Portal",
                "created_at": ts,
                "updated_at": ts,
                "status_history": [{"status": "Resolved", "note": "Demo case resolved.", "at": ts}],
            },
            ])

        if await self.count("contractors") == 0:
            await self.insert_many("contractors", [
            {
                "contractor_id": "CTR-1001",
                "name": "Karnaphuli Civil Works Team",
                "contact": "+880 1711 111111",
                "service_area": "Agrabad & Port Zone",
                "skills": ["Potholes", "Concrete patch", "Road Infrastructure", "Night crew"],
                "rating": 4.9,
                "completed_jobs": 43,
                "distance_km": 1.8,
                "verified": True,
                "available": True,
                "trust_score": 94,
            },
            {
                "contractor_id": "CTR-1002",
                "name": "Bay Green Environmental Crew",
                "contact": "+880 1819 222222",
                "service_area": "Nasirabad & GEC",
                "skills": ["Waste Management", "Drain cleaning", "Rapid response"],
                "rating": 4.7,
                "completed_jobs": 31,
                "distance_km": 2.4,
                "verified": True,
                "available": True,
                "trust_score": 88,
            },
            {
                "contractor_id": "CTR-1003",
                "name": "Chattogram Urban Electricians",
                "contact": "+880 1912 333333",
                "service_area": "Muradpur & Chawkbazar",
                "skills": ["Street Lighting", "Inspection", "Electrical repair"],
                "rating": 4.8,
                "completed_jobs": 56,
                "distance_km": 3.1,
                "verified": True,
                "available": True,
                "trust_score": 91,
            },
            ])

        from app.api.routes.auth import ensure_demo_officers
        await ensure_demo_officers()

    async def count(self, collection: str) -> int:
        if self.use_memory:
            return len(self.memory[collection])
        return await self.db[collection].count_documents({})

    async def complaints_in_bbox(self, west: float, south: float, east: float, north: float, limit: int = 1000) -> list[dict]:
        if self.use_memory:
            matches = []
            for item in self.memory["complaints"]:
                location = item.get("location") or {}
                lat, lon = location.get("latitude"), location.get("longitude")
                if isinstance(lat, (int, float)) and isinstance(lon, (int, float)) and south <= lat <= north and west <= lon <= east:
                    matches.append(deepcopy(item))
            return matches[:limit]
        polygon = {"type": "Polygon", "coordinates": [[[west, south], [east, south], [east, north], [west, north], [west, south]]]}
        cursor = self.db.complaints.find({"location_geo": {"$geoWithin": {"$geometry": polygon}}}).sort("priority_score", -1).limit(limit)
        return [clean_mongo_doc(item) async for item in cursor]

    async def complaint_clusters(self, west: float, south: float, east: float, north: float, zoom: int) -> list[dict]:
        """Return bounded spatial clusters instead of transferring every marker."""
        cell = max(0.002, 360 / ((2 ** zoom) * 8))
        if self.use_memory:
            groups: dict[tuple[int, int], list[dict]] = {}
            for item in await self.complaints_in_bbox(west, south, east, north, 100_000):
                location = item.get("location") or {}
                lat, lng = location.get("latitude"), location.get("longitude")
                if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
                    groups.setdefault((int(lat // cell), int(lng // cell)), []).append(item)
            return [{
                "cluster_id": f"{key[0]}:{key[1]}:{zoom}", "latitude": sum(i["location"]["latitude"] for i in items) / len(items),
                "longitude": sum(i["location"]["longitude"] for i in items) / len(items), "count": len(items),
                "max_priority": max(i.get("priority_score", 0) for i in items),
                "critical_count": sum(1 for i in items if i.get("severity") == "Critical"),
                "complaint_id": items[0].get("complaint_id") if len(items) == 1 else None,
            } for key, items in groups.items()]
        polygon = {"type": "Polygon", "coordinates": [[[west, south], [east, south], [east, north], [west, north], [west, south]]]}
        pipeline = [
            {"$match": {"location_geo": {"$geoWithin": {"$geometry": polygon}}}},
            {"$project": {"complaint_id": 1, "priority_score": 1, "severity": 1, "lng": {"$arrayElemAt": ["$location_geo.coordinates", 0]}, "lat": {"$arrayElemAt": ["$location_geo.coordinates", 1]}}},
            {"$group": {"_id": {"x": {"$floor": {"$divide": ["$lng", cell]}}, "y": {"$floor": {"$divide": ["$lat", cell]}}}, "latitude": {"$avg": "$lat"}, "longitude": {"$avg": "$lng"}, "count": {"$sum": 1}, "max_priority": {"$max": "$priority_score"}, "critical_count": {"$sum": {"$cond": [{"$eq": ["$severity", "Critical"]}, 1, 0]}}, "ids": {"$push": "$complaint_id"}}},
            {"$limit": 2000},
        ]
        rows = [clean_mongo_doc(item) async for item in self.db.complaints.aggregate(pipeline)]
        return [{"cluster_id": f"{row['_id']['x']}:{row['_id']['y']}:{zoom}", "latitude": row["latitude"], "longitude": row["longitude"], "count": row["count"], "max_priority": row.get("max_priority", 0), "critical_count": row.get("critical_count", 0), "complaint_id": row["ids"][0] if row["count"] == 1 else None} for row in rows]

    async def aggregate_complaint_counts(self) -> dict | None:
        """Exact server-side counters for high-volume dashboards.

        Detailed latency medians continue to use the bounded operational sample;
        headline totals and distributions never depend on that sample size.
        """
        if self.use_memory:
            return None
        facets = {
            "totals": [{"$group": {
                "_id": None, "total": {"$sum": 1},
                "active": {"$sum": {"$cond": [{"$ne": ["$status", "Resolved"]}, 1, 0]}},
                "resolved": {"$sum": {"$cond": [{"$eq": ["$status", "Resolved"]}, 1, 0]}},
                "critical": {"$sum": {"$cond": [{"$eq": ["$severity", "Critical"]}, 1, 0]}},
                "needs_review": {"$sum": {"$cond": ["$needs_review", 1, 0]}},
                "duplicates": {"$sum": {"$max": [{"$subtract": [{"$ifNull": ["$duplicate_count", 1]}, 1]}, 0]}},
            }}],
            "categories": [{"$group": {"_id": {"$ifNull": ["$category", "Other"]}, "count": {"$sum": 1}}}],
            "severities": [{"$group": {"_id": {"$ifNull": ["$severity", "Medium"]}, "count": {"$sum": 1}}}],
            "channels": [{"$group": {"_id": {"$ifNull": ["$channel", "Portal"]}, "count": {"$sum": 1}}}],
            "departments": [{"$match": {"status": {"$ne": "Resolved"}}}, {"$group": {"_id": {"$ifNull": ["$department", "Unassigned"]}, "count": {"$sum": 1}}}, {"$sort": {"count": -1}}],
            "areas": [{"$group": {"_id": {"$ifNull": ["$location.area", "Unknown"]}, "count": {"$sum": 1}}}, {"$sort": {"count": -1}}, {"$limit": 6}],
        }
        rows = await self.db.complaints.aggregate([{"$facet": facets}]).to_list(length=1)
        row = rows[0] if rows else {}
        return {
            "totals": (row.get("totals") or [{}])[0],
            **{key: {item["_id"]: item["count"] for item in row.get(key, [])} for key in ("categories", "severities", "channels", "departments", "areas")},
            "offers_sent": await self.db.offers.count_documents({}),
        }

    async def insert_one(self, collection: str, item: dict, *, session=None) -> dict:
        record = deepcopy(item)
        if self.use_memory:
            self.memory[collection].append(record)
            return record
        await self.db[collection].insert_one(record, session=session)
        await self.enforce_storage_budget()
        return clean_mongo_doc(record)

    async def insert_many(self, collection: str, items: list[dict]) -> None:
        if self.use_memory:
            self.memory[collection].extend(deepcopy(items))
            return
        await self.db[collection].insert_many(deepcopy(items))
        await self.enforce_storage_budget()

    async def list_all(self, collection: str) -> list[dict]:
        if self.use_memory:
            return deepcopy(self.memory[collection])
        docs = await self.db[collection].find({}).to_list(length=500)
        return [clean_mongo_doc(doc) for doc in docs]

    async def list_page(self, collection: str, *, skip: int = 0, limit: int = 100, query: dict | None = None, sort=None) -> list[dict]:
        if self.use_memory:
            items = deepcopy(self.memory[collection])
            if query:
                items = [item for item in items if all(item.get(key) == value for key, value in query.items())]
            if sort:
                for key, direction in reversed(sort):
                    items.sort(key=lambda item: item.get(key, 0), reverse=direction < 0)
            return items[skip:skip + limit]
        cursor = self.db[collection].find(query or {})
        if sort:
            cursor = cursor.sort(sort)
        docs = await cursor.skip(skip).limit(limit).to_list(length=limit)
        return [clean_mongo_doc(doc) for doc in docs]

    async def find_one(self, collection: str, key: str, value: str) -> dict | None:
        if self.use_memory:
            for item in self.memory[collection]:
                if item.get(key) == value:
                    return deepcopy(item)
            return None
        return clean_mongo_doc(await self.db[collection].find_one({key: value}))

    async def find_complaint_by_evidence_filename(self, filename: str) -> dict | None:
        clean_name = filename.split("?")[0].strip()
        if not clean_name:
            return None
        if self.use_memory:
            for item in self.memory["complaints"]:
                img = item.get("image_url") or ""
                after_img = item.get("after_image_url") or ""
                ev = item.get("resolution_evidence") or {}
                ev_url = ev.get("url") or ""
                ev_after = ev.get("after_image_url") or ""
                if any(clean_name in candidate for candidate in (img, after_img, ev_url, ev_after) if candidate):
                    return deepcopy(item)
            return None
        doc = await self.db.complaints.find_one({
            "$or": [
                {"image_url": {"$regex": clean_name}},
                {"after_image_url": {"$regex": clean_name}},
                {"resolution_evidence.after_image_url": {"$regex": clean_name}},
                {"resolution_evidence.url": {"$regex": clean_name}},
            ]
        })
        return clean_mongo_doc(doc)

    async def update_one(self, collection: str, key: str, value: str, changes: dict, *, session=None) -> dict | None:
        changes = deepcopy(changes)
        changes["updated_at"] = now_utc()
        if self.use_memory:
            for index, item in enumerate(self.memory[collection]):
                if item.get(key) == value:
                    item.update(changes)
                    self.memory[collection][index] = item
                    return deepcopy(item)
            return None
        await self.db[collection].update_one({key: value}, {"$set": changes}, session=session)
        return clean_mongo_doc(await self.db[collection].find_one({key: value}, session=session))

    async def delete_one(self, collection: str, key: str, value: str) -> bool:
        if self.use_memory:
            before = len(self.memory[collection])
            self.memory[collection] = [item for item in self.memory[collection] if item.get(key) != value]
            return len(self.memory[collection]) < before
        result = await self.db[collection].delete_one({key: value})
        return result.deleted_count == 1


civic_repo = CivicRepository()
