# Security Policy

## Reporting a vulnerability

Please do not disclose suspected vulnerabilities in a public issue. Use GitHub's **Security → Report a vulnerability** flow for this repository so maintainers can investigate privately.

Include the affected route or component, reproduction steps, expected impact, and any suggested mitigation. Do not include real citizen data, credentials, access tokens, or unredacted uploaded evidence.

## Deployment guidance

- Replace all development credentials before exposing the service publicly.
- Keep `ALLOW_DEMO_ADMIN=true` only for judging, then disable it and rotate `admin` / `admin`.
- Store secrets only in the deployment platform's encrypted environment settings.
- Keep `ENVIRONMENT=production`, disable memory fallback and demo seeding, and use persistent MongoDB and Cloudinary storage.
- Rotate a credential immediately if it is accidentally committed, even if the commit is later removed.
