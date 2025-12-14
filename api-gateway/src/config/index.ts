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
    console.warn(`Failed to parse JSON env var: ${value}`);
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

  // Redis (for distributed rate limiting)
  redis: {
    url: process.env.REDIS_URL,
    enabled: parseBoolean(process.env.REDIS_ENABLED, false),
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
} as const;

// Type for the config object
export type Config = typeof config;
