# Infrastructure

> Shared infrastructure services for PulsePay BNPL platform.
> **For development use ONLY**

## Overview

This devcontainer provides all infrastructure services needed by the PulsePay platform.
Open this folder in VS Code as a separate window to manage infrastructure independently.

```
infrastructure/
└── .devcontainer/
    ├── devcontainer.json      # VS Code devcontainer config
    ├── docker-compose.yaml    # All services orchestration
    ├── .env                   # Environment variables
    ├── docker/                # Dockerfiles for each service
    ├── config/                # Configuration files
    └── init/                  # Initialization scripts
```

## Services

| Service | Purpose | Port (Internal) | Port (External) | URL |
|---------|---------|-----------------|-----------------|-----|
| PostgreSQL | Orders + Outbox | 5432 | 15432 | - |
| MySQL | Ledger (double-entry) | 3306 | 13306 | - |
| Redis | Cache + Rate limiting | 6379 | 16379 | - |
| Elasticsearch | Operational search | 9200 | 19200 | http://localhost:19200 |
| LocalStack | AWS SQS/SNS emulation | 4566 | 14566 | http://localhost:14566 |
| Jaeger | Distributed tracing | 16686 | 16686 | http://localhost:16686 |
| Prometheus | Metrics collection | 9090 | 19090 | http://localhost:19090 |
| Grafana | Dashboards | 3000 | 13000 | http://localhost:13000 |
| OTEL (gRPC) | Telemetry receiver | 4317 | 14317 | - |
| OTEL (HTTP) | Telemetry receiver | 4318 | 14318 | - |

## Quick Start

1. Open this folder in VS Code
2. When prompted, click "Reopen in Container"
3. Wait for all services to start (healthchecks ensure order)
4. Run `./healthcheck.sh` to verify all services are healthy

## Shell Commands

The devcontainer includes helpful aliases:

```bash
# Database connections
pg                  # Connect to PostgreSQL
mysql-ledger        # Connect to MySQL

# Redis
redis               # Connect to Redis

# SQS (LocalStack)
sqs-list            # List all queues
sqs-receive <url>   # Receive message from queue

# Elasticsearch
es-health           # Check cluster health
es-indices          # List all indices

# Health Check
./healthcheck.sh    # Check all services health (run from /workspace)
```

## Connection Strings

Use these from other services (inside Docker network):

```bash
# PostgreSQL (from host: localhost:15432)
postgresql://pulsepay:pulsepay_dev@pulse-postgres:5432/pulsepay_orders

# MySQL (from host: localhost:13306)
mysql://pulsepay:pulsepay_dev@pulse-mysql:3306/pulsepay_ledger

# Redis (from host: localhost:16379)
redis://pulse-redis:6379

# Elasticsearch (from host: localhost:19200)
http://pulse-elasticsearch:9200

# LocalStack SQS (from host: localhost:14566)
http://pulse-localstack:4566

# Prometheus (from host: localhost:19090)
http://pulse-prometheus:9090

# OTEL Collector (from host: localhost:14318)
http://pulse-otel-collector:4318
```

## Credentials

| Service | User | Password |
|---------|------|----------|
| PostgreSQL | `pulsepay` | `pulsepay_dev` |
| MySQL | `pulsepay` | `pulsepay_dev` |
| MySQL (root) | `root` | `root_dev` |
| Grafana | `admin` | `admin` |

## SQS Queues

Pre-created queues (LocalStack):

| Queue | Purpose | DLQ |
|-------|---------|-----|
| `orders-created` | New orders from outbox-relay | `orders-created-dlq` |
| `credit-decisioned` | Credit decisions from credit-engine | `credit-decisioned-dlq` |
| `ledger-posted` | Ledger entries from ledger-processor | `ledger-posted-dlq` |

## Database Schemas

### PostgreSQL (pulsepay_orders)

| Table | Purpose |
|-------|---------|
| `orders` | Order records |
| `outbox` | Transactional outbox for events |
| `processed_events` | Idempotency tracking |
| `webhooks` | Merchant webhook configurations |

### MySQL (pulsepay_ledger)

| Table | Purpose |
|-------|---------|
| `accounts` | Chart of accounts |
| `ledger_transactions` | Transaction headers |
| `ledger_entries` | Double-entry debit/credit entries |
| `processed_events` | Idempotency tracking |

## Observability

### Jaeger (Tracing)
- URL: http://localhost:16686
- View distributed traces across services

### Prometheus (Metrics)
- URL: http://localhost:19090
- Query metrics from all services

### Grafana (Dashboards)
- URL: http://localhost:13000
- Login: `admin` / `admin`
- Pre-configured Prometheus and Jaeger datasources

**Available Dashboards:**

| Dashboard | Folder | Description |
|-----------|--------|-------------|
| API Gateway | Pulse | RPS, Latency (P50/P95/P99), Error Rate, Rate Limit Hits, Node.js Runtime |

Dashboards are auto-provisioned from `config/grafana/provisioning/dashboards/`.

## Environment Variables

All configuration is in `.devcontainer/.env`. Key variables:

```bash
# Network
NETWORK_NAME=pulse-network

# Port naming convention:
# *_PORT_INTERNAL = port inside Docker network
# *_PORT_EXTERNAL = port exposed to host (prefixed with 1)

# Example:
POSTGRES_PORT_INTERNAL=5432
POSTGRES_PORT_EXTERNAL=15432
```

## Troubleshooting

### Service not healthy
```bash
# Check container logs
docker logs pulse-postgres
docker logs pulse-mysql
docker logs pulse-localstack

# Restart specific service
docker compose restart postgres
```

### Reset all data
```bash
# Stop containers and remove volumes
docker compose down -v

# Rebuild and start
docker compose up -d --build
```

### Check network connectivity
```bash
# From devcontainer shell
ping postgres
ping mysql
curl -s http://elasticsearch:9200/_cluster/health | jq
```
