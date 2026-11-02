# UrbanFix AI Engineering Review

This review is intentionally incremental. It preserves the FastAPI backend, MongoDB repository, Gemini integration, and existing single-page UI while extracting correctness-critical rules into small services.

## P0 — Security, privacy, and critical correctness

### P0.1 Public API returned persistence documents directly — implemented

1. Problem: `/api/complaints` returned raw complaint documents, making future private-field additions easy to leak.
2. Why it matters: transparency must not expose reporter identity, device fingerprints, or exact device-level coordinates.
3. Design: explicit public serializer with denylisted private fields and reduced coordinate precision.
4. Files: `app/services/privacy.py`, `app/api/routes/complaints.py`.
5. Implementation: all public list responses pass through `public_complaint`; pagination metadata is returned separately.
6. Tests: private fields absent, coordinates rounded, pagination correct.
7. Regression risk: clients relying on more than four coordinate decimal places must migrate.

### P0.2 Impossible complaint closure states — implemented

1. Problem: transition rules were duplicated in a route and resolution approval could bypass a single lifecycle authority.
2. Why it matters: a complaint could become resolved without the full verification contract being consistently enforced.
3. Design: centralized finite-state transition validation; evidence and all required approvals precede closure.
4. Files: `app/services/lifecycle.py`, `app/api/routes/complaints.py`.
5. Implementation: explicit transitions, lifecycle timestamps, actor/source metadata, evidence and verification guards.
6. Tests: direct Submitted → Resolved is rejected; existing resolution proof workflow remains covered.
7. Regression risk: legacy UI/actions that skip `Acknowledged` or `Resolution Submitted` may receive HTTP 409 and must use valid steps.

### P0.3 Upload MIME spoofing — implemented

1. Problem: upload trust relied on the caller-provided MIME header.
2. Why it matters: non-image content could be stored as evidence.
3. Design: enforce size, allowed MIME, and matching file magic; generate server-side filenames/extensions.
4. Files: `app/services/storage/cloudinary.py`.
5. Implementation: JPEG/PNG/GIF/WebP signatures, WebP RIFF validation, Cloudinary timeout, local preservation fallback.
6. Tests: unsupported MIME and spoofed JPEG are rejected.
7. Regression risk: malformed images previously accepted are now rejected with HTTP 415.

### P0.4 WhatsApp trust and replay protection — implemented for normalized webhook contract

1. Problem: only an unsigned demo endpoint existed.
2. Why it matters: anyone could forge or replay intake requests.
3. Design: verification token, HMAC signature, provider message ID, idempotent acknowledgement.
4. Files: `app/api/routes/whatsapp.py`, `app/core/config.py`.
5. Implementation: production `/webhook` GET/POST paths; demo path remains isolated for demonstrations.
6. Tests: signed webhook creates once; replay returns the original tracking ID.
7. Regression risk: real Meta payload normalization still needs an adapter because the current production contract expects UrbanFix-normalized fields.

## P1 — Core reliability and workflow

### P1.1 AI output treated as a recommendation — strengthened

1. Problem: validation existed but confidence thresholds were hardcoded and uncertain duplicates lacked a review artifact.
2. Why it matters: model output is probabilistic and provider failures are normal.
3. Design: configured thresholds, structured normalized fields, fallback rules, review flags, override history.
4. Files: `app/core/config.py`, `app/services/ai/gemini.py`, `app/services/workflow.py`, `app/api/routes/complaints.py`.
5. Implementation: AI confidence remains visible; invalid values normalize safely; low confidence and ambiguous duplicates require review; Gemini failure preserves reporting through deterministic fallback.
6. Tests: AI fallback and review rules; duplicate-confidence behavior.
7. Regression risk: threshold changes affect auto-routing volume and require operational monitoring.

### P1.2 Duplicate matching was binary — implemented confidence-based candidate scoring

1. Problem: category + exact area/simple text matching silently merged reports.
2. Why it matters: false merges hide real incidents; false negatives flood the map.
3. Design: score description similarity, geographic distance, time proximity, category, and unresolved state.
4. Files: `app/services/workflow.py`, `app/api/routes/complaints.py`.
5. Implementation: high confidence auto-merges; medium confidence creates a reviewable `duplicate_suggestion`; resolved issues are excluded.
6. Tests: uncertain matches are scored but not silently merged.
7. Regression risk: tuning requires real labeled data; current weights are transparent heuristics, not learned truth.

### P1.3 Sensitive actions lacked append-only audit events — partially implemented

1. Problem: status history mixed user-facing timeline and security audit concerns.
2. Why it matters: assignments, approvals, funding, and overrides need actor/before/after/reason provenance.
3. Design: separate append-only `audit_events` collection.
4. Files: `app/services/audit.py`, complaint/offer/repair routes, repository indexes.
5. Implementation: complaint transitions, resolution approvals/evidence, offers, and youth funding decisions emit events.
6. Tests: critical flows remain covered; audit-specific query tests remain recommended.
7. Regression risk: multi-document writes are not transactional yet; an audit insertion failure could occur after a domain update.

### P1.4 Unsafe youth participation — implemented

1. Problem: any unresolved complaint could receive a youth repair proposal.
2. Why it matters: electrical, fire, gas, structural, crime, traffic-emergency, hazardous, and critical work must use trained responders.
3. Design: deterministic eligibility service used at report creation and enforced at proposal creation.
4. Files: `app/services/volunteer_safety.py`, complaint and repair routes.
5. Implementation: public eligibility explanation plus server-side denial regardless of UI.
6. Tests: critical exposed electrical wiring cannot be claimed.
7. Regression risk: keyword rules may conservatively block safe edge cases; administrators need a future reviewed override, never an automatic bypass.

## P2 — Architecture and maintainability

### Implemented

- Extracted lifecycle, audit, privacy, and volunteer safety services from route handlers.
- Centralized confidence, pagination, upload, and webhook configuration.
- Added consistent public pagination contract.
- Added valid offer state transitions and one-active-assignment protection.

### Implemented in the production refinement

- Replaced runtime Babel, React, Tailwind, Lucide, Leaflet, and font CDN loading with a locked Vite build and hashed assets.
- Extracted API transport, icon registry, and the authority review dialog from the application shell; feature boundaries are now explicit and can be migrated route-by-route without changing API semantics.
- Added Vitest component/API tests and Playwright desktop/mobile layout coverage.

## P3 — Performance and scalability

### Implemented

- Pagination with bounded page sizes.
- Compound complaint indexes for queue/category/severity/time access.
- Audit, session, user, idempotency, webhook, and repair-owner indexes.
- Map list payload no longer includes known private fields.

### Implemented in the production refinement

- Added a GeoJSON `2dsphere` index and bounded geospatial queries.
- Added server-side, zoom-aware map clustering with a 2,000-cluster response ceiling and a graceful client fallback.
- Wrapped complaint/offer/proof/payment state and audit writes in repository transactions (memory rollback in tests; Mongo sessions in production).

Move AI/image analysis to a durable job queue only when measured traffic or synchronous latency justifies the additional operational system.

Tests: geospatial bounding queries, pagination stability, load tests at 10k/100k synthetic records. Regression risks: coordinate migration and cluster UX changes.

## P4 — UX and polish

### Implemented previously and preserved

- Responsive light/dark UI, public map state colors, clear admin filters, youth account persistence, inline auth errors, proof-specific workflow, loading/error feedback.

### Implemented in the production refinement

- Replaced the browser prompt with an accessible authority review sheet containing editable classification, severity, department, and a required decision note.
- Added clustered map behavior, two-party resolution language, bounded progress transitions, consistent evidence states, and payment/reference visibility.
- Preserved the accountability methodology next to operational metrics and reserved confirmation UI for final review/release actions.

## Operational acceptance criteria

- A temporary Gemini failure still creates a report with `analysis_source=fallback-rules` and review warning.
- The same idempotency key or WhatsApp provider message ID never intentionally creates a second complaint.
- Public complaint responses contain no reporter contact, source fingerprint, or internal user identifiers.
- Resolved requires evidence and all configured approvals.
- Dangerous issues cannot be assigned to youth/volunteers.
- Every sensitive state change is attributable by request ID plus audit actor/source.
- `/api/health` reports dependencies; `/api/ready` reports service readiness.
