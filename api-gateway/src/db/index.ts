/**
 * Database Module
 *
 * PostgreSQL connection pool and utilities.
 *
 * @remarks
 * Uses node-postgres (pg) with connection pooling.
 * Follows SOLID: Single Responsibility for database concerns.
 */

import pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config/index.js';

const { Pool } = pg;

/**
 * Database configuration interface
 */
export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  poolMin?: number;
  poolMax?: number;
  ssl?: boolean;
}

/**
 * Database connection pool singleton
 */
let pool: pg.Pool | null = null;

/**
 * Create database connection pool
 */
export function createPool(
  dbConfig: DatabaseConfig,
  logger: FastifyBaseLogger
): pg.Pool {
  if (pool) {
    return pool;
  }

  pool = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
    min: dbConfig.poolMin ?? 2,
    max: dbConfig.poolMax ?? 10,
    ssl: dbConfig.ssl ? { rejectUnauthorized: false } : false,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  // Log pool events
  pool.on('connect', () => {
    logger.debug('Database connection established');
  });

  pool.on('error', (err) => {
    logger.error({ err }, 'Unexpected database pool error');
  });

  pool.on('remove', () => {
    logger.debug('Database connection removed from pool');
  });

  return pool;
}

/**
 * Get the database pool (throws if not initialized)
 */
export function getPool(): pg.Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call createPool first.');
  }
  return pool;
}

/**
 * Close database pool
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Database health check
 */
export async function checkDatabaseHealth(): Promise<{
  healthy: boolean;
  latencyMs: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    const client = await getPool().connect();
    await client.query('SELECT 1');
    client.release();
    return {
      healthy: true,
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      healthy: false,
      latencyMs: Date.now() - start,
      error: (error as Error).message,
    };
  }
}

/**
 * Transaction helper
 *
 * @example
 * ```typescript
 * const result = await withTransaction(async (client) => {
 *   await client.query('INSERT INTO users ...');
 *   await client.query('INSERT INTO audit_log ...');
 *   return { success: true };
 * });
 * ```
 */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export type { Pool, PoolClient } from 'pg';
