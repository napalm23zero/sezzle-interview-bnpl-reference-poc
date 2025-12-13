# ┌───────────────────────────────────────────┐
# │  pulsepay-grafana                         │
# │                                           │
# │  Dashboards and visualization             │
# │                                           │
# │  for development use ONLY                 │
# └───────────────────────────────────────────┘

FROM grafana/grafana:10.2.0

LABEL maintainer="PulsePay Team"
LABEL description="Grafana for dashboards"

ENV GF_SECURITY_ADMIN_USER=admin
ENV GF_SECURITY_ADMIN_PASSWORD=admin
ENV GF_USERS_ALLOW_SIGN_UP=false

EXPOSE 3000
