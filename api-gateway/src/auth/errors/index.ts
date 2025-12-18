/**
 * Auth Errors Module
 *
 * Public exports for authentication errors.
 */

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
} from './auth.errors.js';
