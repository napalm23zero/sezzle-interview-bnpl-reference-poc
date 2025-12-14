/**
 * Health Check Routes
 *
 * Endpoints for load balancers (health), orchestrators (ready), and monitoring (metrics).
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
  app.get('/health', async (_request: FastifyRequest, _reply: FastifyReply): Promise<HealthResponse> => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'api-gateway',
      version: '0.1.0',
      uptime: process.uptime(),
    };
  });

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

  /**
   * GET /metrics
   * Prometheus metrics endpoint (placeholder)
   */
  app.get('/metrics', async (_request: FastifyRequest, reply: FastifyReply) => {
    // TODO: Implement Prometheus metrics
    reply.type('text/plain');
    return `# HELP api_gateway_up API Gateway is up
# TYPE api_gateway_up gauge
api_gateway_up 1

# HELP api_gateway_uptime_seconds API Gateway uptime in seconds
# TYPE api_gateway_uptime_seconds gauge
api_gateway_uptime_seconds ${process.uptime()}
`;
  });
}
