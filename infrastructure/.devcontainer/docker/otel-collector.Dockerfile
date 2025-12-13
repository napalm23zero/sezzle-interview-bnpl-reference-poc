# ┌───────────────────────────────────────────┐
# │  pulsepay-otel-collector                  │
# │                                           │
# │  OpenTelemetry Collector                  │
# │                                           │
# │  for development use ONLY                 │
# └───────────────────────────────────────────┘

FROM otel/opentelemetry-collector-contrib:0.91.0

LABEL maintainer="PulsePay Team"
LABEL description="OpenTelemetry Collector for traces and metrics"

EXPOSE 4317 4318 8888 8889
