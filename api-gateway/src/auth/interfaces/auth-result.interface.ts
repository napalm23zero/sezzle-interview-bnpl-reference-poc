/**
 * Authentication Result Interface
 *
 * Defines the result of an authentication attempt.
 * Used by AuthService to return authentication outcomes.
 *
 * @remarks
 * - Follows SOLID: Interface Segregation Principle
 * - Clear success/failure distinction
 * - Rich error information for debugging
 */

import type { AuthError } from '../errors/index.js';
import type { TokenPayload, UserRole } from './token-payload.interface.js';

/**
 * Successful authentication result
 */
export interface AuthSuccessResult<T = TokenPayload> {
  success: true;

  /**
   * Decoded token payload
   */
  payload: T;
}

/**
 * Failed authentication result
 */
export interface AuthFailureResult {
  success: false;

  /**
   * Error object with details
   */
  error: AuthError;
}

/**
 * Authentication error codes
 */
export type AuthErrorCode =
  | 'TOKEN_MISSING'
  | 'TOKEN_INVALID'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_REVOKED'
  | 'TOKEN_MALFORMED'
  | 'SIGNATURE_INVALID'
  | 'ISSUER_INVALID'
  | 'AUDIENCE_INVALID'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'SERVICE_ERROR';

/**
 * Union type for authentication result (generic)
 */
export type AuthResult<T = TokenPayload> = AuthSuccessResult<T> | AuthFailureResult;

/**
 * Token pair (access + refresh)
 */
export interface TokenPair {
  /**
   * Short-lived access token
   */
  accessToken: string;

  /**
   * Long-lived refresh token
   */
  refreshToken: string;
}

/**
 * Login credentials
 */
export interface LoginCredentials {
  /**
   * Username or email
   */
  username: string;

  /**
   * Password (plain text, will be hashed)
   */
  password: string;

  /**
   * Optional: request specific permissions
   */
  scope?: string[];
}

/**
 * Login result
 */
export interface LoginResult {
  success: boolean;
  tokens?: TokenPair;
  user?: {
    id: string;
    role: UserRole;
    permissions: string[];
  };
  errorCode?: AuthErrorCode;
  message?: string;
}
