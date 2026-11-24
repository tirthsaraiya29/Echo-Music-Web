# Production Deployment Architecture and Contract

## Overview
Echo Music Web utilizes a lightweight, container-ready Hono Node.js server that hosts both the API audio proxy microservices and serves the compiled client SPA static assets.

## Configuration & Environment Variables
The deployment runtime configuration is validated via Zod (`deploymentConfigSchema`).

| Variable | Type | Default | Description |
|---|---|---|---|
| `PORT` | number | `3000` | Port for the HTTP server to bind to (1-65535) |
| `NODE_ENV` | string | `development` | Deployment environment (`development`, `test`, `production`) |
| `STATIC_DIR` | string | `./dist` | Path to built client SPA static assets |
| `CORS_ORIGINS` | string | `http://localhost:5173` | Comma-separated list of allowed origins |

## API Contracts & Health Endpoints

### 1. Health Check (`GET /api/health`)
Returns runtime service status, uptime, and memory consumption.
- **Response Format**:
  ```json
  {
    "status": "ok",
    "service": "echo-audio-proxy",
    "version": "1.0.0",
    "timestamp": 1700000000000,
    "uptime": 124.5,
    "memory": {
      "rss": 54200000,
      "heapTotal": 32000000,
      "heapUsed": 24000000,
      "external": 1500000
    }
  }
  ```

### 2. Deployment Telemetry (`GET /api/deployment/telemetry`)
Returns aggregate server performance metrics for monitoring.
- **Response Format**:
  ```json
  {
    "requestsHandled": 1420,
    "healthChecks": 50,
    "telemetryRequests": 12,
    "staticAssetsServed": 800,
    "serverErrors": 0,
    "uptimeSeconds": 124
  }
  ```

## Security & Privacy
- Sensitive credentials or tokens are never exposed in error responses or health telemetry.
- Uncaught exceptions and unhandled promise rejections are logged server-side and trigger clean 500 JSON responses.
