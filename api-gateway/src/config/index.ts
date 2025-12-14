/**
 * Configuration
 *
 * Loads and validates environment variables.
 * All config is centralized here for easy management.
 */

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'debug',

  // Service URLs (for future proxy routes)
  services: {
    orders: process.env.ORDERS_SERVICE_URL || 'http://orders-service:3001',
    search: process.env.SEARCH_SERVICE_URL || 'http://search-service:3002',
    webhooks: process.env.WEBHOOKS_SERVICE_URL || 'http://webhooks-service:3003',
  },

  // Redis (for future rate limiting)
  redisUrl: process.env.REDIS_URL || 'redis://redis:6379',

  // Rate limiting
  rateLimit: {
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  },

  // OpenTelemetry
  otel: {
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector:4318',
    serviceName: process.env.OTEL_SERVICE_NAME || 'api-gateway',
  },
} as const;

// Type for the config object
export type Config = typeof config;
