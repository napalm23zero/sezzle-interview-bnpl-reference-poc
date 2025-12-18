/**
 * Refresh Token Repository
 *
 * Data access layer for refresh tokens.
 * Tokens are stored in PostgreSQL for persistence and Redis for fast lookup.
 */

import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import type { FastifyBaseLogger } from 'fastify';
import {
  type RefreshToken,
  type CreateRefreshTokenInput,
  rowToRefreshToken,
} from '../entities/refresh-token.entity.js';

function parseCacheEntry(value: string): { userId?: string; revoked?: boolean } | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    return {
      userId: typeof record.userId === 'string' ? record.userId : undefined,
      revoked: typeof record.revoked === 'boolean' ? record.revoked : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Refresh Token Repository Interface
 */
export interface IRefreshTokenRepository {
  create(input: CreateRefreshTokenInput): Promise<RefreshToken>;
  findByTokenId(tokenId: string): Promise<RefreshToken | null>;
  revoke(tokenId: string, reason?: string): Promise<boolean>;
  revokeAllForUser(userId: string, reason?: string): Promise<number>;
  cleanup(): Promise<number>;
}

/**
 * Redis key patterns for token caching
 */
const REDIS_KEYS = {
  TOKEN: (tokenId: string) => `refresh_token:${tokenId}`,
  USER_TOKENS: (userId: string) => `user_tokens:${userId}`,
  REVOKED: (tokenId: string) => `revoked:${tokenId}`,
};

/**
 * PostgreSQL + Redis Refresh Token Repository
 */
export class RefreshTokenRepository implements IRefreshTokenRepository {
  private readonly pool: Pool;
  private readonly redis: Redis | null;
  private readonly logger: FastifyBaseLogger;
  private readonly tokenTtl: number; // seconds

  constructor(
    pool: Pool,
    redis: Redis | null,
    logger: FastifyBaseLogger,
    tokenTtlSeconds: number = 604800, // 7 days default
  ) {
    this.pool = pool;
    this.redis = redis;
    this.logger = logger.child({ component: 'RefreshTokenRepository' });
    this.tokenTtl = tokenTtlSeconds;
  }

  /**
   * Create a new refresh token
   */
  async create(input: CreateRefreshTokenInput): Promise<RefreshToken> {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO refresh_tokens (
        token_id,
        user_id,
        expires_at,
        user_agent,
        ip_address,
        device_name
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        input.tokenId,
        input.userId,
        input.expiresAt,
        input.userAgent || null,
        input.ipAddress || null,
        input.deviceName || null,
      ],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to create refresh token');
    }

    const token = rowToRefreshToken(row);

    // Cache in Redis for fast lookup
    if (this.redis) {
      const ttl = Math.floor((input.expiresAt.getTime() - Date.now()) / 1000);
      if (ttl > 0) {
        await this.redis.setex(
          REDIS_KEYS.TOKEN(input.tokenId),
          ttl,
          JSON.stringify({ userId: input.userId, revoked: false }),
        );

        // Track user's tokens
        await this.redis.sadd(REDIS_KEYS.USER_TOKENS(input.userId), input.tokenId);
        await this.redis.expire(REDIS_KEYS.USER_TOKENS(input.userId), this.tokenTtl);
      }
    }

    this.logger.debug({ tokenId: input.tokenId, userId: input.userId }, 'Refresh token created');

    return token;
  }

  /**
   * Find refresh token by token ID (jti)
   */
  async findByTokenId(tokenId: string): Promise<RefreshToken | null> {
    // Try Redis first for fast lookup
    if (this.redis) {
      const cached = await this.redis.get(REDIS_KEYS.TOKEN(tokenId));
      if (cached) {
        const data = parseCacheEntry(cached);
        if (data?.revoked) {
          return null; // Token is revoked
        }
      }

      // Check if explicitly revoked
      const isRevoked = await this.redis.exists(REDIS_KEYS.REVOKED(tokenId));
      if (isRevoked) {
        return null;
      }
    }

    // Query database
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM refresh_tokens 
       WHERE token_id = $1 
       AND revoked = FALSE 
       AND expires_at > NOW()`,
      [tokenId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return rowToRefreshToken(row);
  }

  /**
   * Revoke a refresh token
   */
  async revoke(tokenId: string, reason?: string): Promise<boolean> {
    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE refresh_tokens SET 
        revoked = TRUE,
        revoked_at = NOW(),
        revoked_reason = $2
      WHERE token_id = $1 AND revoked = FALSE
      RETURNING user_id`,
      [tokenId, reason || 'User logout'],
    );

    if (result.rowCount === 0) {
      return false;
    }

    const row = result.rows[0];
    if (!row) {
      throw new Error('Expected refresh token revoke result row');
    }

    // Update Redis
    if (this.redis) {
      // Mark as revoked in cache
      await this.redis.setex(REDIS_KEYS.REVOKED(tokenId), this.tokenTtl, 'revoked');

      // Remove from active tokens
      await this.redis.del(REDIS_KEYS.TOKEN(tokenId));

      // Remove from user's token set
      const userId = String(row.user_id);
      await this.redis.srem(REDIS_KEYS.USER_TOKENS(userId), tokenId);
    }

    this.logger.info({ tokenId, reason }, 'Refresh token revoked');

    return true;
  }

  /**
   * Revoke all tokens for a user
   */
  async revokeAllForUser(userId: string, reason?: string): Promise<number> {
    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE refresh_tokens SET 
        revoked = TRUE,
        revoked_at = NOW(),
        revoked_reason = $2
      WHERE user_id = $1 AND revoked = FALSE
      RETURNING token_id`,
      [userId, reason || 'Logout all devices'],
    );

    const count = result.rowCount || 0;

    // Update Redis
    if (this.redis && count > 0) {
      const tokenIds = result.rows.map((row) => String(row.token_id));

      const pipeline = this.redis.pipeline();
      for (const tokenId of tokenIds) {
        pipeline.setex(REDIS_KEYS.REVOKED(tokenId), this.tokenTtl, 'revoked');
        pipeline.del(REDIS_KEYS.TOKEN(tokenId));
      }
      pipeline.del(REDIS_KEYS.USER_TOKENS(userId));
      await pipeline.exec();
    }

    this.logger.info({ userId, count, reason }, 'All user refresh tokens revoked');

    return count;
  }

  /**
   * Update last used timestamp
   */
  async updateLastUsed(tokenId: string): Promise<void> {
    await this.pool.query('UPDATE refresh_tokens SET last_used_at = NOW() WHERE token_id = $1', [
      tokenId,
    ]);
  }

  /**
   * Cleanup expired tokens (run periodically)
   */
  async cleanup(): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM refresh_tokens 
       WHERE expires_at < NOW() - INTERVAL '7 days'
       OR (revoked = TRUE AND revoked_at < NOW() - INTERVAL '30 days')`,
    );

    const count = result.rowCount || 0;

    if (count > 0) {
      this.logger.info({ count }, 'Expired refresh tokens cleaned up');
    }

    return count;
  }

  /**
   * Get active sessions for a user
   */
  async getActiveSessionsForUser(userId: string): Promise<RefreshToken[]> {
    const result = await this.pool.query(
      `SELECT * FROM refresh_tokens 
       WHERE user_id = $1 
       AND revoked = FALSE 
       AND expires_at > NOW()
       ORDER BY issued_at DESC`,
      [userId],
    );

    return result.rows.map(rowToRefreshToken);
  }
}
