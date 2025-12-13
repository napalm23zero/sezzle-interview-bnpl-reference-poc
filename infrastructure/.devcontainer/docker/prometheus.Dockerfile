# ┌───────────────────────────────────────────┐
# │  pulsepay-prometheus                      │
# │  for development use ONLY                 │
# └───────────────────────────────────────────┘

FROM prom/prometheus:v2.48.0

LABEL maintainer="PulsePay Team"
LABEL description="Prometheus for metrics collection"

EXPOSE 9090
