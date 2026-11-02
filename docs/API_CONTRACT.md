# API Contract

Base URL: `http://localhost:8000/api`

## Health

- `GET /health`

## Complaints

- `GET /complaints`
- `GET /complaints/{complaint_id}`
- `POST /complaints`
- `POST /complaints/analyze` (multipart AI preview; returns permitted EXIF GPS fields when present and a 15-minute signed analysis token; does not store evidence)
- `POST /complaints/with-image` (accepts the signed preview token to avoid duplicate AI analysis, plus confirmed location source and accuracy fields)
- `PATCH /complaints/{complaint_id}/status`
- `POST /complaints/{complaint_id}/resolution-approval`

Resolution map state is derived from `resolution_approvals.contractor` and `resolution_approvals.government`. Contractor evidence plus authority approval produce a fully verified resolution; the citizen does not need an account or approval step.

Location source values are `photo_exif`, `device_gps`, `map_pin`, or `manual`. EXIF coordinates are suggestions only and require explicit confirmation. Exact accuracy and capture time are removed from public complaint responses, and stored images contain no EXIF metadata.

MongoDB retention is checked after inserts. Above `MONGO_CLEANUP_THRESHOLD_MB` (default 450 MB), the oldest resolved complaint bundles are removed first until the database reaches `MONGO_CLEANUP_TARGET_MB` (default 425 MB).

## Dashboard

- `GET /dashboard`

## Contractors

- `GET /contractors`
- `POST /contractors`
- `GET /contractors/match/{complaint_id}`

## Offers

- `GET /offers`
- `POST /offers`
- `PATCH /offers/{offer_id}/status`

## Tracking

- `GET /track/{complaint_id}`

Tracking responses include both a compact summary and the complete complaint record under `complaint` for the citizen timeline and evidence UI.

## Community Repair Funding

- `GET /repair-requests`
- `POST /repair-requests`
- `PATCH /repair-requests/{request_id}/decision`
- `POST /repair-requests/{request_id}/proof`
- `POST /repair-requests/{request_id}/release-funds`

Approved budgets use an explicitly labeled demonstration reservation state. The system does not claim real escrow or money movement. Payment approval cannot be recorded until completion proof has been submitted for authority verification; contractor evidence and authority approval close the complaint.

## Authority Operations

- `GET /operations/incidents/{complaint_id}` — complaint evidence, citizen input, AI assessment, risk flags, recommendation, contractor matches, work orders, and related funding requests.
- `GET /geo/reverse?latitude=...&longitude=...` — cached OpenStreetMap reverse geocoding for user-triggered GPS capture.
