/**
 * Redis Connection Manager
 *
 * Provides centralized Redis connection management with singleton pattern
 * for the application.
 */

import { Redis, type RedisOptions } from 'ioredis';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config/index.js';

let redisClient: Redis | null = null;

function asLogError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: config.nodeEnv === 'development' ? error.stack : undefined,
    };
  }

  return { message: typeof error === 'string' ? error : 'Unknown error' };
}

const noopLogger: FastifyBaseLogger = {
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
} as unknown as FastifyBaseLogger;

/**
 * Redis connection configuration interface
 */
export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  maxRetriesPerRequest?: number;
  lazyConnect?: boolean;
  enableReadyCheck?: boolean;
}

/**
 * Creates a new Redis client with the provided configuration
 */
export function createRedisClient(cfg?: Partial<RedisConfig>, logger?: FastifyBaseLogger): Redis {
  const log = logger ?? noopLogger;

  const options: RedisConfig = {
    host: cfg?.host ?? config.redis.host,
    port: cfg?.port ?? config.redis.port,
    password: cfg?.password ?? config.redis.password,
    db: cfg?.db ?? config.redis.db,
    keyPrefix: cfg?.keyPrefix,
    maxRetriesPerRequest: cfg?.maxRetriesPerRequest ?? 3,
    lazyConnect: cfg?.lazyConnect ?? true,
    enableReadyCheck: cfg?.enableReadyCheck ?? true,
  };

  // Filter out undefined password
  const redisOptions: Record<string, unknown> = {
    host: options.host,
    port: options.port,
    db: options.db,
    maxRetriesPerRequest: options.maxRetriesPerRequest,
    lazyConnect: options.lazyConnect,
    enableReadyCheck: options.enableReadyCheck,
  };

  if (options.password) {
    redisOptions.password = options.password;
  }

  if (options.keyPrefix) {
    redisOptions.keyPrefix = options.keyPrefix;
  }

  const client = new Redis(redisOptions as RedisOptions);

  // Log connection events
  client.on('connect', () => {
    log.info({ host: options.host, port: options.port }, 'Redis connected');
  });

  client.on('ready', () => {
    log.info('Redis client ready');
  });

  client.on('error', (error: Error) => {
    log.error({ err: asLogError(error) }, 'Redis client error');
  });

  client.on('close', () => {
    log.info('Redis connection closed');
  });

  client.on('reconnecting', () => {
    log.warn('Redis reconnecting');
  });

  return client;
}

/**
 * Gets the singleton Redis client instance
 * Creates a new connection if one doesn't exist
 */
export async function getRedisClient(): Promise<Redis> {
  if (!redisClient) {
    redisClient = createRedisClient();
    await redisClient.connect();
  }
  return redisClient;
}

/**
 * Closes the Redis connection
 */
export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

/**
 * Checks Redis connection health
 */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    const client = await getRedisClient();
    const pong = await client.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

/**
 * Gets Redis client information
 */
export async function getRedisInfo(): Promise<Record<string, string>> {
  const client = await getRedisClient();
  const info = await client.info();

  const result: Record<string, string> = {};
  const lines = info.split('\n');

  for (const line of lines) {
    if (line.includes(':')) {
      const [key, value] = line.split(':');
      if (key) {
        result[key.trim()] = value?.trim() ?? '';
      }
    }
  }

  return result;
}

export default {
  createRedisClient,
  getRedisClient,
  closeRedisClient,
  checkRedisHealth,
  getRedisInfo,
};
