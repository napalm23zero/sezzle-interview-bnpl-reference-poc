/**
 * Auth Module
 *
 * Centralized authentication module for the API Gateway.
 *
 * @remarks
 * This module provides a complete, SOLID-compliant authentication
 * solution that can be easily extracted to a microservice later.
 *
 * Architecture:
 * ```
 * auth/
 * ├── interfaces/     # Contracts and types
 * ├── errors/         # Domain-specific errors
 * ├── providers/      # Token providers (JWT, etc.)
 * └── services/       # Business logic (AuthService, TokenCacheService)
 * ```
 *
 * To extract to microservice:
 * 1. Copy this folder to new service
 * 2. Add HTTP endpoints
 * 3. Update API Gateway to call auth service
 *
 * @example
 * ```typescript
 * import {
 *   AuthService,
 *   JWTProvider,
 *   TokenCacheService,
 *   type TokenPayload,
 * } from './auth/index.js';
 *
 * // Create instances
 * const provider = new JWTProvider(config, logger);
 * const cache = new TokenCacheService(redis, logger);
 * const auth = new AuthService(provider, cache, logger);
 *
 * // Use in request
 * const result = await auth.authenticate(token);
 * ```
 */

// Interfaces
export type {
  TokenPayload,
  TokenPayloadBase,
  RefreshTokenPayload,
  ServiceTokenPayload,
  UserRole,
  TokenType,
  AuthResult,
  AuthSuccessResult,
  AuthFailureResult,
  AuthErrorCode,
  TokenPair,
  LoginCredentials,
  LoginResult,
  IAuthProvider,
  IAuthProviderFactory,
  TokenGenerationOptions,
  TokenVerificationOptions,
  TokenVerificationResult,
  TokenVerificationSuccess,
  TokenVerificationFailure,
  ICacheService,
  TokenCacheEntry,
  RevokedTokenEntry,
} from './interfaces/index.js';

// Errors
export {
  AuthError,
  TokenMissingError,
  TokenMalformedError,
  SignatureInvalidError,
  TokenExpiredError,
  TokenRevokedError,
  TokenInvalidError,
  IssuerInvalidError,
  AudienceInvalidError,
  PermissionDeniedError,
  AuthRateLimitedError,
  AuthServiceError,
  isAuthError,
  createAuthError,
} from './errors/index.js';

// Providers
export { JWTProvider, type JWTProviderConfig } from './providers/index.js';

// Services
export {
  AuthService,
  type AuthServiceConfig,
  type UserTokenData,
  TokenCacheService,
  type TokenCacheConfig,
} from './services/index.js';
