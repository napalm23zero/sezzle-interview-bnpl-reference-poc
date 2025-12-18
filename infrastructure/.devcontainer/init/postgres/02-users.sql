-- ┌───────────────────────────────────────────┐
-- │  PostgreSQL - Users & Authentication      │
-- │  Database: pulsepay_orders                │
-- │  Tables: users, refresh_tokens            │
-- │  for development use ONLY                 │
-- └───────────────────────────────────────────┘

-- Users table
-- Passwords are stored as Argon2id hashes (includes salt)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Credentials
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,  -- Argon2id hash (includes salt)
    
    -- Profile
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    
    -- Authorization
    role VARCHAR(50) NOT NULL DEFAULT 'consumer',
    permissions TEXT[] DEFAULT '{}',
    
    -- Multi-tenancy (optional)
    tenant_id UUID,
    merchant_id UUID,
    
    -- Status
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    email_verified BOOLEAN DEFAULT FALSE,
    email_verified_at TIMESTAMPTZ,
    
    -- Security
    failed_login_attempts INT DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    last_login_ip INET,
    password_changed_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID
);

-- Indexes for users
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_tenant ON users(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_users_merchant ON users(merchant_id) WHERE merchant_id IS NOT NULL;

-- Refresh tokens table (long-lived tokens stored in DB for revocation)
-- Access tokens are validated via signature, refresh tokens need DB lookup
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Token identification
    token_id VARCHAR(255) NOT NULL UNIQUE,  -- JWT jti claim
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Token metadata
    user_agent VARCHAR(512),
    ip_address INET,
    device_name VARCHAR(255),
    
    -- Status
    revoked BOOLEAN DEFAULT FALSE,
    revoked_at TIMESTAMPTZ,
    revoked_reason VARCHAR(255),
    
    -- Timestamps
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_used_at TIMESTAMPTZ,
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for refresh tokens
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token_id ON refresh_tokens(token_id);
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at) WHERE revoked = FALSE;
CREATE INDEX idx_refresh_tokens_cleanup ON refresh_tokens(expires_at, revoked);

-- Password reset tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,  -- SHA256 hash of the token
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_password_reset_user ON password_reset_tokens(user_id);
CREATE INDEX idx_password_reset_expires ON password_reset_tokens(expires_at) WHERE used_at IS NULL;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for users updated_at
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ┌───────────────────────────────────────────┐
-- │  Role-based access control                │
-- └───────────────────────────────────────────┘

-- Valid roles enum check
ALTER TABLE users ADD CONSTRAINT check_user_role 
    CHECK (role IN ('admin', 'merchant', 'consumer', 'service'));

-- Valid status enum check
ALTER TABLE users ADD CONSTRAINT check_user_status 
    CHECK (status IN ('active', 'inactive', 'suspended', 'pending_verification'));

-- ┌───────────────────────────────────────────┐
-- │  Development seed data (remove in prod)  │
-- └───────────────────────────────────────────┘

-- Admin user for testing (password: admin123)
-- Argon2id hash generated with: argon2.hash('admin123')
INSERT INTO users (email, password_hash, first_name, last_name, role, permissions, email_verified) 
VALUES (
    'admin@pulsepay.dev',
    '$argon2id$v=19$m=65536,t=3,p=4$randomsalthere$hashedpasswordhere',
    'Admin',
    'User',
    'admin',
    ARRAY['users:read', 'users:write', 'users:delete', 'orders:read', 'orders:write', 'system:admin'],
    TRUE
) ON CONFLICT (email) DO NOTHING;

-- Merchant user for testing (password: merchant123)
INSERT INTO users (email, password_hash, first_name, last_name, role, permissions, email_verified)
VALUES (
    'merchant@pulsepay.dev',
    '$argon2id$v=19$m=65536,t=3,p=4$randomsalthere$hashedpasswordhere',
    'Test',
    'Merchant',
    'merchant',
    ARRAY['orders:read', 'orders:write', 'webhooks:read', 'webhooks:write'],
    TRUE
) ON CONFLICT (email) DO NOTHING;

-- Consumer user for testing (password: consumer123)
INSERT INTO users (email, password_hash, first_name, last_name, role, permissions, email_verified)
VALUES (
    'consumer@pulsepay.dev',
    '$argon2id$v=19$m=65536,t=3,p=4$randomsalthere$hashedpasswordhere',
    'Test',
    'Consumer',
    'consumer',
    ARRAY['orders:read'],
    TRUE
) ON CONFLICT (email) DO NOTHING;

COMMENT ON TABLE users IS 'User accounts with Argon2id password hashing';
COMMENT ON TABLE refresh_tokens IS 'Long-lived refresh tokens for JWT rotation';
COMMENT ON TABLE password_reset_tokens IS 'Time-limited tokens for password reset flow';
