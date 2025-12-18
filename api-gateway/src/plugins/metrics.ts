/**
 * Metrics Plugin (Prometheus)
 *
 * Exposes application metrics in Prometheus format at /metrics endpoint.
 *
 * Metrics collected:
 * - HTTP request count (by method, path, status)
 * - HTTP request duration histogram
 * - Rate limit hits counter
 * - Active connections gauge
 * - Node.js runtime metrics (memory, CPU, event loop)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import client from 'prom-client';

// Create a Registry
const register = new client.Registry();

// Add default metrics (Node.js runtime metrics)
client.collectDefaultMetrics({
  register,
  prefix: 'gateway_',
});

// Custom metrics

/**
 * HTTP Request Counter
 * Counts total requests by method, path pattern, and status code
 */
const httpRequestsTotal = new client.Counter({
  name: 'gateway_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [register],
});

/**
 * HTTP Request Duration Histogram
 * Tracks request duration in seconds
 */
const httpRequestDuration = new client.Histogram({
  name: 'gateway_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

/**
 * Rate Limit Hits Counter
 * Counts how many times rate limiting was triggered
 */
const rateLimitHitsTotal = new client.Counter({
  name: 'gateway_rate_limit_hits_total',
  help: 'Total number of rate limit hits',
  labelNames: ['route'] as const,
  registers: [register],
});

/**
 * Active Connections Gauge
 * Current number of active connections
 */
const activeConnections = new client.Gauge({
  name: 'gateway_active_connections',
  help: 'Number of active connections',
  registers: [register],
});

/**
 * Upstream Request Counter
 * Counts requests forwarded to upstream services
 */
const upstreamRequestsTotal = new client.Counter({
  name: 'gateway_upstream_requests_total',
  help: 'Total number of requests forwarded to upstream services',
  labelNames: ['service', 'status_code'] as const,
  registers: [register],
});

/**
 * Normalize route path for metrics
 * Converts /api/v1/orders/123 to /api/v1/orders/:id
 */
function normalizeRoute(url: string): string {
  // Remove query string
  const path = url.split('?')[0] || url;

  // Replace common ID patterns
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid')
    .replace(/\/\d+/g, '/:id')
    .replace(/\/[0-9a-f]{24}/gi, '/:objectId');
}

/**
 * Metrics Plugin
 */
function metricsPluginFn(app: FastifyInstance, _opts: Record<string, unknown>, done: () => void) {
  // Track request timing
  app.addHook('onRequest', (request: FastifyRequest, _reply: FastifyReply, done: () => void) => {
    // Store start time in nanoseconds
    (request as FastifyRequest & { metricsStartTime: bigint }).metricsStartTime =
      process.hrtime.bigint();

    // Increment active connections
    activeConnections.inc();
    done();
  });

  // Record metrics on response
  app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    // Always decrement active connections
    activeConnections.dec();

    // Skip metrics endpoint itself to avoid recursion
    if (request.url === '/metrics') return;

    const startTime = (request as FastifyRequest & { metricsStartTime?: bigint }).metricsStartTime;
    const duration = startTime ? Number(process.hrtime.bigint() - startTime) / 1e9 : 0;

    const route = normalizeRoute(request.url);
    const labels = {
      method: request.method,
      route,
      status_code: String(reply.statusCode),
    };

    // Increment request counter
    httpRequestsTotal.inc(labels);

    // Record duration
    httpRequestDuration.observe(labels, duration);

    // Track rate limit hits (429 status)
    if (reply.statusCode === 429) {
      rateLimitHitsTotal.inc({ route });
    }
  });

  // Expose /metrics endpoint
  app.get('/metrics', async (_request: FastifyRequest, reply: FastifyReply) => {
    void reply.header('Content-Type', register.contentType);
    return register.metrics();
  });

  // Expose metrics utilities for other parts of the app
  app.decorate('metrics', {
    register,
    httpRequestsTotal,
    httpRequestDuration,
    rateLimitHitsTotal,
    activeConnections,
    upstreamRequestsTotal,
  });

  app.log.info({
    msg: 'Metrics plugin registered',
    endpoint: '/metrics',
    defaultMetrics: true,
  });

  done();
}

export const metricsPlugin = fp(metricsPluginFn, {
  name: 'metrics',
});

// Export metrics for use in other modules
export {
  register,
  httpRequestsTotal,
  httpRequestDuration,
  rateLimitHitsTotal,
  activeConnections,
  upstreamRequestsTotal,
};

// Type augmentation for Fastify
declare module 'fastify' {
  interface FastifyInstance {
    metrics: {
      register: typeof register;
      httpRequestsTotal: typeof httpRequestsTotal;
      httpRequestDuration: typeof httpRequestDuration;
      rateLimitHitsTotal: typeof rateLimitHitsTotal;
      activeConnections: typeof activeConnections;
      upstreamRequestsTotal: typeof upstreamRequestsTotal;
    };
  }
}
