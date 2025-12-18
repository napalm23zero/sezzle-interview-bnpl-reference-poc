/**
 * Error Handler Plugin
 *
 * Provides consistent error responses across the API Gateway.
 * Catches all unhandled errors and formats them using our standard format.
 */

import { FastifyInstance, FastifyRequest, FastifyReply, FastifyError } from 'fastify';
import fp from 'fastify-plugin';
import { ApiException, ErrorCodes, ErrorStatusCodes, buildErrorResponse } from '../errors/index.js';

function errorHandlerPluginFn(
  app: FastifyInstance,
  _opts: Record<string, unknown>,
  done: () => void,
) {
  // Global error handler
  app.setErrorHandler(
    async (
      error: FastifyError | ApiException | Error,
      request: FastifyRequest,
      reply: FastifyReply,
    ) => {
      const correlationId = request.correlationId;

      // Handle our custom ApiException
      if (error instanceof ApiException) {
        const response = buildErrorResponse({
          code: error.code,
          path: request.url,
          method: request.method,
          correlationId,
          details: error.details,
          retryAfter: error.retryAfter,
        });

        request.log.warn(
          {
            err: error,
            code: error.code,
            statusCode: error.statusCode,
          },
          'API Exception',
        );

        if (error.retryAfter) {
          void reply.header('Retry-After', error.retryAfter);
        }

        return reply.status(error.statusCode).send(response);
      }

      // Handle Fastify validation errors
      if ('validation' in error && error.validation) {
        const response = buildErrorResponse({
          code: ErrorCodes.VALIDATION_FAILED,
          path: request.url,
          method: request.method,
          correlationId,
          details: error.message,
        });

        request.log.warn({ err: error }, 'Validation error');

        return reply.status(400).send(response);
      }

      // Handle rate limit errors (from @fastify/rate-limit)
      // The plugin throws our formatted response object directly
      if (
        typeof error === 'object' &&
        error !== null &&
        'success' in error &&
        (error as { success: boolean }).success === false &&
        'error' in error
      ) {
        const errorResponse = error as {
          success: boolean;
          error: { code: string; retryAfter?: number };
        };
        const statusCode =
          ErrorStatusCodes[errorResponse.error.code as keyof typeof ErrorStatusCodes] || 500;

        if (errorResponse.error.retryAfter) {
          void reply.header('Retry-After', errorResponse.error.retryAfter);
        }

        request.log.warn(
          { code: errorResponse.error.code, url: request.url },
          'Pre-formatted error response',
        );
        return reply.status(statusCode).send(error);
      }

      // Handle known HTTP errors
      if ('statusCode' in error && typeof error.statusCode === 'number') {
        const code = getErrorCodeFromStatus(error.statusCode);
        const response = buildErrorResponse({
          code,
          path: request.url,
          method: request.method,
          correlationId,
          details: error.message,
        });

        request.log.warn(
          {
            err: error,
            statusCode: error.statusCode,
          },
          'HTTP error',
        );

        return reply.status(error.statusCode).send(response);
      }

      // Handle unknown errors (500)
      const response = buildErrorResponse({
        code: ErrorCodes.INTERNAL_ERROR,
        path: request.url,
        method: request.method,
        correlationId,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });

      request.log.error({ err: error }, 'Unhandled error');

      return reply.status(500).send(response);
    },
  );

  // Handle 404 - Not Found
  app.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const response = buildErrorResponse({
      code: ErrorCodes.RESOURCE_NOT_FOUND,
      path: request.url,
      method: request.method,
      correlationId: request.correlationId,
      details: `Route ${request.method} ${request.url} not found`,
    });

    request.log.info({ url: request.url, method: request.method }, 'Route not found');

    return reply.status(404).send(response);
  });

  done();
}

/**
 * Map HTTP status codes to our error codes
 */
function getErrorCodeFromStatus(statusCode: number): keyof typeof ErrorStatusCodes {
  switch (statusCode) {
    case 400:
      return ErrorCodes.BAD_REQUEST;
    case 401:
      return ErrorCodes.AUTH_MISSING_TOKEN;
    case 403:
      return ErrorCodes.AUTH_INSUFFICIENT_PERMISSIONS;
    case 404:
      return ErrorCodes.RESOURCE_NOT_FOUND;
    case 405:
      return ErrorCodes.METHOD_NOT_ALLOWED;
    case 409:
      return ErrorCodes.RESOURCE_CONFLICT;
    case 415:
      return ErrorCodes.UNSUPPORTED_MEDIA_TYPE;
    case 429:
      return ErrorCodes.RATE_LIMIT_EXCEEDED;
    case 502:
      return ErrorCodes.UPSTREAM_ERROR;
    case 503:
      return ErrorCodes.SERVICE_UNAVAILABLE;
    case 504:
      return ErrorCodes.TIMEOUT;
    default:
      return ErrorCodes.INTERNAL_ERROR;
  }
}

export const errorHandlerPlugin = fp(errorHandlerPluginFn, {
  name: 'error-handler',
  dependencies: ['correlation-id'],
});
