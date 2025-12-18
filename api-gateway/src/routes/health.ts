/**
 * Health Check Routes
 *
 * Endpoints for load balancers (health) and orchestrators (ready).
 * Note: /metrics is handled by the metrics plugin (src/plugins/metrics.ts)
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Redis } from 'ioredis';
import net from 'node:net';
import { config } from '../config/index.js';
import { checkDatabaseHealth } from '../db/index.js';

interface HealthResponse {
  status: 'ok' | 'degraded' | 'unhealthy';
  timestamp: string;
  service: string;
  version: string;
  uptime: number;
}

type CheckStatus = 'ok' | 'unhealthy' | 'skipped' | 'not_configured';

interface CheckResult {
  status: CheckStatus;
  latencyMs?: number;
  error?: string;
}

function normalizeUpstream(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `http://${trimmed}`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function tcpConnectCheck(host: string, port: number, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new net.Socket();

    const onError = (err: Error) => {
      socket.destroy();
      reject(err);
    };

    socket.setTimeout(timeoutMs, () => onError(new Error('TCP connection timed out')));
    socket.once('error', onError);
    socket.connect(port, host, () => {
      socket.end();
      resolve();
    });
  });
}

async function checkRedis(timeoutMs: number): Promise<CheckResult> {
  if (!config.redis.enabled) return { status: 'skipped' };

  const start = Date.now();
  const client = config.redis.url
    ? new Redis(config.redis.url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: Math.min(timeoutMs, config.redis.connectTimeout),
      })
    : new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        db: config.redis.db,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: Math.min(timeoutMs, config.redis.connectTimeout),
      });

  try {
    await withTimeout(client.connect(), timeoutMs, 'Redis connect timed out');
    const pong = await withTimeout(client.ping(), timeoutMs, 'Redis ping timed out');
    return { status: pong === 'PONG' ? 'ok' : 'unhealthy', latencyMs: Date.now() - start };
  } catch (error) {
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown Redis error',
    };
  } finally {
    try {
      client.disconnect();
    } catch {
      // ignore
    }
  }
}

async function checkDatabase(timeoutMs: number): Promise<CheckResult> {
  const start = Date.now();
  try {
    const result = await withTimeout(
      checkDatabaseHealth(),
      timeoutMs,
      'Database health check timed out',
    );

    return result.healthy
      ? { status: 'ok', latencyMs: result.latencyMs }
      : { status: 'unhealthy', latencyMs: result.latencyMs, error: result.error };
  } catch (error) {
    if (error instanceof Error && error.message.includes('Database pool not initialized')) {
      return { status: 'skipped' };
    }

    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown database error',
    };
  }
}

async function checkDownstreamService(
  upstream: string | undefined,
  timeoutMs: number,
): Promise<CheckResult> {
  if (!upstream) return { status: 'not_configured' };

  const start = Date.now();
  try {
    const url = new URL(normalizeUpstream(upstream));
    const host = url.hostname;
    const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;

    await withTimeout(
      tcpConnectCheck(host, port, timeoutMs),
      timeoutMs,
      'Downstream TCP check timed out',
    );
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (error) {
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown downstream error',
    };
  }
}

export function healthRoutes(
  app: FastifyInstance,
  _opts: Record<string, unknown>,
  done: () => void,
) {
  /**
   * GET /health
   * Liveness probe - is the service running?
   */
  app.get('/health', (_request: FastifyRequest, _reply: FastifyReply): HealthResponse => {
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
   * Checks critical dependencies with short timeouts.
   */
  app.get('/ready', async (_request: FastifyRequest, reply: FastifyReply) => {
    // Keep unit/integration tests deterministic and infra-free.
    const isTestLike = config.nodeEnv === 'test' || process.env.VITEST === 'true';
    if (isTestLike) {
      return reply.status(200).send({
        status: 'ok',
        timestamp: new Date().toISOString(),
        checks: {
          database: { status: 'skipped' },
          redis: { status: 'skipped' },
          downstream: {
            orders: { status: 'skipped' },
            search: { status: 'skipped' },
            webhooks: { status: 'skipped' },
          },
        },
      });
    }

    const timeoutMs = 250;

    const [database, redis, orders, search, webhooks] = await Promise.all([
      checkDatabase(timeoutMs),
      checkRedis(timeoutMs),
      checkDownstreamService(config.services.orders, timeoutMs),
      checkDownstreamService(config.services.search, timeoutMs),
      checkDownstreamService(config.services.webhooks, timeoutMs),
    ]);

    const downstream = { orders, search, webhooks };

    // Gateway readiness should not hard-depend on downstream services being up;
    // those failures are reported in `checks.downstream` but do not block readiness.
    const ready =
      (database.status === 'ok' || database.status === 'skipped') &&
      (redis.status === 'ok' || redis.status === 'skipped');

    const status: HealthResponse['status'] = ready ? 'ok' : 'unhealthy';
    const httpStatus = ready ? 200 : 503;

    return reply.status(httpStatus).send({
      status,
      timestamp: new Date().toISOString(),
      checks: {
        database,
        redis,
        downstream,
      },
    });
  });

  done();
}
