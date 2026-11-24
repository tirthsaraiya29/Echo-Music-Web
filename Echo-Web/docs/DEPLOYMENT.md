# Echo Music Web — Production Deployment Guide

## Architecture Overview

Echo Music Web consists of:
1. **Frontend**: Vite-built Single Page Application (React 19, TypeScript, TailwindCSS v4, Zustand, TanStack Query).
2. **API Backend**: Fast, lightweight Hono service (`server/index.ts`) running on `@hono/node-server`.

## Deployment Strategies

### Strategy A: Unified Node.js Container / PaaS (Recommended)
In this model, the single Node.js process serves both the Hono `/api/*` endpoints and the compiled static assets (`./dist`) with SPA client-side routing fallback.

1. Build the production assets:
   ```bash
   npm run build
   ```
2. Start the production server:
   ```bash
   npm start
   ```
3. Environment variables:
   - `PORT`: Port to listen on (default `3000`).
   - `STATIC_DIR`: Path to the compiled static assets (default `./dist`).
   - `CORS_ORIGINS`: Comma-separated list of allowed origins (e.g. `https://echo.example.com`).
   - `POTOKEN`: (Optional) YouTube PO token for stream resolution.
   - `VISITOR_DATA`: (Optional) YouTube visitor data token.

### Strategy B: Split Deployment (Static CDN + Dedicated Backend API)
In this model, static files are hosted on Cloudflare Pages, Vercel, Netlify, or S3/CloudFront, and the Hono API server runs independently (e.g. on Fly.io, Railway, Render, or Docker).

1. **Frontend Configuration**:
   - Set build-time variable: `VITE_API_BASE_URL=https://api.echo.example.com`
   - Build client: `npm run build`
   - Deploy `dist/` to your static host.
2. **Backend Configuration**:
   - Set `CORS_ORIGINS=https://echo.example.com`
   - Run backend: `node server/index.ts`
   - Configure health check at `/api/health`.

### Strategy C: Docker Deployment
A production-ready multi-stage `Dockerfile` is included:
```bash
docker build -t echo-music-web .
docker run -p 3000:3000 -e PORT=3000 echo-music-web
```

## Health Checks & Monitoring
- Endpoint: `GET /api/health`
- Response:
  ```json
  {
    "status": "ok",
    "timestamp": 1700000000000,
    "service": "echo-audio-proxy"
  }
  ```
