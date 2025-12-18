/**
 * Configuration
 *
 * Loads and validates environment variables.
 * All config is centralized here for easy management.
 */

/**
 * Parse boolean from environment variable
 */
function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Parse comma-separated list from environment variable
 */
function parseList(value: string | undefined): string[] {
  if (!value || value.trim() === '') return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Parse JSON object from environment variable
 */
function parseJson<T>(value: string | undefined, defaultValue: T): T {
  if (!value || value.trim() === '') return defaultValue;
  try {
    return JSON.parse(value) as T;
  } catch {
    process.stderr.write(`Failed to parse JSON env var: ${value}\n`);
    return defaultValue;
  }
}

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'debug',

  // Service URLs (for proxy routes)
  services: {
    orders: process.env.ORDERS_SERVICE_URL,
    search: process.env.SEARCH_SERVICE_URL,
    webhooks: process.env.WEBHOOKS_SERVICE_URL,
  },

  // PostgreSQL (for user storage)
  postgres: {
    host: process.env.POSTGRES_HOST || 'pulse-postgres',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'pulsepay_orders',
    user: process.env.POSTGRES_USER || 'pulsepay',
    password: process.env.POSTGRES_PASSWORD || 'pulsepay_dev',
    // Connection pool settings
    poolMin: parseInt(process.env.POSTGRES_POOL_MIN || '2', 10),
    poolMax: parseInt(process.env.POSTGRES_POOL_MAX || '10', 10),
    // SSL settings
    ssl: parseBoolean(process.env.POSTGRES_SSL, false),
  },

  // Redis (for distributed rate limiting and token cache)
  redis: {
    host: process.env.REDIS_HOST || 'pulse-redis',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    // Constructed URL for compatibility
    url: process.env.REDIS_URL || undefined,
    enabled: parseBoolean(process.env.REDIS_ENABLED, true),
    // Connection settings
    maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES || '3', 10),
    connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT || '10000', 10),
  },

  // Rate limiting
  rateLimit: {
    // Enable/disable rate limiting entirely
    enabled: parseBoolean(process.env.RATE_LIMIT_ENABLED, true),

    // Use Redis for distributed rate limiting (recommended for production)
    // Falls back to in-memory if Redis is unavailable
    useRedis: parseBoolean(process.env.RATE_LIMIT_USE_REDIS, true),

    // Maximum requests per time window
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),

    // Time window in milliseconds (default: 1 minute)
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),

    // Whitelisted IPs (comma-separated) - these IPs skip rate limiting
    whitelist: parseList(process.env.RATE_LIMIT_WHITELIST),

    // Custom path-specific limits (JSON format)
    // Example: '{"POST /api/v1/orders": {"max": 10, "windowMs": 60000}}'
    customPaths: parseJson<Record<string, { max: number; windowMs: number }>>(
      process.env.RATE_LIMIT_CUSTOM_PATHS,
      {},
    ),

    // Ban settings for repeat offenders
    ban: {
      // Enable ban for repeat offenders
      enabled: parseBoolean(process.env.RATE_LIMIT_BAN_ENABLED, false),
      // Number of rate limit hits before ban
      threshold: parseInt(process.env.RATE_LIMIT_BAN_THRESHOLD || '10', 10),
      // Ban duration in milliseconds (default: 1 hour)
      durationMs: parseInt(process.env.RATE_LIMIT_BAN_DURATION_MS || '3600000', 10),
    },
  },

  // OpenTelemetry
  otel: {
    enabled: parseBoolean(process.env.OTEL_ENABLED, false),
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    serviceName: process.env.OTEL_SERVICE_NAME || 'api-gateway',
  },

  // Metrics (Prometheus)
  metrics: {
    enabled: parseBoolean(process.env.METRICS_ENABLED, true),
  },

  // JWT Authentication
  jwt: {
    // Enable/disable JWT authentication
    enabled: parseBoolean(process.env.JWT_ENABLED, true),

    // Secret key for HS256 (required in production)
    // Generate with: openssl rand -base64 64
    secret: process.env.JWT_SECRET || 'development-secret-change-in-production',

    // Token issuer (iss claim)
    issuer: process.env.JWT_ISSUER || 'pulse-api-gateway',

    // Token audience (aud claim)
    audience: process.env.JWT_AUDIENCE || 'pulse-services',

    // Access token expiration (e.g., '15m', '1h', '7d')
    accessTokenExpiry: process.env.JWT_ACCESS_TOKEN_EXPIRY || '15m',

    // Refresh token expiration
    refreshTokenExpiry: process.env.JWT_REFRESH_TOKEN_EXPIRY || '7d',

    // Algorithm for signing (HS256 or RS256)
    algorithm: (process.env.JWT_ALGORITHM as 'HS256' | 'RS256') || 'HS256',

    // Clock tolerance for verification (seconds)
    clockTolerance: parseInt(process.env.JWT_CLOCK_TOLERANCE || '60', 10),
  },

  // Token Cache
  tokenCache: {
    // Enable token caching (requires Redis)
    enabled: parseBoolean(process.env.TOKEN_CACHE_ENABLED, true),

    // Cache key prefix
    keyPrefix: process.env.TOKEN_CACHE_KEY_PREFIX || 'auth',

    // Default TTL for cached tokens (seconds)
    defaultTtl: parseInt(process.env.TOKEN_CACHE_DEFAULT_TTL || '300', 10),

    // TTL for revoked token entries (seconds)
    revokedTokenTtl: parseInt(process.env.TOKEN_CACHE_REVOKED_TTL || '604800', 10),
  },
} as const;

// Type for the config object
export type Config = typeof config;
