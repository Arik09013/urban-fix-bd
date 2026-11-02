from __future__ import annotations

import re
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

ALLOWED_HOSTS = {"drive.google.com", "docs.google.com"}


def normalize_drive_url(value: str) -> str:
    url = value.strip()
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
        raise HTTPException(status_code=422, detail="Submit a Google Drive or Google Docs HTTPS link")
    return url


def verification_url(url: str) -> str:
    parsed = urlparse(url)
    file_match = re.search(r"/file/d/([A-Za-z0-9_-]+)", parsed.path)
    if parsed.hostname == "drive.google.com" and file_match:
        return f"https://drive.google.com/uc?export=download&id={file_match.group(1)}"
    return url


async def verify_public_drive_access(value: str) -> dict:
    url = normalize_drive_url(value)
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=10) as client:
            response = await client.get(verification_url(url), headers={"User-Agent": "UrbanFix-Link-Verifier/1.0"})
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="Drive access could not be verified; try again shortly") from exc
    final_host = urlparse(str(response.url)).hostname
    body = response.text[:20000].lower() if "text" in response.headers.get("content-type", "") else ""
    blocked = response.status_code >= 400 or final_host == "accounts.google.com" or "request access" in body
    if blocked:
        raise HTTPException(status_code=422, detail="Drive report is not public. Set General access to 'Anyone with the link' and retry")
    return {"url": url, "verified": True, "verified_at_provider": "google-drive", "http_status": response.status_code}
