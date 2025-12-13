# ┌───────────────────────────────────────────┐
# │  pulsepay-postgres                        │
# │  for development use ONLY                 │
# └───────────────────────────────────────────┘

FROM postgres:16-alpine

LABEL maintainer="PulsePay Team"
LABEL description="PostgreSQL for orders and outbox"

RUN apk add --no-cache curl

EXPOSE 5432
