# API Gateway

> **Dumb, but effective proxy.**
> Single entry layer for the PulsePay platform.

---

## 🚀 Quick Start

```bash
# 1. Run database migrations (first time only)
PGPASSWORD=pulsepay_dev psql -h pulse-postgres -U pulsepay -d pulsepay_orders \
  -f src/db/migrations/001_initial_schema.sql

# 2. Start the server (F5 in VS Code or:)
npm run dev

# 3. Test endpoints
curl http://localhost:3000/health
curl http://localhost:3000/metrics

# 4. Register a user
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"SecurePass123!","firstName":"Test","lastName":"User"}'

# 5. Activate user (dev only)
PGPASSWORD=pulsepay_dev psql -h pulse-postgres -U pulsepay -d pulsepay_orders \
  -c "UPDATE users SET status='active', email_verified=true WHERE email='test@example.com';"

# 6. Login and get tokens
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"SecurePass123!"}'

# 7. Access protected route
curl http://localhost:3000/auth/me \
  -H "Authorization: Bearer <access_token>"
```

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

| Responsibility         | Description                                                                                                           | Implementation                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **Correlation ID**     | Generates a secure, non-predictable ID per request using UUID + SHA256 salt, propagates via `X-Correlation-ID` header | Plugin                        |
| **Rate Limiting**      | Limits requests per IP (100/min default), Redis-backed for distributed environments                                   | `@fastify/rate-limit` + Redis |
| **JWT Authentication** | Edge authentication using JWT tokens with role-based access control and permission checks                             | Plugin + Auth Module          |
| **Error Handling**     | Standardized error responses following RFC 7807 with enhanced fields for debugging                                    | Plugin + Error Classes        |
| **Request Logging**    | Structured JSON log for each request                                                                                  | Pino logger                   |
| **OpenTelemetry**      | Starts spans and propagates trace context                                                                             | `@opentelemetry/sdk-node`     |
| **Health Check**       | `/health` endpoint for load balancers                                                                                 | Route handler                 |
| **Proxy Pass**         | Forwards requests to internal services                                                                                | `@fastify/http-proxy`         |

---

## ❌ What It DOES NOT DO

- ❌ **Controllers** — none. Route logic lives in downstream services.
- ❌ **DTOs/Validation** — it does not validate request bodies (except auth). Services do that.
- ❌ **Business logic** — minimal. Only user auth, everything else forwards.
- ✅ **User Database** — PostgreSQL for user accounts and tokens (auth module only).
- ❌ **State** — mostly stateless. Redis for rate limiting and token caching.

---

## 🔗 Correlation ID

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
4. Forwarded to downstream services (via proxy routes)

---

---

## 🔐 JWT Authentication

The API Gateway implements **edge authentication** using JWT (JSON Web Tokens). Authentication is performed at the gateway level, and validated user information is passed to downstream services via headers.

### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          Auth Module                              │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────┐  │
│  │   Interfaces    │ │    Providers    │ │      Services       │  │
│  │  - IAuthProvider│ │  - JWTProvider  │ │  - AuthService      │  │
│  │  - TokenPayload │ │    (jose lib)   │ │  - TokenCacheService│  │
│  │  - AuthResult   │ │                 │ │                     │  │
│  └─────────────────┘ └─────────────────┘ └─────────────────────┘  │
│                              ↓                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │              Fastify Auth Plugin                            │  │
│  │  - request.user (authenticated user payload)                │  │
│  │  - request.authenticate() (manual authentication)          │  │
│  │  - Route-level auth/roles/permissions config                │  │
│  └─────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### SOLID Design

The auth module follows **SOLID principles** for easy future extraction to a microservice:

| Principle                 | Implementation                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| **S**ingle Responsibility | Each class has one job: JWTProvider signs/verifies, TokenCacheService caches, AuthService orchestrates |
| **O**pen/Closed           | New providers (e.g., Paseto) can be added without modifying existing code                              |
| **L**iskov Substitution   | Any IAuthProvider implementation can replace JWTProvider                                               |
| **I**nterface Segregation | Small, focused interfaces (IAuthProvider, ICacheService)                                               |
| **D**ependency Inversion  | AuthService depends on IAuthProvider interface, not JWTProvider directly                               |

### Route Configuration

```typescript
// Public route (no auth)
fastify.get('/health', handler);

// Protected route (auth required)
fastify.get(
  '/api/me',
  {
    config: { auth: true },
  },
  async (request) => {
    return { userId: request.user.sub };
  },
);

// Admin only route
fastify.delete(
  '/api/users/:id',
  {
    config: { auth: true, roles: ['admin'] },
  },
  handler,
);

// Permission-based access
fastify.post(
  '/api/orders',
  {
    config: { auth: true, permissions: ['orders:write'] },
  },
  handler,
);
```

### Token Structure

**Access Token (short-lived, 15m default)**

```json
{
  "sub": "user-123",
  "role": "merchant",
  "permissions": ["orders:read", "orders:write"],
  "type": "access",
  "iss": "pulse-api-gateway",
  "aud": "pulse-services",
  "iat": 1702531200,
  "exp": 1702532100,
  "jti": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

**Refresh Token (long-lived, 7d default)**

```json
{
  "sub": "user-123",
  "type": "refresh",
  "iss": "pulse-api-gateway",
  "aud": "pulse-services",
  "iat": 1702531200,
  "exp": 1703136000,
  "jti": "f6e5d4c3-b2a1-0987-6543-210fedcba098"
}
```

### Token Caching (Redis)

Validated tokens are cached in Redis to avoid repeated cryptographic verification:

| Key Pattern                 | Description                    | TTL                |
| --------------------------- | ------------------------------ | ------------------ |
| `auth:tokens:{hash}`        | Cached validated token payload | Token expiry or 5m |
| `auth:revoked:{jti}`        | Revoked token IDs              | 7 days             |
| `auth:user:{userId}:tokens` | User's active token list       | 7 days             |

### Environment Variables

| Variable                   | Default                 | Description                                        |
| -------------------------- | ----------------------- | -------------------------------------------------- |
| `JWT_ENABLED`              | `true`                  | Enable/disable JWT authentication                  |
| `JWT_SECRET`               | `development-secret...` | Secret for signing tokens (REQUIRED in production) |
| `JWT_ISSUER`               | `pulse-api-gateway`     | Token issuer (iss claim)                           |
| `JWT_AUDIENCE`             | `pulse-services`        | Token audience (aud claim)                         |
| `JWT_ALGORITHM`            | `HS256`                 | Signing algorithm (HS256 or RS256)                 |
| `JWT_ACCESS_TOKEN_EXPIRY`  | `15m`                   | Access token lifetime                              |
| `JWT_REFRESH_TOKEN_EXPIRY` | `7d`                    | Refresh token lifetime                             |
| `JWT_CLOCK_TOLERANCE`      | `60`                    | Clock tolerance in seconds                         |
| `TOKEN_CACHE_ENABLED`      | `true`                  | Enable token caching                               |
| `TOKEN_CACHE_KEY_PREFIX`   | `auth`                  | Redis key prefix                                   |

---

## 👤 Authentication Endpoints

The API Gateway provides complete user authentication with secure password storage and token management.

### Endpoints Overview

| Method | Path               | Auth | Description                 |
| ------ | ------------------ | ---- | --------------------------- |
| `POST` | `/auth/register`   | No   | Create a new user account   |
| `POST` | `/auth/login`      | No   | Authenticate and get tokens |
| `POST` | `/auth/refresh`    | No   | Refresh access token        |
| `POST` | `/auth/logout`     | No   | Revoke refresh token        |
| `GET`  | `/auth/me`         | Yes  | Get current user info       |
| `POST` | `/auth/logout-all` | Yes  | Revoke all user tokens      |

### User Registration

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!",
    "role": "consumer",
    "firstName": "John",
    "lastName": "Doe"
  }'
```

**Response (201):**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "user@example.com",
      "role": "consumer",
      "firstName": "John",
      "lastName": "Doe",
      "isActive": true,
      "createdAt": "2024-01-15T10:30:00.000Z"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### Login

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!"
  }'
```

**Response (200):**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "user@example.com",
      "role": "consumer"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 900
  }
}
```

### Token Refresh

```bash
curl -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }'
```

**Response (200):**

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 900
  }
}
```

### Get Current User

```bash
curl -X GET http://localhost:3000/auth/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Response (200):**

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "role": "consumer",
    "firstName": "John",
    "lastName": "Doe",
    "isActive": true,
    "lastLoginAt": "2024-01-15T12:00:00.000Z",
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
}
```

### Password Requirements

| Requirement        | Minimum                            |
| ------------------ | ---------------------------------- | --------- |
| Length             | 8 characters                       |
| Uppercase          | 1 character                        |
| Lowercase          | 1 character                        |
| Numbers            | 1 digit                            |
| Special Characters | 1 character (`!@#$%^&\*()\_+-=[]{} | ;:,.<>?`) |

### Security Features

| Feature              | Implementation                                      |
| -------------------- | --------------------------------------------------- |
| **Password Hashing** | Argon2id (64MB memory, 3 iterations, 4 parallelism) |
| **Account Lockout**  | 5 failed attempts = 15 minute lock                  |
| **Token Rotation**   | New refresh token on each refresh                   |
| **Token Revocation** | Stored in PostgreSQL + Redis cache                  |
| **Secure Salt**      | Automatic salt with Argon2id                        |

### Database Tables

| Table                   | Description                            |
| ----------------------- | -------------------------------------- |
| `users`                 | User accounts with encrypted passwords |
| `refresh_tokens`        | Active refresh tokens with expiry      |
| `password_reset_tokens` | Password reset tokens (future use)     |

### Environment Variables

| Variable            | Default           | Description       |
| ------------------- | ----------------- | ----------------- |
| `POSTGRES_HOST`     | `pulse-postgres`  | PostgreSQL host   |
| `POSTGRES_PORT`     | `5432`            | PostgreSQL port   |
| `POSTGRES_DB`       | `pulsepay_orders` | Database name     |
| `POSTGRES_USER`     | `pulsepay`        | Database user     |
| `POSTGRES_PASSWORD` | `pulsepay_dev`    | Database password |
| `POSTGRES_POOL_MIN` | `2`               | Minimum pool size |
| `POSTGRES_POOL_MAX` | `10`              | Maximum pool size |

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

| Field           | Type    | Description                                       |
| --------------- | ------- | ------------------------------------------------- |
| `success`       | boolean | Always `false` for errors                         |
| `code`          | string  | Machine-readable error code (e.g., `BAD_REQUEST`) |
| `message`       | string  | Human-readable message (safe for end users)       |
| `details`       | string? | Technical details (development only)              |
| `timestamp`     | string  | ISO 8601 timestamp                                |
| `path`          | string  | Request path                                      |
| `method`        | string  | HTTP method                                       |
| `correlationId` | string  | Unique request ID for tracing                     |
| `retryAfter`    | number? | Seconds to wait (for rate limit errors)           |
| `docs`          | string  | Link to error documentation                       |

### Error Codes

| Code                  | HTTP Status | Description                     |
| --------------------- | ----------- | ------------------------------- |
| `BAD_REQUEST`         | 400         | Invalid request syntax          |
| `VALIDATION_FAILED`   | 400         | Request validation failed       |
| `UNAUTHORIZED`        | 401         | Authentication required         |
| `FORBIDDEN`           | 403         | Insufficient permissions        |
| `RESOURCE_NOT_FOUND`  | 404         | Resource or route not found     |
| `METHOD_NOT_ALLOWED`  | 405         | HTTP method not supported       |
| `CONFLICT`            | 409         | Resource conflict               |
| `RATE_LIMIT_EXCEEDED` | 429         | Too many requests               |
| `INTERNAL_ERROR`      | 500         | Unexpected server error         |
| `SERVICE_UNAVAILABLE` | 503         | Service temporarily unavailable |
| `GATEWAY_TIMEOUT`     | 504         | Upstream service timeout        |

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

| Variable               | Default | Description                             |
| ---------------------- | ------- | --------------------------------------- |
| `RATE_LIMIT_ENABLED`   | `false` | Enable/disable rate limiting            |
| `RATE_LIMIT_USE_REDIS` | `false` | Use Redis for distributed rate limiting |
| `RATE_LIMIT_MAX`       | `100`   | Max requests per window                 |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Window duration in ms (1 min)           |
| `REDIS_ENABLED`        | `false` | Enable Redis connection                 |
| `REDIS_URL`            | -       | Redis connection URL                    |

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

## 📊 Observability

The gateway provides comprehensive observability through tracing, metrics, and structured logging.

### Infrastructure Integration

| Component      | Container              | Port  | Purpose                 |
| -------------- | ---------------------- | ----- | ----------------------- |
| OTEL Collector | `pulse-otel-collector` | 4318  | Receives traces/metrics |
| Jaeger         | `pulse-jaeger`         | 16686 | Trace visualization     |
| Prometheus     | `pulse-prometheus`     | 9090  | Metrics collection      |
| Grafana        | `pulse-grafana`        | 3000  | Dashboards              |

### Tracing (OpenTelemetry)

Distributed tracing is enabled via `OTEL_ENABLED=true`. Traces are exported to the OTEL Collector which forwards them to Jaeger.

```bash
# View traces in Jaeger UI
open http://localhost:16686
# Search for: service=api-gateway
```

Each trace includes:

- Correlation ID as span attribute
- HTTP method, route, status code
- Request duration
- Error details (for 5xx responses)

### Metrics (Prometheus)

The `/metrics` endpoint exposes Prometheus-format metrics.

```bash
curl http://localhost:3000/metrics
```

**Custom Metrics:**

| Metric                                  | Type      | Labels                     | Description                   |
| --------------------------------------- | --------- | -------------------------- | ----------------------------- |
| `gateway_http_requests_total`           | Counter   | method, route, status_code | Total HTTP requests           |
| `gateway_http_request_duration_seconds` | Histogram | method, route, status_code | Request duration distribution |
| `gateway_rate_limit_hits_total`         | Counter   | route                      | Rate limit exceeded count     |
| `gateway_active_connections`            | Gauge     | -                          | Current active connections    |

**Node.js Metrics (auto-collected):**

- `gateway_process_cpu_*` - CPU usage
- `gateway_process_resident_memory_bytes` - Memory usage
- `gateway_nodejs_eventloop_lag_seconds` - Event loop lag
- `gateway_nodejs_heap_*` - Heap statistics

### Structured Logging

All requests are logged in structured JSON format with:

```json
{
  "level": "info",
  "time": "2025-12-14T04:35:00.000Z",
  "msg": "request completed",
  "correlationId": "35d23671-...",
  "method": "GET",
  "url": "/health",
  "statusCode": 200,
  "durationMs": 1.25,
  "ip": "127.0.0.1",
  "traceId": "abc123...",
  "spanId": "def456..."
}
```

Features:

- Automatic correlation ID in all log entries
- Trace/span IDs when OTEL is enabled
- Sensitive headers redacted (Authorization, Cookie, etc.)
- Different log levels based on status code (info: 2xx, warn: 4xx, error: 5xx)

### Configuration

| Variable                      | Default       | Description                  |
| ----------------------------- | ------------- | ---------------------------- |
| `OTEL_ENABLED`                | `false`       | Enable OpenTelemetry tracing |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | -             | OTEL Collector URL           |
| `OTEL_SERVICE_NAME`           | `api-gateway` | Service name in traces       |
| `METRICS_ENABLED`             | `true`        | Enable /metrics endpoint     |
| `LOG_LEVEL`                   | `debug`       | Pino log level               |

---

## 🔀 Routing

| Method | Path                 | Auth | Description                   |
| ------ | -------------------- | ---- | ----------------------------- |
| `GET`  | `/health`            | No   | Health check                  |
| `GET`  | `/ready`             | No   | Readiness check               |
| `GET`  | `/metrics`           | No   | Prometheus metrics            |
| `POST` | `/auth/register`     | No   | Create user account           |
| `POST` | `/auth/login`        | No   | Authenticate & get tokens     |
| `POST` | `/auth/refresh`      | No   | Refresh access token          |
| `POST` | `/auth/logout`       | No   | Revoke refresh token          |
| `GET`  | `/auth/me`           | Yes  | Get current user info         |
| `POST` | `/auth/logout-all`   | Yes  | Revoke all user tokens        |
| `*`    | `/api/v1/orders/*`   | Yes  | → pulse-orders-service:3001   |
| `*`    | `/api/v1/search/*`   | Yes  | → pulse-search-service:3002   |
| `*`    | `/api/v1/webhooks/*` | Yes  | → pulse-webhooks-service:3003 |

---

## ❤️ Health & Readiness

- `GET /health` is a **liveness** probe (process is up) and returns `200` with `status: "ok"`.
- `GET /ready` is a **readiness** probe and checks critical dependencies with short timeouts:
  - `database`: `ok` | `unhealthy` | `skipped` (when DB pool isn’t initialized)
  - `redis`: `ok` | `unhealthy` | `skipped` (when Redis is disabled)
  - `downstream`: `ok` | `unhealthy` | `not_configured` (reported but does **not** block readiness)

`/ready` returns:

- `200` when the gateway is ready
- `503` when core dependencies are unhealthy

Note: tests skip dependency checks (Vitest/test mode) to stay deterministic.

## 📁 Folder Structure

```
api-gateway/
├── .devcontainer/
│   ├── devcontainer.json       # VS Code devcontainer config
│   ├── docker-compose.yaml     # Container + network config
│   └── docker/
│       └── api-gateway.Dockerfile  # Includes process tools & psql
│
├── src/
│   ├── index.ts                # Entry point (~30 lines)
│   ├── app.ts                  # Fastify app setup (~100 lines)
│   │
│   ├── auth/                   # Authentication module
│   │   └── index.ts            # IAuthProvider, JWTProvider, AuthService
│   │
│   ├── config/
│   │   └── index.ts            # Environment variables
│   │
│   ├── db/
│   │   ├── index.ts            # PostgreSQL pool + helpers
│   │   └── migrations/
│   │       └── 001_initial_schema.sql  # Users + refresh_tokens tables
│   │
│   ├── errors/                 # Error handling
│   │   └── index.ts            # Error codes, classes, builders
│   │
│   ├── plugins/                # Fastify plugins
│   │   ├── auth.ts             # JWT auth plugin
│   │   ├── correlation-id.ts   # X-Correlation-ID middleware
│   │   ├── error-handler.ts    # Global error handler
│   │   ├── metrics.ts          # Prometheus /metrics endpoint
│   │   ├── rate-limit.ts       # Rate limiting config
│   │   ├── request-logger.ts   # Structured logging
│   │   └── tracing.ts          # OpenTelemetry setup
│   │
│   ├── redis/
│   │   └── index.ts            # Redis client singleton
│   │
│   ├── routes/
│   │   ├── auth.ts             # /auth/* routes
│   │   ├── health.ts           # /health, /ready
│   │   └── proxy.ts            # Proxy routes to services
│   │
│   └── users/                  # User management module
│       ├── entities/
│       │   ├── refresh-token.entity.ts
│       │   └── user.entity.ts
│       ├── repositories/
│       │   ├── refresh-token.repository.ts
│       │   └── user.repository.ts
│       └── services/
│           └── password.service.ts
│
├── test/
│   ├── health.test.ts
│
│
├── package.json
├── tsconfig.json
├── .eslintrc.js
├── .prettierrc
├── README.md

```

---

## 🔧 Configuration (Environment Variables)

| Variable                      | Default       | Description                          |
| ----------------------------- | ------------- | ------------------------------------ |
| `PORT`                        | `3000`        | Server port                          |
| `NODE_ENV`                    | `development` | Runtime environment                  |
| `LOG_LEVEL`                   | `debug`       | Log level (debug, info, warn, error) |
| `REDIS_URL`                   | -             | Redis for rate limiting              |
| `REDIS_ENABLED`               | `false`       | Enable Redis connection              |
| `RATE_LIMIT_ENABLED`          | `true`        | Enable rate limiting                 |
| `RATE_LIMIT_MAX`              | `100`         | Max requests per window              |
| `RATE_LIMIT_WINDOW_MS`        | `60000`       | Window in ms (1 min)                 |
| `OTEL_ENABLED`                | `false`       | Enable OpenTelemetry tracing         |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | -             | OTEL Collector endpoint              |
| `OTEL_SERVICE_NAME`           | `api-gateway` | Service name for tracing             |
| `METRICS_ENABLED`             | `true`        | Enable Prometheus /metrics endpoint  |
| `ORDERS_SERVICE_URL`          | -             | orders-service URL                   |
| `SEARCH_SERVICE_URL`          | -             | search-service URL                   |
| `WEBHOOKS_SERVICE_URL`        | -             | webhooks-service URL                 |

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
  a) Generates Correlation ID: "35d23671-2b1a1b95-75bb-4db2-877c-14a81a67fb04-6c83bc28"
   b) Checks rate limit: OK (23/100 requests in the last minute)
   c) Starts OpenTelemetry span: "POST /api/v1/orders"
   d) Logs: { "correlation_id": "...", "method": "POST", "path": "/api/v1/orders" }
  e) Proxies to: http://pulse-orders-service:3001
      Added headers: {
      "X-Correlation-ID": "35d23671-2b1a1b95-75bb-4db2-877c-14a81a67fb04-6c83bc28",
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
