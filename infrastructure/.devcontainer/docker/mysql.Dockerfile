# ┌───────────────────────────────────────────┐
# │  pulsepay-mysql                           │
# │  for development use ONLY                 │
# └───────────────────────────────────────────┘

FROM mysql:8.0

LABEL maintainer="PulsePay Team"
LABEL description="MySQL for ledger (double-entry)"

EXPOSE 3306
