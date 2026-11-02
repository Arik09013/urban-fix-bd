from __future__ import annotations

from html import escape

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse

from app.core.config import settings


router = APIRouter(tags=["public-pages"])

ISSUES = {
    "potholes": ("Report Potholes in Pakistan", "Report road damage with photo and confirmed location evidence, receive a public tracking ID, and follow verified repair progress.", "Potholes damage vehicles, slow emergency access, and create avoidable safety risks. UrbanFix turns a photograph, description, and confirmed map location into a structured road-infrastructure report for transparent municipal follow-up."),
    "waste-management": ("Report Waste and Garbage Problems", "Report uncollected waste and illegal dumping with evidence, location, public tracking, and privacy protection.", "Uncollected waste affects health, drainage, walkability, and neighborhood confidence. UrbanFix records each report as distinct evidence while helping authorities recognize recurring waste hotspots."),
    "drainage": ("Report Drainage and Sewerage Problems", "Report blocked drains, sewerage overflow, and flooding risks with evidence-backed civic tracking.", "Drainage failures can quickly become health and access emergencies. UrbanFix helps residents document the location and severity, while its transparent priority method highlights safety and public-access impact."),
}

CITIES = {
    "multan": ("Report Civic Problems in Multan", "Report potholes, waste, drainage, water, and street-light problems in Multan through a transparent evidence-based workflow."),
    "lahore": ("Report Civic Problems in Lahore", "Create and track evidence-backed civic issue reports across Lahore while protecting reporter identity."),
    "karachi": ("Report Civic Problems in Karachi", "Report and publicly track infrastructure, sanitation, drainage, water, and street-light issues in Karachi."),
}

SEO_PATHS = [
    "/how-it-works", "/methodology", "/privacy",
    *(f"/issues/{slug}" for slug in ISSUES),
    *(f"/cities/{slug}" for slug in CITIES),
]


def _page(request: Request, path: str, title: str, description: str, heading: str, paragraphs: list[str]) -> HTMLResponse:
    base = settings.public_base_url.rstrip("/") or str(request.base_url).rstrip("/")
    canonical = f"{base}{path}"
    body = "".join(f"<p>{escape(paragraph)}</p>" for paragraph in paragraphs)
    links = "".join(f'<li><a href="{href}">{label}</a></li>' for href, label in [
        ("/issues/potholes", "Potholes"), ("/issues/waste-management", "Waste management"),
        ("/issues/drainage", "Drainage"), ("/methodology", "Priority methodology"),
        ("/privacy", "Privacy"), ("/how-it-works", "How it works"),
    ])
    html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape(title)} | UrbanFix</title><meta name="description" content="{escape(description)}"><meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="{escape(canonical)}"><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="website"><meta property="og:title" content="{escape(title)}"><meta property="og:description" content="{escape(description)}"><meta property="og:url" content="{escape(canonical)}"><meta property="og:image" content="{escape(base)}/assets/urbanfix-social.png">
<style>body{{margin:0;background:#0b0f17;color:#dbeafe;font:16px/1.7 system-ui,sans-serif}}main,nav,footer{{max-width:860px;margin:auto;padding:24px}}nav a,a{{color:#38bdf8}}h1{{font-size:clamp(2rem,6vw,3.7rem);line-height:1.08;color:white}}h2{{color:white;margin-top:2rem}}.cta{{display:inline-block;background:#38bdf8;color:#07111f;padding:12px 18px;border-radius:10px;font-weight:700;text-decoration:none}}ul{{display:flex;flex-wrap:wrap;gap:10px 24px;padding-left:20px}}.eyebrow{{color:#38bdf8;font-weight:700;text-transform:uppercase;letter-spacing:.08em}}</style></head>
<body><nav aria-label="Main navigation"><a href="/">UrbanFix home</a><ul>{links}</ul></nav><main><div class="eyebrow">Evidence-backed civic action</div><h1>{escape(heading)}</h1><p>{escape(description)}</p>{body}
<h2>Report with confidence</h2><p>Photos are safely re-encoded, private metadata is removed, reporter identity is not published, and precise public coordinates are reduced. Every accepted report receives a public tracking record.</p><a class="cta" href="/">Open UrbanFix</a></main>
<footer>UrbanFix AI · Transparent civic reporting for Pakistan</footer></body></html>"""
    return HTMLResponse(html)


@router.get("/how-it-works", response_class=HTMLResponse)
async def how_it_works(request: Request):
    return _page(request, "/how-it-works", "How UrbanFix Works", "Learn how UrbanFix turns citizen evidence into prioritized, assigned, and publicly verifiable civic action.", "From a citizen report to verified public action", [
        "A citizen provides a description, photo, and confirmed location. UrbanFix screens the evidence, suggests a category and severity, and routes uncertain cases to human review rather than hiding them.",
        "A transparent priority score combines severity, citizen signals, waiting time, and location impact. Authorities can assign accountable work while citizens follow the status through a public tracking ID.",
        "Resolution requires after-evidence and recorded approvals. This makes completion harder to claim without proof and gives residents a clear way to confirm or dispute the outcome.",
    ])


@router.get("/methodology", response_class=HTMLResponse)
async def methodology(request: Request):
    return _page(request, "/methodology", "Civic Issue Priority Methodology", "Understand how UrbanFix uses explainable signals to prioritize civic problems without letting AI make the final decision.", "Transparent civic priority—not a black box", [
        "UrbanFix uses AI as decision support. It recommends a category, severity, department, and summary with a confidence score; low-confidence and ambiguous cases enter human review.",
        "Priority combines visible severity, public-safety indicators, affected-citizen signals, duplicate reports, location impact, and waiting time. The contributing values remain visible in the accountability record.",
        "Every citizen report remains a source record even when multiple reports are linked to one incident. Officers can override recommendations, but the reason and resulting action are retained in the audit history.",
    ])


@router.get("/privacy", response_class=HTMLResponse)
async def privacy(request: Request):
    return _page(request, "/privacy", "UrbanFix Privacy and Evidence Safety", "How UrbanFix protects reporter identity, photo metadata, precise coordinates, and civic evidence.", "Public accountability without exposing citizens", [
        "Reporter contact details are private and never displayed on the public map. Public text is screened for common phone, email, and identifier patterns before it is returned.",
        "Photo GPS is offered only as a location suggestion and requires explicit confirmation. Images are decoded, orientation-normalized, metadata-stripped, and safely re-encoded before Cloudinary storage.",
        "Public coordinates are deliberately reduced in precision. Private verification tokens are stored as hashes, sessions use HttpOnly cookies, and protected actions require CSRF validation and role authorization.",
    ])


@router.get("/issues/{slug}", response_class=HTMLResponse)
async def issue_page(slug: str, request: Request):
    item = ISSUES.get(slug)
    if not item:
        raise HTTPException(status_code=404, detail="Issue guide not found")
    title, description, intro = item
    return _page(request, f"/issues/{slug}", title, description, title, [intro, "Capture clear evidence without placing yourself in danger. Confirm the actual issue location, add useful observations, and retain the tracking ID so progress can be checked later."])


@router.get("/cities/{slug}", response_class=HTMLResponse)
async def city_page(slug: str, request: Request):
    item = CITIES.get(slug)
    if not item:
        raise HTTPException(status_code=404, detail="City guide not found")
    title, description = item
    return _page(request, f"/cities/{slug}", title, description, title, [
        "Residents can document road damage, waste, drainage, water-supply, street-light, and public-infrastructure problems with a photo, description, and confirmed location.",
        "UrbanFix provides transparent tracking and evidence-backed verification. It is a civic technology pilot and does not impersonate or replace an official municipal emergency channel.",
    ])
