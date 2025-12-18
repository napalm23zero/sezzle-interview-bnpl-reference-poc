/**
 * Cache Service Interface
 *
 * Generic caching abstraction for SOLID compliance.
 * Follows Interface Segregation Principle (ISP).
 *
 * @remarks
 * This interface allows swapping Redis with other cache backends
 * (memory, memcached, etc.) without changing consuming code.
 */

/**
 * Generic cache interface
 *
 * @template T - Type of cached values
 */
export interface ICacheService<T = unknown> {
  /**
   * Get a value from cache
   *
   * @param key - Cache key
   * @returns Cached value or null if not found/expired
   */
  get(key: string): Promise<T | null>;

  /**
   * Set a value in cache
   *
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttlSeconds - Time to live in seconds
   */
  set(key: string, value: T, ttlSeconds: number): Promise<void>;

  /**
   * Delete a value from cache
   *
   * @param key - Cache key
   * @returns True if key existed and was deleted
   */
  delete(key: string): Promise<boolean>;

  /**
   * Check if key exists in cache
   *
   * @param key - Cache key
   */
  exists(key: string): Promise<boolean>;

  /**
   * Delete multiple keys by pattern
   *
   * @param pattern - Key pattern (e.g., "auth:tokens:user:*")
   * @returns Number of keys deleted
   */
  deletePattern(pattern: string): Promise<number>;
}

/**
 * Token cache entry structure
 */
export interface TokenCacheEntry {
  /**
   * The decoded token payload (cached to avoid repeated verification)
   */
  payload: Record<string, unknown>;

  /**
   * When the token was cached
   */
  cachedAt: number;

  /**
   * Token expiration time (Unix ms)
   */
  expiresAt: number;

  /**
   * Whether this token has been explicitly revoked
   */
  revoked?: boolean;
}

/**
 * Revoked token entry
 */
export interface RevokedTokenEntry {
  /**
   * Token ID (jti)
   */
  tokenId: string;

  /**
   * When it was revoked
   */
  revokedAt: number;

  /**
   * Reason for revocation
   */
  reason?: string;

  /**
   * User ID associated with the token
   */
  userId?: string;
}
