/**
 * JWT Provider
 *
 * Implements IAuthProvider using JSON Web Tokens (JWT).
 *
 * @remarks
 * - Uses jose library for JWT operations (secure, modern implementation)
 * - Supports RS256 (RSA) and HS256 (HMAC) algorithms
 * - Fully compliant with JWT RFC 7519
 * - Follows SRP: only handles JWT creation/verification
 *
 * Security Features:
 * - Automatic JTI (token ID) generation
 * - Configurable issuer/audience validation
 * - Clock tolerance for clock skew
 * - Algorithm enforcement to prevent "none" attacks
 *
 * @example
 * ```typescript
 * const provider = new JWTProvider({
 *   secret: 'your-secret-key',
 *   issuer: 'pulse-api',
 *   audience: 'pulse-services',
 * }, logger);
 *
 * const token = await provider.generateAccessToken({
 *   sub: 'user-123',
 *   role: 'user',
 *   permissions: ['read:own'],
 * });
 * ```
 */

import { randomUUID } from 'crypto';
import type { FastifyBaseLogger } from 'fastify';
import * as jose from 'jose';
import type {
  IAuthProvider,
  TokenPayload,
  RefreshTokenPayload,
  TokenGenerationOptions,
  TokenVerificationOptions,
  TokenVerificationResult,
  UserRole,
} from '../interfaces/index.js';
import {
  TokenExpiredError,
  TokenMalformedError,
  SignatureInvalidError,
  TokenInvalidError,
  IssuerInvalidError,
  AudienceInvalidError,
} from '../errors/index.js';

/**
 * JWT Provider configuration
 */
export interface JWTProviderConfig {
  /**
   * Secret key for HS256 or private key for RS256
   */
  secret: string;

  /**
   * Public key for RS256 (optional, derived from secret if not provided)
   */
  publicKey?: string;

  /**
   * Token issuer (iss claim)
   * @default 'pulse-api-gateway'
   */
  issuer?: string;

  /**
   * Token audience (aud claim)
   * @default 'pulse-services'
   */
  audience?: string;

  /**
   * Algorithm for signing
   * @default 'HS256'
   */
  algorithm?: 'HS256' | 'RS256';

  /**
   * Access token expiration time
   * @default '15m'
   */
  accessTokenExpiry?: string;

  /**
   * Refresh token expiration time
   * @default '7d'
   */
  refreshTokenExpiry?: string;

  /**
   * Clock tolerance for verification (seconds)
   * @default 60
   */
  clockTolerance?: number;
}

/**
 * Parse duration string to seconds
 *
 * Supports: 15m, 1h, 7d, 30d, 1y
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([smhdy])$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`);
  }

  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;

  switch (unit) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 3600;
    case 'd':
      return value * 86400;
    case 'y':
      return value * 31536000;
    default:
      throw new Error(`Unknown duration unit: ${unit}`);
  }
}

/**
 * JWT Authentication Provider
 *
 * Implements the IAuthProvider interface using JWT tokens.
 */
export class JWTProvider implements IAuthProvider {
  readonly name = 'jwt';

  private readonly config: Required<Omit<JWTProviderConfig, 'publicKey'>> & {
    publicKey?: string;
  };
  private readonly logger: FastifyBaseLogger;
  private readonly secretKey: Uint8Array;

  constructor(config: JWTProviderConfig, logger: FastifyBaseLogger) {
    this.logger = logger.child({ component: 'JWTProvider' });

    // Apply defaults
    this.config = {
      secret: config.secret,
      publicKey: config.publicKey,
      issuer: config.issuer ?? 'pulse-api-gateway',
      audience: config.audience ?? 'pulse-services',
      algorithm: config.algorithm ?? 'HS256',
      accessTokenExpiry: config.accessTokenExpiry ?? '15m',
      refreshTokenExpiry: config.refreshTokenExpiry ?? '7d',
      clockTolerance: config.clockTolerance ?? 60,
    };

    // Encode secret as Uint8Array for jose
    this.secretKey = new TextEncoder().encode(this.config.secret);

    this.logger.debug(
      {
        algorithm: this.config.algorithm,
        issuer: this.config.issuer,
        accessTokenExpiry: this.config.accessTokenExpiry,
      },
      'JWT Provider initialized'
    );
  }

  /**
   * Generate an access token
   */
  async generateAccessToken(
    payload: Omit<TokenPayload, 'iat' | 'exp' | 'jti' | 'iss' | 'aud' | 'type'>,
    options?: TokenGenerationOptions
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const expiry = options?.expiresIn
      ? parseDuration(options.expiresIn)
      : parseDuration(this.config.accessTokenExpiry);

    const fullPayload: TokenPayload = {
      ...payload,
      type: 'access',
      iss: this.config.issuer,
      aud: options?.audience ?? this.config.audience,
      iat: now,
      exp: now + expiry,
      jti: options?.jti ?? randomUUID(),
    };

    try {
      const token = await new jose.SignJWT(
        fullPayload as unknown as jose.JWTPayload
      )
        .setProtectedHeader({ alg: this.config.algorithm })
        .sign(this.secretKey);

      this.logger.debug(
        { sub: payload.sub, jti: fullPayload.jti, expiresIn: expiry },
        'Access token generated'
      );

      return token;
    } catch (error) {
      this.logger.error({ error }, 'Failed to generate access token');
      throw error;
    }
  }

  /**
   * Generate a refresh token
   */
  async generateRefreshToken(
    payload: Pick<TokenPayload, 'sub'>,
    options?: TokenGenerationOptions
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const expiry = options?.expiresIn
      ? parseDuration(options.expiresIn)
      : parseDuration(this.config.refreshTokenExpiry);

    const fullPayload: RefreshTokenPayload = {
      sub: payload.sub,
      type: 'refresh',
      iss: this.config.issuer,
      aud: this.config.audience,
      iat: now,
      exp: now + expiry,
      jti: options?.jti ?? randomUUID(),
    };

    try {
      const token = await new jose.SignJWT(
        fullPayload as unknown as jose.JWTPayload
      )
        .setProtectedHeader({ alg: this.config.algorithm })
        .sign(this.secretKey);

      this.logger.debug(
        { sub: payload.sub, jti: fullPayload.jti, expiresIn: expiry },
        'Refresh token generated'
      );

      return token;
    } catch (error) {
      this.logger.error({ error }, 'Failed to generate refresh token');
      throw error;
    }
  }

  /**
   * Verify an access token
   */
  async verifyAccessToken(
    token: string,
    options?: TokenVerificationOptions
  ): Promise<TokenVerificationResult<TokenPayload>> {
    return this.verifyToken<TokenPayload>(token, 'access', options);
  }

  /**
   * Verify a refresh token
   */
  async verifyRefreshToken(
    token: string,
    options?: TokenVerificationOptions
  ): Promise<TokenVerificationResult<RefreshTokenPayload>> {
    return this.verifyToken<RefreshTokenPayload>(token, 'refresh', options);
  }

  /**
   * Internal token verification with type checking
   */
  private async verifyToken<T extends TokenPayload>(
    token: string,
    expectedType: 'access' | 'refresh',
    options?: TokenVerificationOptions
  ): Promise<TokenVerificationResult<T>> {
    try {
      const verifyOptions: jose.JWTVerifyOptions = {
        algorithms: [this.config.algorithm],
        clockTolerance: this.config.clockTolerance,
      };

      // Validate issuer if not skipped
      if (!options?.ignoreIssuer) {
        verifyOptions.issuer = options?.issuer ?? this.config.issuer;
      }

      // Validate audience if not skipped
      if (!options?.ignoreAudience) {
        verifyOptions.audience = options?.audience ?? this.config.audience;
      }

      const { payload } = await jose.jwtVerify(
        token,
        this.secretKey,
        verifyOptions
      );

      // Cast and validate type
      const typedPayload = payload as unknown as T;

      // Verify token type
      if (typedPayload.type !== expectedType) {
        return {
          success: false,
          error: new TokenInvalidError(
            `Expected ${expectedType} token, got ${typedPayload.type}`
          ),
        };
      }

      this.logger.debug(
        { sub: typedPayload.sub, jti: typedPayload.jti, type: expectedType },
        'Token verified successfully'
      );

      return {
        success: true,
        payload: typedPayload,
      };
    } catch (error) {
      return this.handleVerificationError(error);
    }
  }

  /**
   * Decode a token without verification
   *
   * Useful for extracting claims before full verification.
   * WARNING: Do not trust unverified tokens!
   */
  async decodeToken(token: string): Promise<TokenPayload | null> {
    try {
      const decoded = jose.decodeJwt(token);
      return decoded as unknown as TokenPayload;
    } catch {
      return null;
    }
  }

  /**
   * Handle jose verification errors and convert to our error types
   */
  private handleVerificationError(
    error: unknown
  ): TokenVerificationResult<never> {
    if (error instanceof jose.errors.JWTExpired) {
      return {
        success: false,
        error: new TokenExpiredError('Token has expired', error.payload?.exp as number),
      };
    }

    if (error instanceof jose.errors.JWSSignatureVerificationFailed) {
      return {
        success: false,
        error: new SignatureInvalidError('Token signature verification failed'),
      };
    }

    if (error instanceof jose.errors.JWTClaimValidationFailed) {
      const claim = error.claim;

      if (claim === 'iss') {
        return {
          success: false,
          error: new IssuerInvalidError(`Invalid issuer: ${error.reason}`),
        };
      }

      if (claim === 'aud') {
        return {
          success: false,
          error: new AudienceInvalidError(`Invalid audience: ${error.reason}`),
        };
      }

      return {
        success: false,
        error: new TokenInvalidError(`Token claim validation failed: ${claim}`),
      };
    }

    if (
      error instanceof jose.errors.JOSEError ||
      error instanceof jose.errors.JWTInvalid
    ) {
      return {
        success: false,
        error: new TokenMalformedError(
          'Token format is invalid',
          (error as Error).message
        ),
      };
    }

    // Unknown error
    this.logger.error({ error }, 'Unknown token verification error');
    return {
      success: false,
      error: new TokenInvalidError(
        'Token verification failed',
        (error as Error)?.message
      ),
    };
  }

  /**
   * Get token time-to-live in seconds
   */
  getTokenTTL(token: string): number | null {
    try {
      const decoded = jose.decodeJwt(token);
      if (!decoded.exp) {
        return null;
      }
      const now = Math.floor(Date.now() / 1000);
      return Math.max(0, decoded.exp - now);
    } catch {
      return null;
    }
  }

  /**
   * Extract user ID from token without full verification
   *
   * Useful for logging and routing, but NOT for authorization.
   */
  extractSubject(token: string): string | null {
    try {
      const decoded = jose.decodeJwt(token);
      return (decoded.sub as string) ?? null;
    } catch {
      return null;
    }
  }
}
