# Deployment Notes

## Recommended: single Render service

The included `render.yaml` builds the Docker image, serves the frontend at `/`, and serves the API at `/api`. Set secret environment variables in Render rather than committing `.env`.

## Backend

FastAPI can be deployed to:

- Alibaba Cloud ECS or container service
- Render
- Railway
- Any Docker-compatible host

Required environment variables are listed in `backend/.env.example`.

For production, keep `ALLOW_MEMORY_FALLBACK=false` so a broken database connection fails visibly instead of accepting temporary in-memory data.

## Database

Use MongoDB Atlas for the hackathon demo if local MongoDB is not available.

Local development defaults to in-memory fallback. The Render configuration disables that fallback so production data cannot silently disappear.
