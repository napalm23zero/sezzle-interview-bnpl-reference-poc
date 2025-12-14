/**
 * Token Payload Interface
 *
 * Defines the structure of data contained in authentication tokens.
 * This is the "claims" part of a JWT.
 *
 * @remarks
 * - Designed to be provider-agnostic (works with JWT, Paseto, etc.)
 * - Follows SOLID: Interface Segregation Principle
 * - Easy to extend for different use cases
 *
 * @example
 * ```typescript
 * const payload: TokenPayload = {
 *   sub: 'user-123',
 *   role: 'merchant',
 *   permissions: ['orders:read', 'orders:write'],
 *   iat: Date.now(),
 *   exp: Date.now() + 3600000, // 1 hour
 * };
 * ```
 */

/**
 * User roles in the PulsePay system
 */
export type UserRole = 'admin' | 'merchant' | 'consumer' | 'service';

/**
 * Token type identifier
 */
export type TokenType = 'access' | 'refresh';

/**
 * Base token payload (required fields)
 */
export interface TokenPayloadBase {
  /**
   * Subject - the user or service ID
   * @example "user-123" or "merchant-456"
   */
  sub: string;

  /**
   * User role for authorization
   */
  role: UserRole;

  /**
   * Issued at timestamp (Unix seconds)
   */
  iat: number;

  /**
   * Expiration timestamp (Unix seconds)
   */
  exp: number;

  /**
   * Token type (access or refresh)
   */
  type: TokenType;
}

/**
 * Extended token payload with optional fields
 */
export interface TokenPayload extends TokenPayloadBase {
  /**
   * Token ID for revocation/tracking
   */
  jti?: string;

  /**
   * Issuer of the token
   */
  iss?: string;

  /**
   * Audience (intended recipient)
   */
  aud?: string | string[];

  /**
   * Fine-grained permissions
   * @example ['orders:read', 'orders:write', 'ledger:read']
   */
  permissions?: string[];

  /**
   * Merchant ID (for merchant tokens)
   */
  merchantId?: string;

  /**
   * Session ID for multi-device tracking
   */
  sessionId?: string;

  /**
   * Custom metadata
   */
  metadata?: Record<string, unknown>;
}

/**
 * Refresh token payload (longer-lived, fewer claims)
 */
export interface RefreshTokenPayload {
  /**
   * Subject - the user or service ID
   */
  sub: string;

  /**
   * Token ID for revocation
   */
  jti?: string;

  /**
   * Token type identifier
   */
  type: 'refresh';

  /**
   * Issuer of the token
   */
  iss?: string;

  /**
   * Audience (intended recipient)
   */
  aud?: string | string[];

  /**
   * Issued at timestamp (Unix seconds)
   */
  iat: number;

  /**
   * Expiration timestamp (Unix seconds)
   */
  exp: number;

  /**
   * Session ID for multi-device tracking
   */
  sessionId?: string;
}

/**
 * Internal service token (for service-to-service auth)
 */
export interface ServiceTokenPayload extends TokenPayloadBase {
  /**
   * Service name
   */
  serviceName: string;

  /**
   * Allowed target services
   */
  allowedServices?: string[];
}
