/**
 * Auth Interfaces - Public Exports
 *
 * Central export point for all auth-related interfaces.
 * Makes imports cleaner and facilitates future extraction to a shared package.
 *
 * @example
 * ```typescript
 * import type {
 *   IAuthProvider,
 *   TokenPayload,
 *   AuthResult
 * } from '../auth/interfaces/index.js';
 * ```
 */

// Token payload types
export type {
  TokenPayload,
  TokenPayloadBase,
  RefreshTokenPayload,
  ServiceTokenPayload,
  UserRole,
  TokenType,
} from './token-payload.interface.js';

// Auth result types
export type {
  AuthResult,
  AuthSuccessResult,
  AuthFailureResult,
  AuthErrorCode,
  TokenPair,
  LoginCredentials,
  LoginResult,
} from './auth-result.interface.js';

// Provider interface
export type {
  IAuthProvider,
  IAuthProviderFactory,
  TokenGenerationOptions,
  TokenVerificationOptions,
  TokenVerificationResult,
  TokenVerificationSuccess,
  TokenVerificationFailure,
} from './auth-provider.interface.js';

// Cache interface
export type {
  ICacheService,
  TokenCacheEntry,
  RevokedTokenEntry,
} from './cache.interface.js';
