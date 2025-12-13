-- ┌───────────────────────────────────────────┐
-- │  PostgreSQL Init Script                    │
-- │  Database: pulsepay_orders                │
-- │  Tables: orders, outbox, webhooks         │
-- │  for development use ONLY                 │
-- └───────────────────────────────────────────┘

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Orders table
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id VARCHAR(255) NOT NULL,
    merchant_id VARCHAR(255) NOT NULL,
    amount_cents BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    idempotency_key VARCHAR(255) UNIQUE,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_merchant ON orders(merchant_id);
CREATE INDEX idx_orders_status ON orders(status);

-- Outbox table (Transactional Outbox Pattern)
CREATE TABLE IF NOT EXISTS outbox (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type VARCHAR(255) NOT NULL,
    event_id UUID NOT NULL UNIQUE,
    aggregate_type VARCHAR(255) NOT NULL,
    aggregate_id UUID NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    published BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_outbox_unpublished ON outbox(published, created_at) WHERE published = FALSE;

-- Processed events (Idempotency)
CREATE TABLE IF NOT EXISTS processed_events (
    event_id UUID PRIMARY KEY,
    processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Webhooks
CREATE TABLE IF NOT EXISTS webhooks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id VARCHAR(255) NOT NULL,
    url VARCHAR(2048) NOT NULL,
    secret VARCHAR(255) NOT NULL,
    events TEXT[] NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
