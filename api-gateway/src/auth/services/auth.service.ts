/**
 * Auth Service
 *
 * Main authentication orchestrator that combines provider and cache.
 *
 * @remarks
 * This is the primary entry point for authentication operations.
 * It follows the Facade pattern, providing a unified interface
 * to the underlying authentication subsystem.
 *
 * Architecture:
 * ```
 * AuthService (Facade)
 *    ├── JWTProvider (token generation/verification)
 *    └── TokenCacheService (performance optimization)
 * ```
 *
 * SOLID Compliance:
 * - SRP: Orchestrates auth workflow, delegates to specialized services
 * - OCP: New providers can be added via IAuthProvider interface
 * - LSP: Any IAuthProvider implementation works
 * - ISP: Clean interfaces for each responsibility
 * - DIP: Depends on abstractions (interfaces), not concretions
 *
 * @example
 * ```typescript
 * const authService = new AuthService(provider, cache, logger);
 *
 * // Authenticate a request
 * const result = await authService.authenticate(token);
 * if (result.success) {
 *   console.log('User:', result.payload.sub);
 * }
 *
 * // Generate tokens for a user
 * const tokens = await authService.login(userId, role, permissions);
 * ```
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  IAuthProvider,
  TokenPayload,
  AuthResult,
  TokenPair,
  TokenVerificationOptions,
  UserRole,
} from '../interfaces/index.js';
import type { TokenCacheService } from './token-cache.service.js';
import {
  TokenMissingError,
  TokenRevokedError,
  AuthError,
} from '../errors/index.js';

/**
 * Auth Service configuration
 */
export interface AuthServiceConfig {
  /**
   * Enable token caching
   * @default true
   */
  enableCache?: boolean;

  /**
   * Check revocation list for every request
   * @default true
   */
  checkRevocation?: boolean;

  /**
   * Cache validated tokens
   * @default true
   */
  cacheValidatedTokens?: boolean;
}

/**
 * User data for token generation
 */
export interface UserTokenData {
  /**
   * User ID (becomes 'sub' claim)
   */
  userId: string;

  /**
   * User's role
   */
  role: UserRole;

  /**
   * User's permissions
   */
  permissions?: string[];

  /**
   * User's email (optional)
   */
  email?: string;

  /**
   * User's tenant ID (for multi-tenancy)
   */
  tenantId?: string;

  /**
   * Additional custom claims
   */
  customClaims?: Record<string, unknown>;
}

/**
 * Main Authentication Service
 *
 * Provides a unified interface for all authentication operations.
 */
export class AuthService {
  private readonly provider: IAuthProvider;
  private readonly cache: TokenCacheService | null;
  private readonly logger: FastifyBaseLogger;
  private readonly config: Required<AuthServiceConfig>;

  constructor(
    provider: IAuthProvider,
    cache: TokenCacheService | null,
    logger: FastifyBaseLogger,
    config: AuthServiceConfig = {}
  ) {
    this.provider = provider;
    this.cache = cache;
    this.logger = logger.child({ component: 'AuthService' });
    this.config = {
      enableCache: config.enableCache ?? true,
      checkRevocation: config.checkRevocation ?? true,
      cacheValidatedTokens: config.cacheValidatedTokens ?? true,
    };

    this.logger.debug(
      {
        cacheEnabled: this.cache !== null && this.config.enableCache,
        checkRevocation: this.config.checkRevocation,
      },
      'Auth Service initialized'
    );
  }

  /**
   * Authenticate a request by verifying the access token
   *
   * Flow:
   * 1. Check cache for pre-validated token
   * 2. If not cached, verify with provider
   * 3. Check revocation list
   * 4. Cache successful result
   * 5. Return auth result
   *
   * @param token - JWT access token
   * @param options - Verification options
   * @returns Authentication result with payload or error
   */
  async authenticate(
    token: string | undefined,
    options?: TokenVerificationOptions
  ): Promise<AuthResult<TokenPayload>> {
    // Check if token exists
    if (!token) {
      return {
        success: false,
        error: new TokenMissingError(),
      };
    }

    // Try to get from cache first
    if (this.cache && this.config.enableCache) {
      const cached = await this.cache.getCachedToken(token);
      if (cached) {
        // Even cached tokens need revocation check
        if (this.config.checkRevocation) {
          const payload = cached.payload as unknown as TokenPayload;
          if (payload.jti && (await this.cache.isRevoked(payload.jti))) {
            return {
              success: false,
              error: new TokenRevokedError(),
            };
          }
        }

        this.logger.debug('Authentication from cache');
        return {
          success: true,
          payload: cached.payload as unknown as TokenPayload,
        };
      }
    }

    // Verify token with provider
    const result = await this.provider.verifyAccessToken(token, options);

    if (!result.success) {
      return {
        success: false,
        error: result.error,
      };
    }

    const payload = result.payload;

    // Check revocation
    if (this.config.checkRevocation && this.cache && payload.jti) {
      const isRevoked = await this.cache.isRevoked(payload.jti);
      if (isRevoked) {
        return {
          success: false,
          error: new TokenRevokedError(),
        };
      }
    }

    // Cache successful verification
    if (this.cache && this.config.cacheValidatedTokens) {
      await this.cache.cacheToken(token, payload);
    }

    return {
      success: true,
      payload,
    };
  }

  /**
   * Generate a new token pair for a user
   *
   * @param userData - User data for token generation
   * @returns Access and refresh token pair
   */
  async generateTokenPair(userData: UserTokenData): Promise<TokenPair> {
    const {
      userId,
      role,
      permissions = [],
      email,
      tenantId,
      customClaims = {},
    } = userData;

    const tokenPayload = {
      sub: userId,
      role,
      permissions,
      ...(email && { email }),
      ...(tenantId && { tenantId }),
      ...customClaims,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.provider.generateAccessToken(tokenPayload),
      this.provider.generateRefreshToken({ sub: userId }),
    ]);

    this.logger.info({ userId, role }, 'Token pair generated');

    return {
      accessToken,
      refreshToken,
    };
  }

  /**
   * Refresh tokens using a valid refresh token
   *
   * @param refreshToken - Current refresh token
   * @param userData - Updated user data (or fetched from database)
   * @returns New token pair
   */
  async refreshTokens(
    refreshToken: string,
    userData: UserTokenData
  ): Promise<AuthResult<TokenPair>> {
    // Verify refresh token
    const result = await this.provider.verifyRefreshToken(refreshToken);

    if (!result.success) {
      return {
        success: false,
        error: result.error,
      };
    }

    const payload = result.payload;

    // Check revocation
    if (this.config.checkRevocation && this.cache && payload.jti) {
      const isRevoked = await this.cache.isRevoked(payload.jti);
      if (isRevoked) {
        return {
          success: false,
          error: new TokenRevokedError('Refresh token has been revoked'),
        };
      }
    }

    // Validate that refresh token belongs to the claimed user
    if (payload.sub !== userData.userId) {
      return {
        success: false,
        error: new AuthError(
          'Token subject mismatch',
          'TOKEN_INVALID',
          401
        ),
      };
    }

    // Revoke old refresh token (rotation)
    if (this.cache && payload.jti) {
      await this.cache.revokeToken(
        payload.jti,
        payload.sub,
        'Token rotation'
      );
    }

    // Generate new pair
    const newTokens = await this.generateTokenPair(userData);

    this.logger.info({ userId: userData.userId }, 'Tokens refreshed');

    return {
      success: true,
      payload: newTokens,
    };
  }

  /**
   * Revoke a specific token
   *
   * @param token - Token to revoke (access or refresh)
   * @param reason - Reason for revocation
   */
  async revokeToken(token: string, reason?: string): Promise<void> {
    // Decode token to get jti and sub
    const decoded = await this.provider.decodeToken(token);

    if (!decoded || !decoded.jti) {
      this.logger.warn('Cannot revoke token without jti');
      return;
    }

    if (this.cache) {
      // Add to revocation list
      await this.cache.revokeToken(decoded.jti, decoded.sub, reason);

      // Invalidate from cache
      await this.cache.invalidateToken(token);
    }

    this.logger.info(
      { tokenId: decoded.jti, userId: decoded.sub, reason },
      'Token revoked'
    );
  }

  /**
   * Revoke all tokens for a user (logout from all devices)
   *
   * @param userId - User ID
   * @param reason - Reason for mass revocation
   * @returns Number of tokens revoked
   */
  async revokeAllUserTokens(userId: string, reason?: string): Promise<number> {
    if (!this.cache) {
      this.logger.warn('Cache not available for mass revocation');
      return 0;
    }

    const count = await this.cache.revokeAllUserTokens(userId, reason);

    this.logger.info({ userId, tokenCount: count, reason }, 'All user tokens revoked');

    return count;
  }

  /**
   * Extract token from Authorization header
   *
   * Supports:
   * - Bearer token: "Bearer eyJhbGci..."
   * - Raw token: "eyJhbGci..."
   *
   * @param authHeader - Authorization header value
   * @returns Extracted token or null
   */
  extractTokenFromHeader(authHeader: string | undefined): string | null {
    if (!authHeader) {
      return null;
    }

    // Check for Bearer prefix
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    // Check if it looks like a JWT (3 parts separated by dots)
    if (authHeader.split('.').length === 3) {
      return authHeader;
    }

    return null;
  }

  /**
   * Check if user has required permission
   *
   * @param payload - Token payload
   * @param requiredPermission - Permission to check
   */
  hasPermission(payload: TokenPayload, requiredPermission: string): boolean {
    // Admin has all permissions
    if (payload.role === 'admin') {
      return true;
    }

    // Check specific permissions
    return payload.permissions?.includes(requiredPermission) ?? false;
  }

  /**
   * Check if user has any of the required roles
   *
   * @param payload - Token payload
   * @param allowedRoles - Roles that are allowed
   */
  hasRole(payload: TokenPayload, allowedRoles: UserRole[]): boolean {
    return allowedRoles.includes(payload.role);
  }

  /**
   * Get underlying provider for advanced operations
   *
   * @internal
   */
  getProvider(): IAuthProvider {
    return this.provider;
  }

  /**
   * Get underlying cache for advanced operations
   *
   * @internal
   */
  getCache(): TokenCacheService | null {
    return this.cache;
  }
}
