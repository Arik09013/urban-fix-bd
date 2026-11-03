from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, HTTPException, Query

from app.services.routing.registry import get_authority, list_authorities

router = APIRouter(prefix="/api/authorities", tags=["authorities"])


@router.get("")
async def get_all_authorities(authority_type: Optional[str] = Query(default=None)):
    """Return registered Bangladesh candidate authorities, optionally filtered by type."""
    return {"authorities": list_authorities(authority_type)}


@router.get("/{authority_id}")
async def get_authority_by_id(authority_id: str):
    """Retrieve details for a specific registered candidate authority."""
    auth = get_authority(authority_id)
    if not auth:
        raise HTTPException(status_code=404, detail="Authority not found in candidate registry")
    return auth
