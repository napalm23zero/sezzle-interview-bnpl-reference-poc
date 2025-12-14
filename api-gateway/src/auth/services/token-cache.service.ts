/**
 * Token Cache Service
 *
 * Redis-backed caching for JWT tokens to optimize performance.
 *
 * @remarks
 * - Caches validated tokens to avoid repeated cryptographic verification
 * - Maintains a revoked tokens list for logout support
 * - Uses TTL to auto-expire entries
 * - Follows SRP: only handles caching, not validation
 *
 * Key Patterns:
 * - `auth:tokens:{hash}` - Cached validated token payloads
 * - `auth:revoked:{jti}` - Revoked token IDs
 * - `auth:user:{userId}:tokens` - User's active token list (for mass revocation)
 *
 * @example
 * ```typescript
 * const cache = new TokenCacheService(redisClient);
 *
 * // Cache a validated token
 * await cache.cacheToken('abc123hash', payload, 3600);
 *
 * // Check if token is in cache
 * const cached = await cache.getCachedToken('abc123hash');
 *
 * // Revoke a token
 * await cache.revokeToken(payload.jti, payload.userId);
 * ```
 */

import { createHash } from 'crypto';
import type { FastifyBaseLogger } from 'fastify';
import type Redis from 'ioredis';
import type {
  TokenPayload,
  TokenCacheEntry,
  RevokedTokenEntry,
} from '../interfaces/index.js';

/**
 * Configuration for TokenCacheService
 */
export interface TokenCacheConfig {
  /**
   * Key prefix for all cache entries
   * @default 'auth'
   */
  keyPrefix?: string;

  /**
   * Default TTL for cached tokens (seconds)
   * @default 300 (5 minutes)
   */
  defaultTtl?: number;

  /**
   * TTL for revoked token entries (seconds)
   * Should be at least as long as max token lifetime
   * @default 604800 (7 days)
   */
  revokedTokenTtl?: number;

  /**
   * Whether to cache validated tokens
   * @default true
   */
  enabled?: boolean;
}

/**
 * Key prefixes for cache entries
 */
const CACHE_KEYS = {
  TOKEN: 'tokens',
  REVOKED: 'revoked',
  USER_TOKENS: 'user',
} as const;

/**
 * Token Cache Service
 *
 * Provides Redis-backed caching for JWT authentication.
 */
export class TokenCacheService {
  private readonly redis: Redis;
  private readonly logger: FastifyBaseLogger;
  private readonly config: Required<TokenCacheConfig>;

  constructor(
    redis: Redis,
    logger: FastifyBaseLogger,
    config: TokenCacheConfig = {}
  ) {
    this.redis = redis;
    this.logger = logger.child({ component: 'TokenCacheService' });
    this.config = {
      keyPrefix: config.keyPrefix ?? 'auth',
      defaultTtl: config.defaultTtl ?? 300,
      revokedTokenTtl: config.revokedTokenTtl ?? 604800,
      enabled: config.enabled ?? true,
    };
  }

  /**
   * Generate cache key for a token
   *
   * Uses SHA-256 hash of the token for security (don't store raw tokens)
   */
  private getTokenKey(token: string): string {
    const hash = createHash('sha256').update(token).digest('hex').slice(0, 16);
    return `${this.config.keyPrefix}:${CACHE_KEYS.TOKEN}:${hash}`;
  }

  /**
   * Generate cache key for a revoked token
   */
  private getRevokedKey(tokenId: string): string {
    return `${this.config.keyPrefix}:${CACHE_KEYS.REVOKED}:${tokenId}`;
  }

  /**
   * Generate cache key for user's token list
   */
  private getUserTokensKey(userId: string): string {
    return `${this.config.keyPrefix}:${CACHE_KEYS.USER_TOKENS}:${userId}:tokens`;
  }

  /**
   * Cache a validated token payload
   *
   * @param token - Raw JWT token (will be hashed)
   * @param payload - Decoded token payload
   * @param ttlSeconds - Time to live (defaults to token expiry or config)
   */
  async cacheToken(
    token: string,
    payload: TokenPayload,
    ttlSeconds?: number
  ): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      const key = this.getTokenKey(token);
      const now = Date.now();

      // Calculate TTL: use provided, or derive from token expiry, or use default
      let ttl = ttlSeconds;
      if (!ttl && payload.exp) {
        // Token exp is in seconds, calculate remaining time
        ttl = Math.max(0, payload.exp - Math.floor(now / 1000));
      }
      ttl = ttl ?? this.config.defaultTtl;

      // Don't cache if TTL is too short
      if (ttl <= 0) {
        this.logger.debug({ tokenId: payload.jti }, 'Token already expired, not caching');
        return;
      }

      const entry: TokenCacheEntry = {
        payload: payload as unknown as Record<string, unknown>,
        cachedAt: now,
        expiresAt: payload.exp ? payload.exp * 1000 : now + ttl * 1000,
      };

      await this.redis.setex(key, ttl, JSON.stringify(entry));

      // Track user's active tokens for mass revocation
      if (payload.sub) {
        const userKey = this.getUserTokensKey(payload.sub);
        await this.redis.sadd(userKey, payload.jti || key);
        // Ensure user token set also expires
        await this.redis.expire(userKey, this.config.revokedTokenTtl);
      }

      this.logger.debug(
        { tokenId: payload.jti, ttl },
        'Token cached successfully'
      );
    } catch (error) {
      // Cache failures should not break authentication
      this.logger.warn(
        { error, tokenId: payload.jti },
        'Failed to cache token'
      );
    }
  }

  /**
   * Get a cached token payload
   *
   * @param token - Raw JWT token
   * @returns Cached entry or null if not found/expired
   */
  async getCachedToken(token: string): Promise<TokenCacheEntry | null> {
    if (!this.config.enabled) {
      return null;
    }

    try {
      const key = this.getTokenKey(token);
      const cached = await this.redis.get(key);

      if (!cached) {
        return null;
      }

      const entry: TokenCacheEntry = JSON.parse(cached);

      // Double-check expiration
      if (entry.expiresAt && entry.expiresAt < Date.now()) {
        await this.redis.del(key);
        return null;
      }

      this.logger.debug('Token cache hit');
      return entry;
    } catch (error) {
      this.logger.warn({ error }, 'Failed to get cached token');
      return null;
    }
  }

  /**
   * Invalidate a cached token
   *
   * @param token - Raw JWT token
   */
  async invalidateToken(token: string): Promise<void> {
    try {
      const key = this.getTokenKey(token);
      await this.redis.del(key);
      this.logger.debug('Token cache invalidated');
    } catch (error) {
      this.logger.warn({ error }, 'Failed to invalidate cached token');
    }
  }

  /**
   * Check if a token ID has been revoked
   *
   * @param tokenId - Token's jti claim
   */
  async isRevoked(tokenId: string): Promise<boolean> {
    try {
      const key = this.getRevokedKey(tokenId);
      const exists = await this.redis.exists(key);
      return exists === 1;
    } catch (error) {
      this.logger.warn({ error, tokenId }, 'Failed to check revocation status');
      // Fail open for availability (could be configured to fail closed)
      return false;
    }
  }

  /**
   * Revoke a token by ID
   *
   * @param tokenId - Token's jti claim
   * @param userId - Optional user ID for tracking
   * @param reason - Optional revocation reason
   */
  async revokeToken(
    tokenId: string,
    userId?: string,
    reason?: string
  ): Promise<void> {
    try {
      const key = this.getRevokedKey(tokenId);

      const entry: RevokedTokenEntry = {
        tokenId,
        revokedAt: Date.now(),
        reason,
        userId,
      };

      await this.redis.setex(
        key,
        this.config.revokedTokenTtl,
        JSON.stringify(entry)
      );

      this.logger.info({ tokenId, userId, reason }, 'Token revoked');
    } catch (error) {
      this.logger.error({ error, tokenId }, 'Failed to revoke token');
      throw error;
    }
  }

  /**
   * Revoke all tokens for a user
   *
   * Used for logout-all-devices or security incidents.
   *
   * @param userId - User ID to revoke tokens for
   * @param reason - Optional revocation reason
   * @returns Number of tokens revoked
   */
  async revokeAllUserTokens(userId: string, reason?: string): Promise<number> {
    try {
      const userKey = this.getUserTokensKey(userId);
      const tokenIds = await this.redis.smembers(userKey);

      if (tokenIds.length === 0) {
        return 0;
      }

      // Revoke each token
      const pipeline = this.redis.pipeline();
      for (const tokenId of tokenIds) {
        const entry: RevokedTokenEntry = {
          tokenId,
          revokedAt: Date.now(),
          reason: reason ?? 'User mass revocation',
          userId,
        };
        pipeline.setex(
          this.getRevokedKey(tokenId),
          this.config.revokedTokenTtl,
          JSON.stringify(entry)
        );
      }

      // Clear the user's token set
      pipeline.del(userKey);

      await pipeline.exec();

      this.logger.info(
        { userId, tokenCount: tokenIds.length, reason },
        'All user tokens revoked'
      );

      return tokenIds.length;
    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to revoke all user tokens');
      throw error;
    }
  }

  /**
   * Get cache statistics
   *
   * Useful for monitoring and debugging.
   */
  async getStats(): Promise<{
    enabled: boolean;
    keyPrefix: string;
    tokenCount: number;
    revokedCount: number;
  }> {
    const tokenPattern = `${this.config.keyPrefix}:${CACHE_KEYS.TOKEN}:*`;
    const revokedPattern = `${this.config.keyPrefix}:${CACHE_KEYS.REVOKED}:*`;

    const [tokenKeys, revokedKeys] = await Promise.all([
      this.redis.keys(tokenPattern),
      this.redis.keys(revokedPattern),
    ]);

    return {
      enabled: this.config.enabled,
      keyPrefix: this.config.keyPrefix,
      tokenCount: tokenKeys.length,
      revokedCount: revokedKeys.length,
    };
  }
}
