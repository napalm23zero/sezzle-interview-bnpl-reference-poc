#!/bin/bash
# ┌───────────────────────────────────────────┐
# │  LocalStack SQS Init Script               │
# │  Creates queues and DLQs for messaging    │
# │  for development use ONLY                 │
# └───────────────────────────────────────────┘

echo "🚀 Creating SQS queues..."

# Main queues
awslocal sqs create-queue --queue-name orders-created
awslocal sqs create-queue --queue-name credit-decisioned
awslocal sqs create-queue --queue-name ledger-posted

# DLQs
awslocal sqs create-queue --queue-name orders-created-dlq
awslocal sqs create-queue --queue-name credit-decisioned-dlq
awslocal sqs create-queue --queue-name ledger-posted-dlq

echo "✅ SQS queues created:"
awslocal sqs list-queues
