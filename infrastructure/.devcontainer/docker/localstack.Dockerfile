# ┌───────────────────────────────────────────┐
# │  pulsepay-localstack                      │
# │                                           │
# │  AWS services emulation (SQS, SNS)        │
# │                                           │
# │  for development use ONLY                 │
# └───────────────────────────────────────────┘

FROM localstack/localstack:3.0

LABEL maintainer="PulsePay Team"
LABEL description="LocalStack for AWS SQS/SNS emulation"

ENV SERVICES=sqs,sns
ENV DEBUG=0

EXPOSE 4566
