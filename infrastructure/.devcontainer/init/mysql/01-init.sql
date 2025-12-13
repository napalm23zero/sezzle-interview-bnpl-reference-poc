-- ┌───────────────────────────────────────────┐
-- │  MySQL Init Script                         │
-- │  Database: pulsepay_ledger                │
-- │  Double-entry accounting ledger           │
-- │  for development use ONLY                 │
-- └───────────────────────────────────────────┘

-- Accounts
CREATE TABLE IF NOT EXISTS accounts (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type ENUM('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE') NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Ledger transactions
CREATE TABLE IF NOT EXISTS ledger_transactions (
    id VARCHAR(36) PRIMARY KEY,
    order_id VARCHAR(36) NOT NULL UNIQUE,
    event_id VARCHAR(36) NOT NULL UNIQUE,
    status ENUM('PENDING', 'POSTED', 'REVERSED') NOT NULL DEFAULT 'PENDING',
    total_amount_cents BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    posted_at TIMESTAMP NULL,
    INDEX idx_order (order_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Ledger entries (double-entry)
CREATE TABLE IF NOT EXISTS ledger_entries (
    id VARCHAR(36) PRIMARY KEY,
    transaction_id VARCHAR(36) NOT NULL,
    order_id VARCHAR(36) NOT NULL,
    account_id VARCHAR(36) NOT NULL,
    entry_type ENUM('DEBIT', 'CREDIT') NOT NULL,
    amount_cents BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id),
    INDEX idx_transaction (transaction_id),
    INDEX idx_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Processed events (Idempotency)
CREATE TABLE IF NOT EXISTS processed_events (
    event_id VARCHAR(36) PRIMARY KEY,
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed accounts
INSERT INTO accounts (id, name, type) VALUES
    ('acc-ar-customer', 'Accounts Receivable - Customer', 'ASSET'),
    ('acc-merchant-payable', 'Merchant Payable', 'LIABILITY'),
    ('acc-revenue-fees', 'Revenue - Transaction Fees', 'REVENUE'),
    ('acc-cash', 'Cash', 'ASSET');
