# ┌───────────────────────────────────────────┐
# │  pulsepay-redis                           │
# │  for development use ONLY                 │
# └───────────────────────────────────────────┘

FROM redis:7-alpine

LABEL maintainer="PulsePay Team"
LABEL description="Redis for caching and rate limiting"

EXPOSE 6379
