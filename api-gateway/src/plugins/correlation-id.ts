/**
 * Correlation ID Plugin
 *
 * Generates or propagates X-Correlation-ID header for request tracing.
 * This ID follows the request through all downstream services.
 *
 * Security: Uses UUID v4 + random salt + timestamp hash to prevent:
 * - ID prediction/enumeration attacks
 * - Request tracking by external parties
 * - Correlation ID collision
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { createHash, randomBytes } from 'crypto';

const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Generates a secure, non-predictable correlation ID
 *
 * Format: {timestamp-hash}-{uuid}-{salt-hash}
 * Example: a1b2c3d4-550e8400-e29b-41d4-a716-446655440000-x9y8z7w6
 *
 * Components:
 * - timestamp-hash: First 8 chars of hashed timestamp (prevents timing attacks)
 * - uuid: Standard UUID v4 (uniqueness)
 * - salt-hash: First 8 chars of random salt hash (prevents prediction)
 */
function generateSecureCorrelationId(): string {
  // 1. UUID v4 for uniqueness
  const uuid = crypto.randomUUID();

  // 2. Timestamp with noise (prevents timing-based prediction)
  const timestamp = Date.now().toString();
  const timestampNoise = randomBytes(4).toString('hex');
  const timestampHash = createHash('sha256')
    .update(timestamp + timestampNoise)
    .digest('hex')
    .substring(0, 8);

  // 3. Random salt (prevents enumeration)
  const salt = randomBytes(16).toString('hex');
  const saltHash = createHash('sha256').update(salt).digest('hex').substring(0, 8);

  return `${timestampHash}-${uuid}-${saltHash}`;
}

/**
 * Validates if an incoming correlation ID is safe to use
 * Rejects IDs that look suspicious or malformed
 */
function isValidCorrelationId(id: string): boolean {
  // Must be a string
  if (typeof id !== 'string') return false;

  // Reasonable length (our format is ~54 chars, allow some flexibility)
  if (id.length < 10 || id.length > 100) return false;

  // Only allow alphanumeric and hyphens (prevent injection)
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return false;

  return true;
}

async function correlationId(app: FastifyInstance) {
  // Add correlation ID to every request
  app.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    // Check for existing correlation ID from upstream
    const existingId = request.headers[CORRELATION_ID_HEADER];

    // Use existing ID only if it passes validation, otherwise generate new
    const correlationId =
      typeof existingId === 'string' && isValidCorrelationId(existingId)
        ? existingId
        : generateSecureCorrelationId();

    // Store in request for use in handlers and logs
    request.correlationId = correlationId;

    // Add to logger context for automatic inclusion in logs
    request.log = request.log.child({ correlationId });
  });

  // Add correlation ID to every response
  app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header(CORRELATION_ID_HEADER, request.correlationId);
  });

  // Log request completion with correlation ID
  app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    request.log.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime,
      },
      'request completed',
    );
  });
}

// Extend FastifyRequest type to include correlationId
declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
  }
}

export const correlationIdPlugin = fp(correlationId, {
  name: 'correlation-id',
});
