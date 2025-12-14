/**
 * Authentication Errors
 *
 * Domain-specific errors for authentication operations.
 * Follows SOLID: Single Responsibility (each error has clear purpose)
 *
 * @remarks
 * - Extends base ApiException for consistency
 * - Rich error codes for programmatic handling
 * - Easy to serialize for API responses
 *
 * @example
 * ```typescript
 * throw new TokenExpiredError('Token expired 5 minutes ago');
 * ```
 */

import type { AuthErrorCode } from '../interfaces/index.js';

/**
 * Base authentication error
 *
 * All auth errors extend this class for consistent handling.
 */
export class AuthError extends Error {
  /**
   * HTTP status code
   */
  readonly statusCode: number;

  /**
   * Machine-readable error code
   */
  readonly errorCode: AuthErrorCode;

  /**
   * Additional details (dev only)
   */
  readonly details?: string;

  /**
   * Retry-After header value (seconds)
   */
  readonly retryAfter?: number;

  constructor(
    message: string,
    errorCode: AuthErrorCode,
    statusCode: number = 401,
    details?: string,
    retryAfter?: number
  ) {
    super(message);
    this.name = 'AuthError';
    this.errorCode = errorCode;
    this.statusCode = statusCode;
    this.details = details;
    this.retryAfter = retryAfter;

    // Maintain proper stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert to JSON for API responses
   */
  toJSON(): Record<string, unknown> {
    return {
      success: false,
      code: this.errorCode,
      message: this.message,
      statusCode: this.statusCode,
      ...(this.details && { details: this.details }),
      ...(this.retryAfter && { retryAfter: this.retryAfter }),
    };
  }
}

/**
 * Token is missing from request
 */
export class TokenMissingError extends AuthError {
  constructor(message: string = 'Authentication token is required') {
    super(message, 'TOKEN_MISSING', 401);
    this.name = 'TokenMissingError';
  }
}

/**
 * Token is malformed (wrong format)
 */
export class TokenMalformedError extends AuthError {
  constructor(message: string = 'Token format is invalid', details?: string) {
    super(message, 'TOKEN_MALFORMED', 401, details);
    this.name = 'TokenMalformedError';
  }
}

/**
 * Token signature is invalid
 */
export class SignatureInvalidError extends AuthError {
  constructor(message: string = 'Token signature verification failed') {
    super(message, 'SIGNATURE_INVALID', 401);
    this.name = 'SignatureInvalidError';
  }
}

/**
 * Token has expired
 */
export class TokenExpiredError extends AuthError {
  /**
   * When the token expired (Unix ms)
   */
  readonly expiredAt: number;

  constructor(message: string = 'Token has expired', expiredAt?: number) {
    super(message, 'TOKEN_EXPIRED', 401);
    this.name = 'TokenExpiredError';
    this.expiredAt = expiredAt || Date.now();
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      expiredAt: this.expiredAt,
    };
  }
}

/**
 * Token has been revoked
 */
export class TokenRevokedError extends AuthError {
  constructor(message: string = 'Token has been revoked') {
    super(message, 'TOKEN_REVOKED', 401);
    this.name = 'TokenRevokedError';
  }
}

/**
 * Token is invalid (generic)
 */
export class TokenInvalidError extends AuthError {
  constructor(message: string = 'Token is invalid', details?: string) {
    super(message, 'TOKEN_INVALID', 401, details);
    this.name = 'TokenInvalidError';
  }
}

/**
 * Token issuer doesn't match expected
 */
export class IssuerInvalidError extends AuthError {
  constructor(
    message: string = 'Token issuer is invalid',
    expectedIssuer?: string
  ) {
    super(message, 'ISSUER_INVALID', 401, expectedIssuer);
    this.name = 'IssuerInvalidError';
  }
}

/**
 * Token audience doesn't match expected
 */
export class AudienceInvalidError extends AuthError {
  constructor(
    message: string = 'Token audience is invalid',
    expectedAudience?: string
  ) {
    super(message, 'AUDIENCE_INVALID', 401, expectedAudience);
    this.name = 'AudienceInvalidError';
  }
}

/**
 * User doesn't have required permissions
 */
export class PermissionDeniedError extends AuthError {
  /**
   * Required permission that was missing
   */
  readonly requiredPermission?: string;

  constructor(
    message: string = 'Permission denied',
    requiredPermission?: string
  ) {
    super(message, 'PERMISSION_DENIED', 403);
    this.name = 'PermissionDeniedError';
    this.requiredPermission = requiredPermission;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      ...(this.requiredPermission && {
        requiredPermission: this.requiredPermission,
      }),
    };
  }
}

/**
 * Auth rate limiting triggered
 */
export class AuthRateLimitedError extends AuthError {
  constructor(
    message: string = 'Too many authentication attempts',
    retryAfter: number = 60
  ) {
    super(message, 'RATE_LIMITED', 429, undefined, retryAfter);
    this.name = 'AuthRateLimitedError';
  }
}

/**
 * Internal auth service error
 */
export class AuthServiceError extends AuthError {
  constructor(message: string = 'Authentication service error', details?: string) {
    super(message, 'SERVICE_ERROR', 503, details);
    this.name = 'AuthServiceError';
  }
}

/**
 * Type guard: check if error is an AuthError
 */
export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}

/**
 * Map error code to appropriate error class
 */
export function createAuthError(
  code: AuthErrorCode,
  message?: string,
  details?: string
): AuthError {
  switch (code) {
    case 'TOKEN_MISSING':
      return new TokenMissingError(message);
    case 'TOKEN_MALFORMED':
      return new TokenMalformedError(message, details);
    case 'SIGNATURE_INVALID':
      return new SignatureInvalidError(message);
    case 'TOKEN_EXPIRED':
      return new TokenExpiredError(message);
    case 'TOKEN_REVOKED':
      return new TokenRevokedError(message);
    case 'TOKEN_INVALID':
      return new TokenInvalidError(message, details);
    case 'ISSUER_INVALID':
      return new IssuerInvalidError(message, details);
    case 'AUDIENCE_INVALID':
      return new AudienceInvalidError(message, details);
    case 'PERMISSION_DENIED':
      return new PermissionDeniedError(message, details);
    case 'RATE_LIMITED':
      return new AuthRateLimitedError(message);
    case 'SERVICE_ERROR':
      return new AuthServiceError(message, details);
    default:
      return new AuthError(message || 'Unknown auth error', code);
  }
}
