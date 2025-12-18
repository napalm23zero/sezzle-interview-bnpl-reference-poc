/**
 * Fastify Application Factory
 *
 * Creates and configures the Fastify instance with all plugins and routes.
 */

import Fastify, { FastifyInstance } from 'fastify';
import { Redis, type Redis as RedisClient } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { config } from './config/index.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { proxyRoutes } from './routes/proxy.js';
import { correlationIdPlugin } from './plugins/correlation-id.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { rateLimitPlugin } from './plugins/rate-limit.js';
import { tracingPlugin } from './plugins/tracing.js';
import { requestLoggerPlugin } from './plugins/request-logger.js';
import { metricsPlugin } from './plugins/metrics.js';
import { authPlugin } from './plugins/auth.js';
import { JWTProvider } from './auth/providers/jwt.provider.js';
import { createPool, closePool, checkDatabaseHealth } from './db/index.js';
import { createRedisClient } from './redis/index.js';

function asErrorInfo(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: config.nodeEnv === 'development' ? error.stack : undefined,
    };
  }

  return {
    message: typeof error === 'string' ? error : 'Unknown error',
  };
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport:
        config.nodeEnv === 'development'
          ? {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname',
              },
            }
          : undefined,
    },
    // Generate request IDs if not provided
    genReqId: () => randomUUID(),
  });

  // Register plugins (order matters!)
  // 1. Correlation ID - must be first for logging context
  await app.register(correlationIdPlugin);

  // 2. Tracing - OpenTelemetry spans
  await app.register(tracingPlugin);

  // 3. Metrics - Prometheus /metrics endpoint
  if (config.metrics.enabled) {
    await app.register(metricsPlugin);
  }

  // 4. Request Logger - structured logging
  await app.register(requestLoggerPlugin);

  // 5. Error Handler - consistent error responses
  await app.register(errorHandlerPlugin);

  // 6. Rate Limiting - protect against abuse
  await app.register(rateLimitPlugin);

  // 7. Authentication - JWT-based auth
  if (config.jwt.enabled) {
    // Create Redis client for auth if enabled
    const authRedis: RedisClient | undefined =
      config.nodeEnv !== 'test' && config.redis.enabled && config.redis.url
        ? new Redis(config.redis.url, {
            maxRetriesPerRequest: 3,
            lazyConnect: true,
            keyPrefix: 'auth:',
          })
        : undefined;

    // Connect to Redis if available
    if (authRedis) {
      try {
        await authRedis.connect();
        app.log.info('Auth Redis connection established');
      } catch (error) {
        app.log.warn({ err: asErrorInfo(error) }, 'Auth Redis connection failed, caching disabled');
      }
    }

    await app.register(authPlugin, {
      redis: authRedis,
      jwt: {
        secret: config.jwt.secret,
        issuer: config.jwt.issuer,
        audience: config.jwt.audience,
        algorithm: config.jwt.algorithm,
        accessTokenExpiry: config.jwt.accessTokenExpiry,
        refreshTokenExpiry: config.jwt.refreshTokenExpiry,
        clockTolerance: config.jwt.clockTolerance,
      },
      cache: config.tokenCache.enabled
        ? {
            keyPrefix: config.tokenCache.keyPrefix,
            defaultTtl: config.tokenCache.defaultTtl,
            revokedTokenTtl: config.tokenCache.revokedTokenTtl,
            enabled: true,
          }
        : { enabled: false },
      service: {
        enableCache: config.tokenCache.enabled,
        checkRevocation: true,
        cacheValidatedTokens: config.tokenCache.enabled,
      },
      // Authentication is opt-in per route by default
      enableGlobal: false,
    });
  }

  // Register routes
  await app.register(healthRoutes);

  let authRedisClient: ReturnType<typeof createRedisClient> | null = null;

  if (config.nodeEnv !== 'test') {
    // Auth routes - user registration, login, refresh, logout
    // Initialize database pool and Redis client for auth
    const dbPool = createPool(config.postgres, app.log);
    authRedisClient = createRedisClient({ keyPrefix: 'auth:' }, app.log);

    try {
      await authRedisClient.connect();
      app.log.info('Auth Redis client connected');
    } catch (error) {
      app.log.warn({ err: asErrorInfo(error) }, 'Failed to connect auth Redis client');
    }

    // Check database health
    const dbHealth = await checkDatabaseHealth();
    if (dbHealth.healthy) {
      app.log.info({ latencyMs: dbHealth.latencyMs }, 'Database connection established');
    } else {
      app.log.warn(
        { latencyMs: dbHealth.latencyMs, error: dbHealth.error },
        'Database connection check failed',
      );
    }

    // Create JWT provider for auth routes
    const jwtProvider = new JWTProvider(
      {
        secret: config.jwt.secret,
        issuer: config.jwt.issuer,
        audience: config.jwt.audience,
        algorithm: config.jwt.algorithm,
        accessTokenExpiry: config.jwt.accessTokenExpiry,
        refreshTokenExpiry: config.jwt.refreshTokenExpiry,
        clockTolerance: config.jwt.clockTolerance,
      },
      app.log,
    );

    // Register auth routes with proper options
    await app.register(authRoutes, {
      prefix: '/auth',
      pool: dbPool,
      redis: authRedisClient,
      jwtProvider: {
        generateAccessToken: (payload: Record<string, unknown>) =>
          jwtProvider.generateAccessToken(
            payload as Parameters<typeof jwtProvider.generateAccessToken>[0],
          ),
        generateRefreshToken: (payload: { sub: string }) =>
          jwtProvider.generateRefreshToken(payload),
        verifyRefreshToken: (token: string) => jwtProvider.verifyRefreshToken(token),
      },
      config: {
        accessTokenExpiry: config.jwt.accessTokenExpiry,
        refreshTokenExpiry: config.jwt.refreshTokenExpiry,
      },
    });
  } else {
    app.log.info('Test mode: skipping auth DB/Redis initialization');
  }

  // Proxy routes - forward to downstream services
  await app.register(proxyRoutes);

  // Graceful shutdown handler
  const gracefulShutdown = async () => {
    app.log.info('Graceful shutdown initiated');

    try {
      await closePool();
      app.log.info('Database pool closed');
    } catch (error) {
      app.log.error({ err: asErrorInfo(error) }, 'Error closing database pool');
    }

    try {
      if (authRedisClient) {
        await authRedisClient.quit();
        app.log.info('Auth Redis client closed');
      }
    } catch (error) {
      app.log.error({ err: asErrorInfo(error) }, 'Error closing auth Redis client');
    }
  };

  // Store shutdown handler on app for external access
  app.decorate('gracefulShutdown', gracefulShutdown);

  // Root route - basic info
  app.get('/', () => {
    return {
      service: 'api-gateway',
      version: '0.1.0',
      status: 'running',
      docs: '/health for health check',
    };
  });

  return app;
}
