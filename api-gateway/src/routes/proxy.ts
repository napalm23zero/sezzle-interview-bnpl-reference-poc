/**
 * Proxy Routes
 *
 * Forwards requests to downstream services.
 *
 * Routes:
 * - /api/v1/orders/*   -> ORDERS_SERVICE_URL
 * - /api/v1/search/*   -> SEARCH_SERVICE_URL
 * - /api/v1/webhooks/* -> WEBHOOKS_SERVICE_URL
 */

import type { FastifyPluginAsync } from 'fastify';
import httpProxy from '@fastify/http-proxy';
import { config } from '../config/index.js';
import { ApiException, ErrorCodes, buildErrorResponse } from '../errors/index.js';

function normalizeUpstream(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  return `http://${trimmed}`;
}

function buildNotConfiguredError(serviceName: string, envVar: string): ApiException {
  return new ApiException(
    ErrorCodes.SERVICE_UNAVAILABLE,
    `${serviceName} upstream is not configured (missing ${envVar}).`,
  );
}

export const proxyRoutes: FastifyPluginAsync = async (fastify) => {
  const registerProxy = async (options: {
    serviceName: 'orders' | 'search' | 'webhooks';
    envVar: 'ORDERS_SERVICE_URL' | 'SEARCH_SERVICE_URL' | 'WEBHOOKS_SERVICE_URL';
    upstream?: string;
    prefix: string;
  }) => {
    if (!options.upstream) {
      // Register stubs so routes exist, but fail fast with a clear 503.
      fastify.all(options.prefix, { config: { auth: true } }, () => {
        throw buildNotConfiguredError(options.serviceName, options.envVar);
      });

      fastify.all(`${options.prefix}/*`, { config: { auth: true } }, () => {
        throw buildNotConfiguredError(options.serviceName, options.envVar);
      });

      fastify.log.warn(
        { service: options.serviceName, envVar: options.envVar },
        'Proxy route registered but upstream is not configured',
      );
      return;
    }

    const upstream = normalizeUpstream(options.upstream);

    await fastify.register(httpProxy, {
      upstream,
      prefix: options.prefix,
      rewritePrefix: '/',
      proxyPayloads: true,
      config: { auth: true },
      replyOptions: {
        rewriteRequestHeaders: (request, headers) => {
          const nextHeaders = {
            ...headers,
            'x-correlation-id': request.correlationId,
          };

          const traceparent = request.headers.traceparent;
          if (typeof traceparent === 'string' && traceparent.length > 0) {
            (nextHeaders as Record<string, unknown>).traceparent = traceparent;
          }

          return nextHeaders;
        },
        onResponse: (request, _reply, res) => {
          if (fastify.metrics) {
            fastify.metrics.upstreamRequestsTotal.inc({
              service: options.serviceName,
              status_code: String(res.statusCode),
            });
          }

          request.log.debug(
            { service: options.serviceName, statusCode: res.statusCode },
            'Upstream response received',
          );
        },
        onError: (reply, { error }) => {
          // Standardize upstream failures (offline/DNS/connection refused/etc.)
          const request = reply.request;
          const response = buildErrorResponse({
            code: ErrorCodes.SERVICE_UNAVAILABLE,
            path: request.url,
            method: request.method,
            correlationId: (request as typeof request & { correlationId?: string }).correlationId,
            details: `${options.serviceName} upstream error: ${error.message}`,
          });

          request.log.warn({ service: options.serviceName, err: error }, 'Upstream request failed');

          void reply.status(503).send(response);
        },
      },
    });

    fastify.log.info(
      { service: options.serviceName, upstream, prefix: options.prefix },
      'Proxy route registered',
    );
  };

  await registerProxy({
    serviceName: 'orders',
    envVar: 'ORDERS_SERVICE_URL',
    upstream: config.services.orders,
    prefix: '/api/v1/orders',
  });

  await registerProxy({
    serviceName: 'search',
    envVar: 'SEARCH_SERVICE_URL',
    upstream: config.services.search,
    prefix: '/api/v1/search',
  });

  await registerProxy({
    serviceName: 'webhooks',
    envVar: 'WEBHOOKS_SERVICE_URL',
    upstream: config.services.webhooks,
    prefix: '/api/v1/webhooks',
  });
};
