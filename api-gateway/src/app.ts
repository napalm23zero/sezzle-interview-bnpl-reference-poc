/**
 * Fastify Application Factory
 *
 * Creates and configures the Fastify instance with all plugins and routes.
 */

import Fastify, { FastifyInstance } from 'fastify';
import Redis from 'ioredis';
import { config } from './config/index.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
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
    genReqId: () => crypto.randomUUID(),
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
    const authRedis = config.redis.enabled && config.redis.url
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
        app.log.warn({ error }, 'Auth Redis connection failed, caching disabled');
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

  // Auth routes - user registration, login, refresh, logout
  // Initialize database pool and Redis client for auth
  const dbPool = createPool(config.postgres, app.log);
  const authRedisClient = createRedisClient({ keyPrefix: 'auth:' });
  
  try {
    await authRedisClient.connect();
    app.log.info('Auth Redis client connected');
  } catch (error) {
    app.log.warn({ error }, 'Failed to connect auth Redis client');
  }

  // Check database health
  const dbHealthy = await checkDatabaseHealth();
  if (dbHealthy) {
    app.log.info('Database connection established');
  } else {
    app.log.warn('Database connection check failed');
  }

  // Create JWT provider for auth routes
  const jwtProvider = new JWTProvider({
    secret: config.jwt.secret,
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
    algorithm: config.jwt.algorithm,
    accessTokenExpiry: config.jwt.accessTokenExpiry,
    refreshTokenExpiry: config.jwt.refreshTokenExpiry,
    clockTolerance: config.jwt.clockTolerance,
  }, app.log);

  // Register auth routes with proper options
  await app.register(authRoutes, {
    prefix: '/auth',
    pool: dbPool,
    redis: authRedisClient,
    jwtProvider: {
      generateAccessToken: async (payload: Record<string, unknown>) => {
        return jwtProvider.generateAccessToken(payload as Parameters<typeof jwtProvider.generateAccessToken>[0]);
      },
      generateRefreshToken: async (payload: { sub: string }) => {
        return jwtProvider.generateRefreshToken(payload);
      },
      verifyRefreshToken: async (token: string) => {
        return jwtProvider.verifyRefreshToken(token);
      },
    },
    config: {
      accessTokenExpiry: config.jwt.accessTokenExpiry,
      refreshTokenExpiry: config.jwt.refreshTokenExpiry,
    },
  });

  // Graceful shutdown handler
  const gracefulShutdown = async () => {
    app.log.info('Graceful shutdown initiated');
    
    try {
      await closePool();
      app.log.info('Database pool closed');
    } catch (error) {
      app.log.error({ error }, 'Error closing database pool');
    }
    
    try {
      await authRedisClient.quit();
      app.log.info('Auth Redis client closed');
    } catch (error) {
      app.log.error({ error }, 'Error closing auth Redis client');
    }
  };

  // Store shutdown handler on app for external access
  app.decorate('gracefulShutdown', gracefulShutdown);

  // Root route - basic info
  app.get('/', async () => {
    return {
      service: 'api-gateway',
      version: '0.1.0',
      status: 'running',
      docs: '/health for health check',
    };
  });

  return app;
}
