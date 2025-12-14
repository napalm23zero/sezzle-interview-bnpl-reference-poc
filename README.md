# Sezzle-Style Showcase Monorepo (36h) — “PulsePay BNPL Platform”

> **Goal:** build a **production-like** mini-platform that demonstrates Sezzle’s full backend + cloud + observability + CI/CD + AI-enablement stack, in a scope that is **deliverable in ~36h**, and that reviewers can run locally in **one command**.

This repo is designed to be a **portfolio artifact**: a small-but-complete BNPL/payment workflow that highlights distributed systems patterns (**transactional outbox**, **event-driven**, **queues**, **idempotency**), strong engineering hygiene (tests, runbooks, ADRs), and AI tooling used responsibly to increase developer productivity.

---
## 🚀 Current Progress

### ✅ Completed
- **Infrastructure Layer** — Full devcontainer setup with all shared services
  - PostgreSQL (Orders + Outbox)
  - MySQL (Ledger double-entry)
  - Redis (Cache + Rate limiting)
  - Elasticsearch (Operational search)
  - LocalStack (AWS SQS/SNS emulation)
  - Full observability stack (Prometheus, Grafana, Jaeger, OTEL Collector)
- **Health Check System** — Automated infrastructure validation script
- **Docker Network** — Isolated `pulsepay-network` for service communication
- **Database Schemas** — Initial schemas for orders, outbox, ledger, and idempotency tracking

### 🔄 In Progress
- API Gateway (Node.js/Fastify - dumb proxy)
- Orders Service (NestJS)

### 📋 Planned
- Go workers (outbox-relay, credit-engine, ledger-processor, search-indexer)
- Search Service
- Webhooks Service
- Ops Console (React)
- AI Ops Assistant

---

## Quick Start

### Prerequisites
- Docker Desktop
- VS Code with Dev Containers extension

### Running the Infrastructure

1. **Open infrastructure folder in VS Code**
   ```bash
   cd infrastructure
   code .
   ```

2. **Reopen in Container** — When prompted, click "Reopen in Container"

3. **Wait for all services** — Docker will pull images and start 11 services

4. **Validate infrastructure**
   ```bash
   ./healthcheck.sh
   ```

### Service URLs (from host machine)

| Service | URL | Credentials |
|---------|-----|-------------|
| Grafana | http://localhost:13000 | admin / admin |
| Jaeger | http://localhost:16686 | - |
| Prometheus | http://localhost:19090 | - |
| Elasticsearch | http://localhost:19200 | - |
| LocalStack | http://localhost:14566 | - |

---
## Product overview

### What we are building
**PulsePay** is a Sezzle-inspired **BNPL + Shopping Journey mini-core** with:

- **BNPL authorization flow** (“Pay in 4” style)
- **Credit decisioning** (simple rules + feature flags + versioned “policy”)
- **Ledger posting** (double-entry minimal ledger)
- **Merchant integration sandbox** (checkout session + webhooks)
- **Operational search** (Elasticsearch indexes orders/decisions/ledger events)
- **Ops console** (React) for day-to-day internal support workflows
- **AI Ops Assistant** that turns a trace/order into an RCA draft + suggested next steps
- **Production-like platform concerns**: observability, security basics, CI/CD, containerized microservices, deploy artifacts, versioning

### Who uses it
- **Merchants**: integrate via “checkout session” + webhooks to complete BNPL purchases
- **Consumers (demo)**: trigger authorization requests
- **Support/Ops**: find purchases, see decision reasons, trace a request end-to-end, and generate RCA drafts

### The “wow” factor (what impresses hiring teams)
- End-to-end **distributed tracing** across services
- **Outbox** ensuring reliable event publication
- **Idempotent consumers** with dedupe + retry + DLQ
- Operational readiness: **SLIs/SLO-friendly metrics**, dashboards, runbooks
- AI used where it matters: **support + incident workflows**, not gimmicks

---

## Scope (36h target)

This project intentionally focuses on a **small domain surface** but a **rich engineering surface**.

### Must-have deliverables
- ✅ 4 microservices + 2 workers (see below)
- ✅ Postgres + MySQL (Aurora-style RDS usage demo)
- ✅ SQS-style queue (LocalStack in dev) with retry + DLQ
- ✅ Transactional outbox + event versioning + idempotency
- ✅ OpenTelemetry + Prometheus + Grafana dashboards
- ✅ Elasticsearch indexing + query examples
- ✅ React (TypeScript) Ops Console
- ✅ CI pipeline (GitLab) + local “one-command” dev
- ✅ AI tool integration (OpenAI API / LangChain / Hugging Face optional) + “AI playbook”
- ✅ Automated tests (unit + integration + e2e smoke)

### Nice-to-have if time remains
- K8s manifests/Helm + kind deploy for “prod-ish” story
- React Native mini screen (working knowledge showcase)
- Terraform for LocalStack “infra-as-code” example

---

## Architecture

### Tech Philosophy: Right Tool for the Right Job

| Layer | Technology | Why |
|-------|------------|-----|
| **REST APIs & Integrations** | **NestJS + TypeScript** | Productivity, decorators, automatic validation, native OpenAPI, excellent DX |
| **High-Performance Workers** | **Go** | High throughput, low latency, memory efficiency for event processing |

**Go shines in:** workers processing thousands of events/second, critical financial operations (ledger), continuous outbox polling.

**NestJS shines in:** REST APIs with rich validation, merchant integrations, order CRUD, general backend work.

---

### Services (NestJS + TypeScript)
1. **api-gateway**  
   - REST entrypoint, request validation, correlation IDs, rate limiting
   - Built with Fastify (lightweight proxy, not NestJS)
2. **orders-service**  
   - Creates BNPL purchase requests (orders)  
   - Stores data in **Postgres** (TypeORM/Prisma)  
   - Writes domain events to **transactional outbox**
3. **search-service**  
   - Exposes Elasticsearch queries for Ops console
   - Rich query building with NestJS + Elastic SDK
4. **webhooks-service**  
   - Delivers webhooks to merchants
   - Retry logic, signature validation

### Workers (Go) — Performance Layer
5. **outbox-relay**  
   - Polls Postgres outbox and publishes events to queue (SQS)
   - High-frequency polling with minimal overhead
6. **credit-engine**  
   - Consumes `OrderCreated` events from queue  
   - Runs decisioning policy (rules + versioning)  
   - Emits `CreditDecisioned` events
   - CPU-bound rules evaluation, low latency critical
7. **ledger-processor**  
   - Consumes `CreditDecisioned` (approved)  
   - Posts a minimal **double-entry ledger** into **MySQL**  
   - Emits `LedgerPosted` events
   - Financial accuracy + high throughput
8. **search-indexer**  
   - Consumes events and indexes documents into **Elasticsearch**
   - Batch processing, event fan-out

### Frontend
7. **ops-console (React + TypeScript)**  
   - Lists orders + decision reasons + ledger status  
   - Search by customer/order in Elasticsearch  
   - “Trace link” for investigating issues quickly

### AI tooling
8. **ai-ops-assistant** (TypeScript/Python, flexible)  
   - Input: `order_id` or `trace_id`  
   - Output: “RCA draft”, suggested investigation steps, and Elastic/SQL queries  
   - Integrates **OpenAI API**, optionally **LangChain** and/or **Hugging Face**

---

## Core flows

### 1) Merchant checkout + session creation
1. Merchant calls `POST /checkout/sessions` (api-gateway → orders-service)
2. orders-service creates `Order` and writes `OrderCreated.v1` to outbox
3. outbox-dispatcher publishes to `orders.created` queue
4. credit-service consumes and emits `CreditDecisioned.v1`
5. ledger-service consumes approvals and emits `LedgerPosted.v1`
6. search-indexer indexes all events for Ops
7. Merchant receives webhook(s) on decision + ledger posted (sandbox)

### 2) Ops investigation flow
- Ops console finds an order via Elastic search
- Opens trace link and sees request across gateway → orders → dispatcher → credit → ledger
- If something looks wrong, uses AI assistant to draft RCA + next steps

---

## Distributed systems patterns implemented

### Transactional outbox
- orders-service writes:
  - `orders` row
  - `outbox` row
in the **same DB transaction**.
- dispatcher publishes outbox events **reliably** and marks them as published.

### Event-driven architecture + queues
- Queue topics (SQS queues in dev):
  - `orders.created`
  - `credit.decisioned`
  - `ledger.posted`
  - plus DLQs (e.g., `credit.decisioned.dlq`)

### Idempotent consumers
- Every consumer writes to `processed_events` with `event_id` unique constraint.
- Replayed messages become no-ops; safe retries are guaranteed.

### Versioned events (compatibility)
- Event names include versions (`*.v1`) and schema files live in `/packages/contracts/events`.

---

## Tech stack (matches the job description)

### Languages
- **TypeScript** (NestJS REST APIs + ops console + AI assistant)
- **Golang** (high-performance workers only)
- **Python** (optional for AI experiments / notebooks)

### Backend (NestJS)
- REST APIs with decorators, dependency injection, OpenAPI auto-generation
- class-validator for runtime validation
- TypeORM/Prisma for database access
- Structured logging, middleware, configuration via @nestjs/config

### Workers (Go)
- Event consumers with high throughput
- Minimal memory footprint, fast startup
- Goroutines for concurrent processing

### Databases
- **Postgres** (orders + outbox; dev uses Postgres container, prod target is Aurora Postgres)
- **MySQL** (ledger; dev uses MySQL container, prod target is Aurora MySQL)
- **Elasticsearch** (operational search)

### Cloud / DevOps
- **AWS** concepts (RDS, SQS) — dev emulation via **LocalStack**
- **Docker** for local infra + service containers
- **Kubernetes** (manifests or Helm; kind as local target)

### Version control / CI/CD
- **Git**
- **GitLab CI** as the canonical pipeline (repo can live on GitHub, but pipeline file is GitLab-style)

### Observability
- **OpenTelemetry** (traces + metrics export)
- **Prometheus** (metrics scrape)
- **Grafana** (dashboards)
- Optional adapters for Datadog/New Relic style naming / exporters

### AI / ML tooling
- **OpenAI API**
- **LangChain** (optional)
- **Hugging Face** (optional)
- “AI enablement” docs showing usage with **Claude Code**, **Codex**, **Cursor**

### Testing
- Unit tests (domain + handlers)
- Integration tests (DB + queues)
- E2E smoke tests (`make demo` + validations)

---

## Monorepo + Devcontainers design

### Requirements
- **Monorepo** with **independent versioning and deploys** per package/service
- Everything runs in **Dev Containers** (VS Code / GitHub Codespaces style)
- Services can be built and deployed individually even though they live together

### Monorepo structure
```
/
├── infrastructure/              # Shared infra (PostgreSQL, MySQL, Redis, etc.)
│   └── .devcontainer/           # Opens as separate VS Code window
│
├── api-gateway/                 # REST entrypoint (Node.js/Fastify)
│   └── .devcontainer/
├── orders-service/              # Orders + Outbox (NestJS)
│   └── .devcontainer/
├── search-service/              # Elasticsearch queries (NestJS)
│   └── .devcontainer/
├── webhooks-service/            # Merchant webhooks (NestJS)
│   └── .devcontainer/
│
├── outbox-relay/                # Outbox → SQS publisher (Go)
│   └── .devcontainer/
├── credit-engine/               # Credit decisioning (Go)
│   └── .devcontainer/
├── ledger-processor/            # Double-entry ledger (Go)
│   └── .devcontainer/
├── search-indexer/              # Event → Elasticsearch (Go)
│   └── .devcontainer/
│
├── ops-console/                 # Internal dashboard (React)
│   └── .devcontainer/
├── ops-assistant/               # AI-powered RCA (TypeScript/Python)
│   └── .devcontainer/
│
├── contracts/                   # Shared schemas
│   ├── events/                  # Domain event schemas (JSON Schema)
│   └── openapi/                 # API specifications (OpenAPI 3.x)
│
├── libs/                        # Shared libraries
│   ├── common-ts/               # TypeScript utilities
│   └── common-go/               # Go utilities
│
├── deploy/                      # Deployment configs
│   ├── docker-compose/
│   └── k8s/
│
├── docs/                        # Documentation
│   ├── adr/                     # Architecture Decision Records
│   ├── runbooks/                # Operational procedures
│   └── diagrams/                # System diagrams
│
├── scripts/                     # Automation scripts
│   ├── demo.sh
│   ├── seed.sh
│   └── chaos.sh
│
└── Makefile
```

**Design principle:** Each folder at root level is a **separate VS Code window** with its own devcontainer. Open `infrastructure/` first, then open services as needed.

### Devcontainers strategy
- **No root `.devcontainer`** — each service is independent
- **infrastructure/** runs shared services (databases, queues, observability)
- **Services** connect to infrastructure via `pulsepay-network` Docker network
- Developer opens multiple VS Code windows, one per context

---

## Independent versioning + deployment inside a monorepo

### Strategy: “Service-level SemVer + release manifests”
Each deployable unit has:
- `VERSION` file (or `package.json` / Go build-time version)
- `CHANGELOG.md`
- `Dockerfile`
- `deploy/` folder (k8s manifests/helm values)
- A **release pipeline** that triggers only when that package changes

Example:
- `packages/services/orders-service/VERSION`
- `packages/services/orders-service/CHANGELOG.md`
- `packages/services/orders-service/Dockerfile`

### CI approach (GitLab)
- Path-based rules: only build/test/deploy changed services
- Example stages:
  - `lint` → `test` → `build` → `package` → `deploy`
- Version bump automation:
  - Conventional commits + per-service changelog generation
  - Tagging: `orders-service/v0.4.1`, `ledger-service/v0.2.0`, etc.

### Deploy approach
- Each service produces:
  - container image `registry/.../orders-service:<version>`
  - k8s manifest / helm chart package versioned per service
- Environments:
  - `dev` via docker-compose
  - `local-k8s` via kind
  - `prod` story: AWS EKS + Aurora + SQS (documented, not required to run)

---

## Observability (what reviewers will check)

### Dashboards (Grafana)
- API latency p50/p95/p99 per service
- Queue lag / DLQ size
- Outbox backlog (pending events)
- Credit decision rates (approve/decline) + error budgets
- Ledger posting throughput + failures

### Tracing (OpenTelemetry)
- Correlated trace from gateway request all the way to ledger posting + indexing
- Trace attributes include `order_id`, `customer_id`, `event_id`

### Logs
- JSON logs with:
  - `level`, `service`, `trace_id`, `span_id`, `order_id`, `event_id`
- Runbook includes “how to debug” using logs + traces + metrics

---

## Security and reliability (baseline)

- Request validation (OpenAPI + runtime checks)
- Rate limiting at gateway
- Secrets via env + LocalStack secrets in dev (optional)
- Idempotency keys for external-facing endpoints (merchant/session creation)
- Safe retries, exponential backoff, DLQs
- Minimal threat model doc (short and practical)

---

## AI enablement (how we’ll impress specifically)

### What the AI assistant does
Given an `order_id` or `trace_id`, it:
- Pulls:
  - recent logs (sample or aggregated)
  - trace summary (from OTEL backend or mock)
  - last N events for that order (from Elastic)
- Produces:
  - **RCA draft**
  - likely fault domain (gateway/orders/dispatcher/credit/ledger/indexer)
  - suggested next steps + **queries** (Elastic/SQL)

### AI playbook
- `/packages/ai/ai-ops-assistant/prompts/`
- `/docs/ai-playbook.md`:
  - how to use Cursor/Codex/Claude Code to generate tests, refactors, ADR drafts
  - guardrails: never leak secrets, never output PII, always cite evidence from logs/traces

---

## Infrastructure Health Check

The project includes a comprehensive health check script that validates all infrastructure services are running correctly.

### Running the Health Check

```bash
# From the infrastructure devcontainer
./healthcheck.sh
```

### What it validates

| Category | Services |
|----------|----------|
| **Databases** | PostgreSQL, MySQL, Redis, Elasticsearch |
| **AWS Local** | LocalStack, SQS Queues, SNS Topics |
| **Observability** | Prometheus, Grafana, Jaeger, OTEL Collector |

### Health Check Evidence

Below is a screenshot showing all 11 infrastructure services passing health checks:

![Infrastructure Health Check](doc/img/Screenshot%202025-12-13%20at%2019.29.20.png)

**Summary:** 11 passed / 0 failed / 11 total ✅

---

## Demo experience (what the reviewer runs)

### One command to run everything
```bash
# 1. Open infrastructure folder in VS Code and reopen in container
# 2. Wait for all services to start
# 3. Validate infrastructure
./healthcheck.sh

# When services are implemented:
make up
make demo
```

### Demo script does
- Creates 20 orders with mixed amounts (some approved, some declined)
- Verifies:
  - outbox published
  - credit decisions consumed
  - ledger posted for approvals
  - indexed documents exist in Elasticsearch
- Prints:
  - Ops Console URL
  - Grafana URL
  - Example Elastic search queries

---

## Deliverables checklist (definition of done)

- [x] Infrastructure devcontainer with all shared services
- [x] Health check script for infrastructure validation
- [x] PostgreSQL + MySQL database schemas
- [x] Redis for caching
- [x] Elasticsearch for operational search
- [x] LocalStack with SQS queues and SNS topics
- [x] Observability stack (Prometheus, Grafana, Jaeger, OTEL)
- [x] Docker network isolation (`pulsepay-network`)
- [ ] All services compile + start in devcontainer
- [ ] `make up` brings infra up reliably
- [ ] `make demo` validates the whole pipeline end-to-end
- [ ] OpenAPI specs exist and match behavior
- [ ] Outbox + idempotent consumers fully implemented
- [ ] OTel traces visible end-to-end
- [ ] Prometheus metrics scraped; Grafana dashboards importable
- [ ] Elasticsearch index mappings + example queries in README
- [ ] GitLab CI runs: lint/test/build + integration test job
- [ ] Per-service versioning + changelog + release tags strategy
- [ ] ADRs + runbook included
- [ ] AI assistant works with minimal configuration (API key)

---

## Suggested event contracts (example)

### `OrderCreated.v1`
```json
{
  "event_id": "uuid",
  "event_name": "OrderCreated.v1",
  "occurred_at": "RFC3339",
  "order": {
    "order_id": "uuid",
    "customer_id": "string",
    "amount_cents": 12999,
    "currency": "USD"
  }
}
```

### `CreditDecisioned.v1`
```json
{
  "event_id": "uuid",
  "event_name": "CreditDecisioned.v1",
  "occurred_at": "RFC3339",
  "order_id": "uuid",
  "approved": true,
  "reason_code": "LOW_RISK",
  "score": 742,
  "policy_version": "v1"
}
```

### `LedgerPosted.v1`
```json
{
  "event_id": "uuid",
  "event_name": "LedgerPosted.v1",
  "occurred_at": "RFC3339",
  "order_id": "uuid",
  "entries": [
    {"account": "AR_CUSTOMER", "type": "DEBIT", "amount_cents": 12999},
    {"account": "MERCHANT_PAYABLE", "type": "CREDIT", "amount_cents": 12999}
  ]
}
```

---

## Notes for reviewers

- This repo is intentionally **small in business scope** and **big in engineering scope**.
- The architecture mirrors common BNPL/payment constraints: reliability, auditability, idempotency, traceability.
- The “AI enablement” component is built to demonstrate responsible automation of developer/support workflows.

---

## Next steps (optional roadmap)
- Add React Native “Customer” screen (view schedule + status)
- Add PCI-ish boundaries (tokenization mock, PII redaction)
- Expand decisioning features + A/B policies
- Add cost/perf notes (indexing strategy, query tuning, partitions)
- Add chaos testing job in CI
