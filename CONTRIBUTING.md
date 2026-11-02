# Contributing to UrbanFix AI

Thanks for helping improve UrbanFix AI.

## Development workflow

1. Fork the repository and create a focused branch.
2. Copy `backend/.env.example` to `backend/.env`; never commit credentials.
3. Install dependencies with `npm ci` and `backend/.venv/bin/pip install -r backend/requirements.txt`.
4. Keep changes small, documented, and covered by tests where practical.
5. Run the checks below before opening a pull request.

```bash
npm test
npm run build
backend/.venv/bin/pytest -q backend/tests
npm run test:e2e
```

Pull requests should explain the user problem, solution, testing performed, and any configuration or migration impact. For security issues, follow `SECURITY.md` instead of opening a public issue.
