/**
 * API Gateway - Entry Point
 *
 * Lightweight reverse proxy for PulsePay platform.
 * This is a "dumb proxy" - no business logic, just routing + middleware.
 *
 * IMPORTANT: OpenTelemetry must be initialized BEFORE importing other modules
 * to ensure proper auto-instrumentation of HTTP, Redis, etc.
 */

// Initialize OpenTelemetry first (before any other imports that might use HTTP)
import { initTracing } from './plugins/tracing.js';
initTracing();

import { buildApp } from './app.js';
import { config } from './config/index.js';

async function main() {
  const app = await buildApp();

  try {
    await app.listen({
      port: config.port,
      host: '0.0.0.0',
    });

    app.log.info(`🚀 API Gateway running at http://localhost:${config.port}`);
    app.log.info(`📋 Health check: http://localhost:${config.port}/health`);
    app.log.info(`🌍 Environment: ${config.nodeEnv}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Graceful shutdown
const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

signals.forEach((signal) => {
  process.on(signal, () => {
    console.log(`\n${signal} received, shutting down gracefully...`);
    process.exit(0);
  });
});

main();
