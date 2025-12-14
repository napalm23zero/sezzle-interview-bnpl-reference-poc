/**
 * Health Check Routes
 *
 * Endpoints for load balancers (health) and orchestrators (ready).
 * Note: /metrics is handled by the metrics plugin (src/plugins/metrics.ts)
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

interface HealthResponse {
  status: 'ok' | 'degraded' | 'unhealthy';
  timestamp: string;
  service: string;
  version: string;
  uptime: number;
}

export async function healthRoutes(app: FastifyInstance) {
  /**
   * GET /health
   * Liveness probe - is the service running?
   */
  app.get(
    '/health',
    async (_request: FastifyRequest, _reply: FastifyReply): Promise<HealthResponse> => {
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'api-gateway',
        version: '0.1.0',
        uptime: process.uptime(),
      };
    },
  );

  /**
   * GET /ready
   * Readiness probe - is the service ready to accept traffic?
   * In the future, this will check Redis, downstream services, etc.
   */
  app.get('/ready', async (_request: FastifyRequest, _reply: FastifyReply) => {
    // TODO: Add dependency checks (Redis, downstream services)
    const checks = {
      redis: 'skipped', // Will implement when rate limiting is added
      downstream: 'skipped', // Will implement when proxy routes are added
    };

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      checks,
    };
  });
}
