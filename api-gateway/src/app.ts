/**
 * Fastify Application Factory
 *
 * Creates and configures the Fastify instance with all plugins and routes.
 */

import Fastify, { FastifyInstance } from 'fastify';
import { config } from './config/index.js';
import { healthRoutes } from './routes/health.js';
import { correlationIdPlugin } from './plugins/correlation-id.js';

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

  // Register plugins
  await app.register(correlationIdPlugin);

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
