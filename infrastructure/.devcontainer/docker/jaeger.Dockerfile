# ┌───────────────────────────────────────────┐
# │  pulsepay-jaeger                          │
# │                                           │
# │  Distributed tracing backend              │
# │                                           │
# │  for development use ONLY                 │
# └───────────────────────────────────────────┘

FROM jaegertracing/all-in-one:1.52

LABEL maintainer="PulsePay Team"
LABEL description="Jaeger for distributed tracing"

ENV COLLECTOR_OTLP_ENABLED=true

EXPOSE 16686 14268 14250
