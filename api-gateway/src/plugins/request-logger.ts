/**
 * Request Logger Plugin
 *
 * Enhanced structured logging for all HTTP requests.
 * Logs request/response details in a consistent JSON format.
 *
 * Features:
 * - Automatic timing of request duration
 * - Correlation ID in all log entries
 * - Redaction of sensitive headers
 * - Request body logging (optional, in dev mode)
 * - Error context enrichment
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { config } from '../config/index.js';

// Headers to redact from logs
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
]);

// Paths to skip detailed logging (health checks, metrics)
const SKIP_DETAILED_LOG_PATHS = new Set(['/health', '/ready', '/metrics']);

/**
 * Redact sensitive headers from an object
 */
function redactHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Request Logger Plugin
 */
function requestLoggerPluginFn(
  app: FastifyInstance,
  _opts: Record<string, unknown>,
  done: () => void,
) {
  // Track request start time
  app.addHook('onRequest', (request: FastifyRequest, _reply: FastifyReply, done: () => void) => {
    // Store start time for duration calculation
    (request as FastifyRequest & { startTime: bigint }).startTime = process.hrtime.bigint();
    done();
  });

  // Log completed requests
  app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = (request as FastifyRequest & { startTime?: bigint }).startTime;
    const duration = startTime ? Number(process.hrtime.bigint() - startTime) / 1e6 : 0;

    // Skip detailed logging for health/metrics endpoints unless there's an error
    const skipDetailed = SKIP_DETAILED_LOG_PATHS.has(request.url) && reply.statusCode < 400;

    if (skipDetailed) {
      // Minimal log for health/metrics
      request.log.debug({
        msg: 'request',
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        durationMs: Math.round(duration * 100) / 100,
      });
      return;
    }

    // Build log entry
    const logEntry: Record<string, unknown> = {
      msg: 'request completed',
      correlationId: request.correlationId,
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      durationMs: Math.round(duration * 100) / 100,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    };

    // Add trace context if available
    const tracedRequest = request as FastifyRequest & { traceId?: string; spanId?: string };
    if (tracedRequest.traceId) {
      logEntry.traceId = tracedRequest.traceId;
      logEntry.spanId = tracedRequest.spanId;
    }

    // Add content length if present
    const contentLength = reply.getHeader('content-length');
    if (contentLength) {
      logEntry.responseSize = formatBytes(Number(contentLength));
    }

    // Add rate limit headers if present
    const rateLimitRemaining = reply.getHeader('x-ratelimit-remaining');
    if (rateLimitRemaining !== undefined) {
      logEntry.rateLimitRemaining = Number(rateLimitRemaining);
    }

    // Log at appropriate level based on status code
    if (reply.statusCode >= 500) {
      request.log.error(logEntry);
    } else if (reply.statusCode >= 400) {
      request.log.warn(logEntry);
    } else {
      request.log.info(logEntry);
    }
  });

  // Log request details in development mode
  if (config.nodeEnv === 'development') {
    app.addHook(
      'preHandler',
      (request: FastifyRequest, _reply: FastifyReply, doneHook: () => void) => {
        // Skip for health/metrics
        if (SKIP_DETAILED_LOG_PATHS.has(request.url)) {
          doneHook();
          return;
        }

        // Log incoming request details
        request.log.debug({
          msg: 'incoming request',
          correlationId: request.correlationId,
          method: request.method,
          url: request.url,
          headers: redactHeaders(request.headers as Record<string, unknown>),
          query: request.query,
          // Only log body if it's not too large and content-type is json
          body:
            request.headers['content-type']?.includes('application/json') &&
            JSON.stringify(request.body || {}).length < 1000
              ? request.body
              : '[BODY_OMITTED]',
        });
        doneHook();
      },
    );
  }

  // Log errors with context
  app.addHook('onError', async (request: FastifyRequest, _reply: FastifyReply, error: Error) => {
    request.log.error({
      msg: 'request error',
      correlationId: request.correlationId,
      method: request.method,
      url: request.url,
      error: {
        name: error.name,
        message: error.message,
        stack: config.nodeEnv === 'development' ? error.stack : undefined,
      },
    });
  });

  app.log.info('Request logger hooks registered');
  done();
}

export const requestLoggerPlugin = fp(requestLoggerPluginFn, {
  name: 'request-logger',
  dependencies: ['correlation-id'],
});
