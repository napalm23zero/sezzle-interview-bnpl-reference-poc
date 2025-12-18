/**
 * Rate Limit Plugin
 *
 * Protects the API Gateway from abuse by limiting requests per IP.
 * Configurable via environment variables.
 *
 * Environment Variables:
 * - RATE_LIMIT_ENABLED: Enable/disable rate limiting (default: true)
 * - RATE_LIMIT_MAX: Max requests per window (default: 100)
 * - RATE_LIMIT_WINDOW_MS: Time window in milliseconds (default: 60000 = 1 min)
 * - RATE_LIMIT_WHITELIST: Comma-separated IPs to skip (default: '')
 * - RATE_LIMIT_USE_REDIS: Use Redis for distributed rate limiting (default: true)
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import { Redis, type Redis as RedisClient } from 'ioredis';
import { config } from '../config/index.js';
import { ErrorCodes, buildErrorResponse } from '../errors/index.js';

function asErrorInfo(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { message: typeof error === 'string' ? error : 'Unknown error' };
}

/**
 * Custom key generator - uses IP for rate limiting
 */
function keyGenerator(request: FastifyRequest): string {
  // Use X-Forwarded-For if behind a proxy, otherwise use IP
  const forwardedFor = request.headers['x-forwarded-for'];
  const ip =
    typeof forwardedFor === 'string'
      ? forwardedFor.split(',')[0]?.trim() || request.ip
      : request.ip;

  return ip;
}

/**
 * Custom error response for rate limit exceeded
 */
function errorResponseBuilder(request: FastifyRequest, context: { max: number; ttl: number }) {
  const retryAfter = Math.ceil(context.ttl / 1000);

  return buildErrorResponse({
    code: ErrorCodes.RATE_LIMIT_EXCEEDED,
    path: request.url,
    method: request.method,
    correlationId: request.correlationId,
    details: `You have exceeded the limit of ${context.max} requests per ${retryAfter} seconds.`,
    retryAfter,
  });
}

/**
 * Create Redis client for rate limiting
 */
function createRedisClient(app: FastifyInstance): RedisClient | null {
  // Tests should not depend on external Redis
  if (config.nodeEnv === 'test') {
    return null;
  }

  if (!config.rateLimit.useRedis || !config.redis.enabled || !config.redis.url) {
    app.log.info('Rate limiting using IN-MEMORY store');
    return null;
  }

  try {
    const client: RedisClient = new Redis(config.redis.url, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        if (times > 3) {
          app.log.warn('Redis connection failed, falling back to in-memory rate limiting');
          return null; // Stop retrying
        }
        return Math.min(times * 100, 1000);
      },
    });

    client.on('connect', () => {
      app.log.info({ url: config.redis.url }, 'Redis connected for rate limiting');
    });

    client.on('error', (err: Error) => {
      app.log.error({ err: err.message }, 'Redis error');
    });

    return client;
  } catch (err) {
    app.log.warn({ err: asErrorInfo(err) }, 'Failed to create Redis client, using in-memory store');
    return null;
  }
}

async function rateLimitPluginFn(app: FastifyInstance) {
  // Skip if rate limiting is disabled
  if (!config.rateLimit.enabled) {
    app.log.info('Rate limiting is DISABLED');
    return;
  }

  // Create Redis client (or null for in-memory)
  const redisClient = createRedisClient(app);

  app.log.info({
    msg: 'Rate limiting is ENABLED',
    store: redisClient ? 'redis' : 'in-memory',
    redisUrl: redisClient ? config.redis.url : 'N/A',
    max: config.rateLimit.max,
    windowMs: config.rateLimit.windowMs,
    whitelist: config.rateLimit.whitelist,
  });

  // Register the rate limit plugin
  await app.register(rateLimit, {
    // Use Redis store if available
    ...(redisClient && { redis: redisClient }),
    // Global rate limit settings
    global: true,
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,

    // Key generator (IP-based)
    keyGenerator,

    // Custom error response
    errorResponseBuilder,

    // Whitelist - don't count specific requests
    allowList: (request: FastifyRequest) => {
      // Skip whitelisted IPs
      const ip = keyGenerator(request);
      if (config.rateLimit.whitelist.includes(ip)) {
        request.log.debug({ ip }, 'Rate limit skipped - whitelisted IP');
        return true;
      }

      return false;
    },

    // Add custom headers
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },

    // Hook for when limit is exceeded
    onExceeding: (request: FastifyRequest, key: string) => {
      request.log.warn({ key, url: request.url }, 'Rate limit about to be exceeded');
    },

    // Hook for when limit is exceeded
    onExceeded: (request: FastifyRequest, key: string) => {
      request.log.warn({ key, url: request.url }, 'Rate limit exceeded');
    },
  });

  // Register path-specific rate limits
  const customPaths = config.rateLimit.customPaths;
  if (Object.keys(customPaths).length > 0) {
    for (const [path, limits] of Object.entries(customPaths)) {
      app.log.info({ path, ...limits }, 'Custom rate limit registered');
    }
  }
}

export const rateLimitPlugin = fp(rateLimitPluginFn, {
  name: 'rate-limit',
  dependencies: ['correlation-id'], // Ensure correlation ID is available
});
