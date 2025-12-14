# API Gateway

> **Dumb, but effective proxy.**
> Single entry layer for the PulsePay platform.

---

## 📋 Overview

The API Gateway is a **lightweight reverse proxy** that acts as the single entry point for all external requests. It **does NOT contain business logic** — it only routes requests, validates credentials, and enriches requests with observability metadata.

### Architectural Decision

We chose **plain Node.js/Fastify** instead of NestJS because:

| Criteria      | Node/Fastify       | NestJS                         |
| ------------- | ------------------ | ------------------------------ |
| Lines of code | ~150-200           | ~400-500                       |
| Boot time     | ~100ms             | ~500ms+                        |
| Memory        | ~50MB              | ~100MB+                        |
| Complexity    | Low                | High (DI, decorators, modules) |
| Actual need   | Proxy + middleware | Proxy + middleware             |

**Conclusion:** For a component that only does proxying and middleware, plain Node.js is the right level of simplicity.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           OUTSIDE WORLD                             │
│              (Merchants, Ops Console, Mobile Apps)                  │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────────┐
              │         API GATEWAY         │
              │      (Node.js/Fastify)      │
              │                             │
              │  ┌───────────────────────┐  │
              │  │ 1. Correlation ID     │  │  ← Generates unique UUID
              │  │ 2. Rate Limiting      │  │  ← Protects against abuse
              │  │ 3. Request Logging    │  │  ← Structured logging
              │  │ 4. OpenTelemetry      │  │  ← Starts trace/span
              │  │ 5. Proxy Pass         │  │  ← Forwards request
              │  └───────────────────────┘  │
              └──────────┬──────────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   ┌─────────┐    ┌─────────────┐   ┌──────────┐
   │ orders  │    │   search    │   │ webhooks │
   │ service │    │   service   │   │ service  │
   │ (NestJS)│    │  (NestJS)   │   │ (NestJS) │
   └─────────┘    └─────────────┘   └──────────┘
```

---

## ✅ What It DOES

| Responsibility       | Description                                                                                                           | Implementation                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **Correlation ID**   | Generates a secure, non-predictable ID per request using UUID + SHA256 salt, propagates via `X-Correlation-ID` header | Plugin                        |
| **Rate Limiting**    | Limits requests per IP (100/min default), Redis-backed for distributed environments                                   | `@fastify/rate-limit` + Redis |
| **Error Handling**   | Standardized error responses following RFC 7807 with enhanced fields for debugging                                    | Plugin + Error Classes        |
| **Request Logging**  | Structured JSON log for each request                                                                                  | Pino logger                   |
| **OpenTelemetry**    | Starts spans and propagates trace context                                                                             | `@opentelemetry/sdk-node`     |
| **Health Check**     | `/health` endpoint for load balancers                                                                                 | Route handler                 |
| **Proxy Pass**       | Forwards requests to internal services                                                                                | `@fastify/http-proxy`         |

---

## ❌ What It DOES NOT DO

- ❌ **Controllers** — none. Route logic lives in downstream services.
- ❌ **DTOs/Validation** — it does not validate request bodies. Services do that.
- ❌ **Business logic** — zero. It only forwards requests.
- ❌ **Database access** — it does not connect to PostgreSQL/MySQL.
- ❌ **State** — stateless. Redis is only used for distributed rate limiting.

---

## � Correlation ID

Every request receives a unique, secure correlation ID that follows the request through all downstream services.

### Format

```
{timestamp-hash}-{uuid}-{salt-hash}
     8 chars      36 chars   8 chars

Example: 35d23671-2b1a1b95-75bb-4db2-877c-14a81a67fb04-6c83bc28
```

### Security Features

| Feature            | Description                                                     |
| ------------------ | --------------------------------------------------------------- |
| **UUID v4**        | Cryptographically random, globally unique                       |
| **Timestamp Hash** | SHA256 of timestamp + random noise (prevents timing attacks)    |
| **Salt Hash**      | SHA256 of 16 random bytes (prevents ID prediction/enumeration)  |
| **Validation**     | Incoming IDs are validated (length, format, allowed chars only) |

### Usage

```bash
# The gateway generates the ID automatically
curl -i http://localhost:3000/health
# Response header: x-correlation-id: 35d23671-2b1a1b95-75bb-4db2-877c-14a81a67fb04-6c83bc28

# You can also pass your own ID (must be valid format)
curl -H "X-Correlation-ID: my-custom-id-12345" http://localhost:3000/health
# Response header: x-correlation-id: my-custom-id-12345
```

### Propagation

The correlation ID is:

1. Generated on incoming request (or reused if valid header exists)
2. Added to all log entries automatically
3. Included in response headers
4. Forwarded to downstream services (when proxy routes are implemented)

---

## 🚨 Error Response Pattern

All errors follow a **standardized response format** inspired by RFC 7807 (Problem Details for HTTP APIs), enhanced for better developer experience.

### Response Structure

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please slow down and try again.",
    "details": "You have exceeded the limit of 10 requests per 60 seconds.",
    "timestamp": "2025-12-14T04:25:02.380Z",
    "path": "/api/v1/orders",
    "method": "POST",
    "correlationId": "35d23671-2b1a1b95-75bb-4db2-877c-14a81a67fb04-6c83bc28",
    "retryAfter": 42,
    "docs": "https://docs.pulsepay.io/errors/rate-limit-exceeded"
  }
}
```

### Error Fields

| Field           | Type     | Description                                      |
| --------------- | -------- | ------------------------------------------------ |
| `success`       | boolean  | Always `false` for errors                        |
| `code`          | string   | Machine-readable error code (e.g., `BAD_REQUEST`) |
| `message`       | string   | Human-readable message (safe for end users)      |
| `details`       | string?  | Technical details (development only)             |
| `timestamp`     | string   | ISO 8601 timestamp                               |
| `path`          | string   | Request path                                     |
| `method`        | string   | HTTP method                                      |
| `correlationId` | string   | Unique request ID for tracing                    |
| `retryAfter`    | number?  | Seconds to wait (for rate limit errors)          |
| `docs`          | string   | Link to error documentation                      |

### Error Codes

| Code                   | HTTP Status | Description                          |
| ---------------------- | ----------- | ------------------------------------ |
| `BAD_REQUEST`          | 400         | Invalid request syntax               |
| `VALIDATION_FAILED`    | 400         | Request validation failed            |
| `UNAUTHORIZED`         | 401         | Authentication required              |
| `FORBIDDEN`            | 403         | Insufficient permissions             |
| `RESOURCE_NOT_FOUND`   | 404         | Resource or route not found          |
| `METHOD_NOT_ALLOWED`   | 405         | HTTP method not supported            |
| `CONFLICT`             | 409         | Resource conflict                    |
| `RATE_LIMIT_EXCEEDED`  | 429         | Too many requests                    |
| `INTERNAL_ERROR`       | 500         | Unexpected server error              |
| `SERVICE_UNAVAILABLE`  | 503         | Service temporarily unavailable      |
| `GATEWAY_TIMEOUT`      | 504         | Upstream service timeout             |

### Usage in Code

```typescript
import { ApiException, ErrorCodes } from './errors/index.js';

// Throwing errors
throw new ApiException(ErrorCodes.BAD_REQUEST, 'Invalid order ID format');

// With retry-after (rate limiting)
throw new ApiException(ErrorCodes.RATE_LIMIT_EXCEEDED, 'Too many requests', 60);
```

### Example Responses

**Rate Limit Exceeded (429):**
```bash
curl -s http://localhost:3000/health  # After 10+ requests in 60s
```
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please slow down and try again.",
    "retryAfter": 42,
    "docs": "https://docs.pulsepay.io/errors/rate-limit-exceeded"
  }
}
```

**Not Found (404):**
```bash
curl -s http://localhost:3000/nonexistent
```
```json
{
  "success": false,
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "The requested resource was not found.",
    "details": "Route GET /nonexistent not found",
    "docs": "https://docs.pulsepay.io/errors/resource-not-found"
  }
}
```

---

## 🔒 Rate Limiting

The gateway protects against abuse with distributed rate limiting using Redis.

### Configuration

| Variable               | Default | Description                    |
| ---------------------- | ------- | ------------------------------ |
| `RATE_LIMIT_ENABLED`   | `false` | Enable/disable rate limiting   |
| `RATE_LIMIT_USE_REDIS` | `false` | Use Redis for distributed rate limiting |
| `RATE_LIMIT_MAX`       | `100`   | Max requests per window        |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Window duration in ms (1 min)  |
| `REDIS_ENABLED`        | `false` | Enable Redis connection        |
| `REDIS_URL`            | -       | Redis connection URL           |

### Response Headers

When rate limiting is enabled, responses include:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1734150000
Retry-After: 42  (only on 429 responses)
```

### Testing Rate Limits

```bash
# Send 11 requests rapidly (with limit of 10)
for i in {1..11}; do curl -s -w "HTTP %{http_code}\n" http://localhost:3000/health; done

# Expected: First 10 return 200, 11th returns 429 with error response
```

---

## 🔀 Routing

| Method | External Path        | Internal Target                           | Service            |
| ------ | -------------------- | ----------------------------------------- | ------------------ |
| `*`    | `/api/v1/orders/*`   | `http://orders-service:3001/orders/*`     | orders-service     |
| `*`    | `/api/v1/search/*`   | `http://search-service:3002/search/*`     | search-service     |
| `*`    | `/api/v1/webhooks/*` | `http://webhooks-service:3003/webhooks/*` | webhooks-service   |
| `GET`  | `/health`            | local                                     | Health check       |
| `GET`  | `/ready`             | local                                     | Readiness check    |
| `GET`  | `/metrics`           | local                                     | Prometheus metrics |

---

## 📁 Folder Structure (to be implemented)

```
api-gateway/
├── .devcontainer/
│   ├── devcontainer.json       # VS Code devcontainer config
│   ├── docker-compose.yaml     # Container + network config
│   └── docker/
│       └── api-gateway.Dockerfile
│
├── src/
│   ├── index.ts                # Entry point (~30 lines)
│   ├── app.ts                  # Fastify app setup (~50 lines)
│   │
│   ├── errors/                 # Error handling
│   │   └── index.ts            # Error codes, classes, builders
│   │
│   ├── plugins/                # Fastify plugins
│   │   ├── correlation-id.ts   # X-Correlation-ID middleware
│   │   ├── error-handler.ts    # Global error handler
│   │   ├── rate-limit.ts       # Rate limiting config
│   │   ├── request-logger.ts   # Structured logging
│   │   └── tracing.ts          # OpenTelemetry setup
│   │
│   ├── routes/
│   │   ├── health.ts           # /health, /ready, /metrics
│   │   └── proxy.ts            # Proxy routes to services
│   │
│   └── config/
│       └── index.ts            # Environment variables
│
├── test/
│   ├── health.test.ts
│   └── proxy.test.ts
│
├── package.json
├── tsconfig.json
├── .eslintrc.js
├── .prettierrc
├── Dockerfile                  # Production build
├── README.md
└── CHANGELOG.md
```

---

## 🔧 Configuration (Environment Variables)

| Variable                      | Default                        | Description                          |
| ----------------------------- | ------------------------------ | ------------------------------------ |
| `PORT`                        | `3000`                         | Server port                          |
| `NODE_ENV`                    | `development`                  | Runtime environment                  |
| `LOG_LEVEL`                   | `debug`                        | Log level (debug, info, warn, error) |
| `ORDERS_SERVICE_URL`          | `http://orders-service:3001`   | orders-service URL                   |
| `SEARCH_SERVICE_URL`          | `http://search-service:3002`   | search-service URL                   |
| `WEBHOOKS_SERVICE_URL`        | `http://webhooks-service:3003` | webhooks-service URL                 |
| `REDIS_URL`                   | `redis://redis:6379`           | Redis for rate limiting              |
| `RATE_LIMIT_MAX`              | `100`                          | Max requests per window              |
| `RATE_LIMIT_WINDOW_MS`        | `60000`                        | Window in ms (1 min)                 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4318`   | OpenTelemetry collector endpoint     |
| `OTEL_SERVICE_NAME`           | `api-gateway`                  | Service name for tracing             |

---

## 📦 Dependencies (to install)

```json
{
  "dependencies": {
    "fastify": "^4.x",
    "@fastify/cors": "^8.x",
    "@fastify/rate-limit": "^9.x",
    "@fastify/http-proxy": "^9.x",
    "@fastify/redis": "^6.x",
    "@opentelemetry/api": "^1.x",
    "@opentelemetry/sdk-node": "^0.x",
    "@opentelemetry/auto-instrumentations-node": "^0.x",
    "@opentelemetry/exporter-trace-otlp-http": "^0.x",
    "pino": "^8.x",
    "uuid": "^9.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "@types/node": "^20.x",
    "tsx": "^4.x",
    "vitest": "^1.x",
    "eslint": "^8.x",
    "prettier": "^3.x"
  }
}
```

---

## 🚀 Quick Start

### Prerequisites

1. The infrastructure devcontainer is running (the `pulsepay-network` network is active)
2. VS Code with the Dev Containers extension

### Steps

```bash
# 1. Open in a new VS Code window
cd api-gateway
code .

# 2. Reopen in Container (when VS Code prompts)

# 3. Install dependencies
npm install

# 4. Run in development
npm run dev

# 5. Test health check
curl http://localhost:3000/health
```

---

## 🔍 Example Flow

```
1. Merchant sends a request:
   POST http://localhost:3000/api/v1/orders
   Headers: { "Content-Type": "application/json" }
   Body: { "customer_id": "cust_123", "amount_cents": 15000 }

2. API Gateway processes it:
   a) Generates Correlation ID: "550e8400-e29b-41d4-a716-446655440000"
   b) Checks rate limit: OK (23/100 requests in the last minute)
   c) Starts OpenTelemetry span: "POST /api/v1/orders"
   d) Logs: { "correlation_id": "...", "method": "POST", "path": "/api/v1/orders" }
   e) Proxies to: http://orders-service:3001/orders
      Added headers: {
        "X-Correlation-ID": "550e8400-e29b-41d4-a716-446655440000",
        "traceparent": "00-abc123-def456-01"
      }

3. orders-service processes and responds (201 Created)

4. API Gateway completes:
   a) Receives the response from orders-service
   b) Ends the span (latency: 45ms)
   c) Logs: { "correlation_id": "...", "status": 201, "latency_ms": 45 }
   d) Returns the response to the merchant
```

---

## 🧪 Tests

```bash
# Unit tests
npm test

# Coverage
npm run test:coverage

# E2E (requires infrastructure + services)
npm run test:e2e
```

---

## 📊 Observability

### Logs (stdout - JSON)

```json
{
  "level": "info",
  "time": "2025-12-13T20:00:00.000Z",
  "correlation_id": "550e8400-e29b-41d4-a716-446655440000",
  "method": "POST",
  "path": "/api/v1/orders",
  "status": 201,
  "latency_ms": 45,
  "service": "api-gateway"
}
```

### Traces (Jaeger)

- Open: http://localhost:16686
- Search for: `service=api-gateway`
- Inspect spans propagated to orders-service

### Metrics (Prometheus)

- Endpoint: `GET /metrics`
- Exposed metrics:
  - `http_requests_total{method, path, status}`
  - `http_request_duration_seconds{method, path}`
  - `rate_limit_hits_total`

---

## 🔗 Infrastructure Connectivity

The container connects to the `pulsepay-network` network (created by the infrastructure devcontainer):

```yaml
# docker-compose.yaml
networks:
  pulsepay-network:
    external: true # Use the existing network
```

This enables access to:

- `redis:6379` — Distributed rate limiting
- `otel-collector:4318` — Trace export
- `orders-service:3001` — Proxy target (when it exists)

---

## 📝 Notes for the Next AI Agent

### Context

- This is a **dumb proxy** — do not add business logic here.
- Controllers, DTOs, and validation belong to **downstream services** (orders-service, etc.).
- Use **Fastify** (not Express, not NestJS).

### Next Steps

1. Create `package.json` with the dependencies listed above
2. Create `tsconfig.json` for TypeScript
3. Implement `src/index.ts` (entry point)
4. Implement `src/app.ts` (Fastify setup)
5. Implement plugins: correlation-id, rate-limit, tracing, request-logger
6. Implement routes: health, proxy
7. Add basic tests
8. Test connectivity to infrastructure (Redis, OTEL)

### Standards to Follow

- **Logging:** Use Pino with structured JSON
- **Errors:** Return JSON `{ error: string, correlation_id: string }`
- **Health:** Return `{ status: "ok", timestamp: string, version: string }`
- **Config:** Use environment variables (already defined in docker-compose)

### Expected NPM Commands

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest",
    "test:coverage": "vitest --coverage",
    "lint": "eslint src/",
    "format": "prettier --write src/"
  }
}
```

---

## 📚 References

- [Fastify Documentation](https://fastify.dev/docs/latest/)
- [OpenTelemetry Node.js](https://opentelemetry.io/docs/instrumentation/js/)
- [API Gateway Pattern](https://microservices.io/patterns/apigateway.html)
- [PulsePay Main README](../README.md)
