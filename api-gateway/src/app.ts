/**
 * Fastify Application Factory
 *
 * Creates and configures the Fastify instance with all plugins and routes.
 */

import Fastify, { FastifyInstance } from 'fastify';
import { config } from './config/index.js';
import { healthRoutes } from './routes/health.js';
import { correlationIdPlugin } from './plugins/correlation-id.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { rateLimitPlugin } from './plugins/rate-limit.js';
import { tracingPlugin } from './plugins/tracing.js';
import { requestLoggerPlugin } from './plugins/request-logger.js';
import { metricsPlugin } from './plugins/metrics.js';

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

  // Register routes
  await app.register(healthRoutes);

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
