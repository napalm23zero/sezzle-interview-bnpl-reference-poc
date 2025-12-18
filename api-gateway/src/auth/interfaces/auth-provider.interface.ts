/**
 * Auth Provider Interface
 *
 * Contract for authentication token providers.
 * Follows SOLID: Dependency Inversion Principle.
 *
 * @remarks
 * - Provider-agnostic: supports JWT, Paseto, opaque tokens, etc.
 * - Easy to swap implementations without changing consumers
 * - Facilitates testing with mock providers
 *
 * @example Extracting to microservice
 * ```typescript
 * // Instead of local provider:
 * const provider = new JWTProvider(config);
 *
 * // Use HTTP provider that calls auth-service:
 * const provider = new HttpAuthProvider('http://auth-service:3010');
 * ```
 */

import type {
  TokenPayload,
  RefreshTokenPayload,
} from './token-payload.interface.js';

/**
 * Token generation options
 */
export interface TokenGenerationOptions {
  /**
   * Custom expiration time (e.g., '15m', '1h', '7d')
   */
  expiresIn?: string;

  /**
   * Custom token ID
   */
  jti?: string;

  /**
   * Custom issuer
   */
  issuer?: string;

  /**
   * Custom audience
   */
  audience?: string | string[];
}

/**
 * Token verification options
 */
export interface TokenVerificationOptions {
  /**
   * Expected audience
   */
  audience?: string | string[];

  /**
   * Expected issuer
   */
  issuer?: string;

  /**
   * Allow expired tokens (for refresh flow)
   */
  ignoreExpiration?: boolean;

  /**
   * Skip issuer validation
   */
  ignoreIssuer?: boolean;

  /**
   * Skip audience validation
   */
  ignoreAudience?: boolean;

  /**
   * Clock tolerance in seconds
   */
  clockTolerance?: number;
}

/**
 * Token verification result
 */
import type { AuthError } from '../errors/auth.errors.js';

export interface TokenVerificationSuccess<T = TokenPayload> {
  success: true;
  payload: T;
}

export interface TokenVerificationFailure {
  success: false;
  error: AuthError;
}

export type TokenVerificationResult<T = TokenPayload> =
  | TokenVerificationSuccess<T>
  | TokenVerificationFailure;

/**
 * Auth Provider Interface
 *
 * @typeParam TPayload - Token payload type (default: TokenPayload)
 *
 * @remarks
 * This interface allows different implementations:
 * - JWTProvider: Local JWT signing/verification
 * - HttpAuthProvider: Calls external auth-service (future microservice)
 * - MockAuthProvider: For testing
 */
export interface IAuthProvider<TPayload = TokenPayload> {
  /**
   * Provider name for logging/debugging
   */
  readonly name: string;

  /**
   * Generate an access token
   *
   * @param payload - Token claims
   * @param options - Generation options
   * @returns Signed token string
   */
  generateAccessToken(
    payload: Omit<TPayload, 'iat' | 'exp' | 'jti' | 'iss' | 'aud' | 'type'>,
    options?: TokenGenerationOptions
  ): Promise<string>;

  /**
   * Generate a refresh token
   *
   * @param payload - Refresh token claims
   * @param options - Generation options
   * @returns Signed refresh token string
   */
  generateRefreshToken(
    payload: Pick<RefreshTokenPayload, 'sub'>,
    options?: TokenGenerationOptions
  ): Promise<string>;

  /**
   * Verify and decode an access token
   *
   * @param token - Token string to verify
   * @param options - Verification options
   * @returns Verification result with payload if valid
   */
  verifyAccessToken(
    token: string,
    options?: TokenVerificationOptions
  ): Promise<TokenVerificationResult<TPayload>>;

  /**
   * Verify and decode a refresh token
   *
   * @param token - Refresh token to verify
   * @param options - Verification options
   * @returns Verification result with payload if valid
   */
  verifyRefreshToken(
    token: string,
    options?: TokenVerificationOptions
  ): Promise<TokenVerificationResult<RefreshTokenPayload>>;

  /**
   * Decode token without verification (for debugging)
   *
   * @param token - Token to decode
   * @returns Decoded payload (unverified!)
   */
  decodeToken(token: string): Promise<TPayload | null>;
}

/**
 * Auth Provider Factory Interface
 *
 * For creating auth providers dynamically
 */
export interface IAuthProviderFactory {
  /**
   * Create an auth provider
   *
   * @param type - Provider type ('jwt', 'http', 'mock')
   * @param config - Provider-specific configuration
   */
  create(type: string, config: Record<string, unknown>): IAuthProvider;
}
