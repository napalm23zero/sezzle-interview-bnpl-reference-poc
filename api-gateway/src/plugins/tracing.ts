/**
 * OpenTelemetry Tracing Plugin
 *
 * Provides distributed tracing across the API Gateway and downstream services.
 * Exports traces to an OTEL Collector (Jaeger, Zipkin, etc.)
 *
 * IMPORTANT: This file should be imported BEFORE any other modules to ensure
 * proper instrumentation. In practice, we initialize OTEL in index.ts.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { diag, DiagConsoleLogger, DiagLogLevel, trace, SpanStatusCode } from '@opentelemetry/api';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { config } from '../config/index.js';

// SDK instance (singleton)
let sdk: NodeSDK | null = null;

/**
 * Initialize OpenTelemetry SDK
 * This should be called ONCE at application startup, before any other imports
 */
export function initTracing(): NodeSDK | null {
  // Skip if already initialized
  if (sdk) {
    return sdk;
  }

  // Skip if OTEL is disabled
  if (!config.otel.enabled) {
    process.stdout.write('📊 OpenTelemetry: DISABLED (OTEL_ENABLED=false)\n');
    return null;
  }

  // Skip if no endpoint configured
  if (!config.otel.endpoint) {
    process.stdout.write(
      '📊 OpenTelemetry: DISABLED (no OTEL_EXPORTER_OTLP_ENDPOINT configured)\n',
    );
    return null;
  }

  // Enable diagnostic logging in development
  if (config.nodeEnv === 'development') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  }

  // Create the trace exporter
  const traceExporter = new OTLPTraceExporter({
    url: `${config.otel.endpoint}/v1/traces`,
  });

  // Create resource with service metadata
  const resource = new Resource({
    [ATTR_SERVICE_NAME]: config.otel.serviceName,
    [ATTR_SERVICE_VERSION]: '0.1.0',
    'deployment.environment': config.nodeEnv,
  });

  // Create the SDK
  sdk = new NodeSDK({
    resource,
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable some noisy instrumentations
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        // Enable HTTP instrumentation for tracing requests
        '@opentelemetry/instrumentation-http': {
          enabled: true,
          ignoreIncomingPaths: ['/health', '/ready', '/metrics'],
        },
      }),
    ],
  });

  // Start the SDK
  sdk.start();

  process.stdout.write(`📊 OpenTelemetry: ENABLED\n`);
  process.stdout.write(`   Endpoint: ${config.otel.endpoint}\n`);
  process.stdout.write(`   Service: ${config.otel.serviceName}\n`);

  // Graceful shutdown
  process.on('SIGTERM', () => {
    sdk
      ?.shutdown()
      .then(() => process.stdout.write('📊 OpenTelemetry SDK shut down\n'))
      .catch((err) => process.stderr.write(`Error shutting down OTEL SDK: ${err}\n`));
  });

  return sdk;
}

/**
 * Get the active tracer
 */
export function getTracer(name = 'api-gateway') {
  return trace.getTracer(name);
}

/**
 * Create a custom span for tracking specific operations
 */
export function createSpan(name: string, fn: () => Promise<void> | void): Promise<void> {
  const tracer = getTracer();
  return tracer.startActiveSpan(name, async (span) => {
    try {
      await fn();
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Tracing Plugin for Fastify
 *
 * Adds trace context to requests and creates spans for each request.
 * Works with the auto-instrumentation but adds extra context.
 */
function tracingPluginFn(app: FastifyInstance, _opts: Record<string, unknown>, done: () => void) {
  // Add trace ID to request for logging
  app.addHook(
    'onRequest',
    (request: FastifyRequest, _reply: FastifyReply, doneHook: () => void) => {
      const span = trace.getActiveSpan();
      if (span) {
        const spanContext = span.spanContext();
        // Add trace context to request for downstream use
        (request as FastifyRequest & { traceId?: string; spanId?: string }).traceId =
          spanContext.traceId;
        (request as FastifyRequest & { traceId?: string; spanId?: string }).spanId =
          spanContext.spanId;

        // Add correlation ID to span attributes
        if (request.correlationId) {
          span.setAttribute('correlation.id', request.correlationId);
        }

        // Add request metadata to span
        span.setAttribute('http.route', request.url);
        span.setAttribute('http.user_agent', request.headers['user-agent'] || 'unknown');
      }
      doneHook();
    },
  );

  // Add response status to span
  app.addHook(
    'onResponse',
    (_request: FastifyRequest, reply: FastifyReply, doneHook: () => void) => {
      const span = trace.getActiveSpan();
      if (span) {
        span.setAttribute('http.status_code', reply.statusCode);

        // Mark span as error if 5xx
        if (reply.statusCode >= 500) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: `HTTP ${reply.statusCode}`,
          });
        }
      }
      doneHook();
    },
  );

  app.log.info('Tracing hooks registered');
  done();
}

export const tracingPlugin = fp(tracingPluginFn, {
  name: 'tracing',
  dependencies: ['correlation-id'],
});

// Augment Fastify types
declare module 'fastify' {
  interface FastifyRequest {
    traceId?: string;
    spanId?: string;
  }
}
