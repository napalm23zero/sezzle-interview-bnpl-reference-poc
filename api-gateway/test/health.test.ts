import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('health routes', () => {
  it('GET /health returns ok', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);

    const body = res.json() as { status: string; service: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('api-gateway');

    await app.close();
    if (app.gracefulShutdown) {
      await app.gracefulShutdown();
    }
  });

  it('GET /ready returns ok', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/ready',
    });

    expect(res.statusCode).toBe(200);

    const body = res.json() as { status: string };
    expect(body.status).toBe('ok');

    await app.close();
    if (app.gracefulShutdown) {
      await app.gracefulShutdown();
    }
  });
});
