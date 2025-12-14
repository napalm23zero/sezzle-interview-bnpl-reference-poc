/**
 * Standardized Error Response System
 *
 * Follows RFC 7807 (Problem Details for HTTP APIs) with enhancements
 * for better developer experience and debugging.
 */

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: string;
    timestamp: string;
    path: string;
    method: string;
    correlationId?: string;
    retryAfter?: number;
    docs?: string;
  };
}

export interface ApiSuccess<T = unknown> {
  success: true;
  data: T;
  meta?: {
    timestamp: string;
    correlationId?: string;
  };
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError;

/**
 * Error codes following a consistent naming pattern:
 * CATEGORY_SPECIFIC_ERROR
 */
export const ErrorCodes = {
  // Rate Limiting
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  RATE_LIMIT_BANNED: 'RATE_LIMIT_BANNED',

  // Authentication
  AUTH_MISSING_TOKEN: 'AUTH_MISSING_TOKEN',
  AUTH_INVALID_TOKEN: 'AUTH_INVALID_TOKEN',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_INSUFFICIENT_PERMISSIONS: 'AUTH_INSUFFICIENT_PERMISSIONS',

  // Validation
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  VALIDATION_MISSING_FIELD: 'VALIDATION_MISSING_FIELD',
  VALIDATION_INVALID_FORMAT: 'VALIDATION_INVALID_FORMAT',

  // Resources
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RESOURCE_ALREADY_EXISTS: 'RESOURCE_ALREADY_EXISTS',
  RESOURCE_CONFLICT: 'RESOURCE_CONFLICT',

  // Server
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  TIMEOUT: 'TIMEOUT',

  // Request
  BAD_REQUEST: 'BAD_REQUEST',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Human-readable error messages
 */
export const ErrorMessages: Record<ErrorCode, string> = {
  // Rate Limiting
  RATE_LIMIT_EXCEEDED: 'Too many requests. Please slow down and try again.',
  RATE_LIMIT_BANNED: 'Your IP has been temporarily banned due to excessive requests.',

  // Authentication
  AUTH_MISSING_TOKEN: 'Authentication required. Please provide a valid API key.',
  AUTH_INVALID_TOKEN: 'Invalid authentication credentials.',
  AUTH_TOKEN_EXPIRED: 'Your session has expired. Please authenticate again.',
  AUTH_INSUFFICIENT_PERMISSIONS: 'You do not have permission to perform this action.',

  // Validation
  VALIDATION_FAILED: 'The request contains invalid data.',
  VALIDATION_MISSING_FIELD: 'A required field is missing from the request.',
  VALIDATION_INVALID_FORMAT: 'The data format is invalid.',

  // Resources
  RESOURCE_NOT_FOUND: 'The requested resource was not found.',
  RESOURCE_ALREADY_EXISTS: 'A resource with this identifier already exists.',
  RESOURCE_CONFLICT: 'The request conflicts with the current state of the resource.',

  // Server
  INTERNAL_ERROR: 'An unexpected error occurred. Our team has been notified.',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable. Please try again later.',
  UPSTREAM_ERROR: 'An upstream service failed to respond.',
  TIMEOUT: 'The request timed out. Please try again.',

  // Request
  BAD_REQUEST: 'The request could not be understood.',
  METHOD_NOT_ALLOWED: 'This HTTP method is not allowed for this endpoint.',
  UNSUPPORTED_MEDIA_TYPE: 'The content type is not supported.',
};

/**
 * HTTP status codes for each error
 */
export const ErrorStatusCodes: Record<ErrorCode, number> = {
  RATE_LIMIT_EXCEEDED: 429,
  RATE_LIMIT_BANNED: 403,
  AUTH_MISSING_TOKEN: 401,
  AUTH_INVALID_TOKEN: 401,
  AUTH_TOKEN_EXPIRED: 401,
  AUTH_INSUFFICIENT_PERMISSIONS: 403,
  VALIDATION_FAILED: 400,
  VALIDATION_MISSING_FIELD: 400,
  VALIDATION_INVALID_FORMAT: 400,
  RESOURCE_NOT_FOUND: 404,
  RESOURCE_ALREADY_EXISTS: 409,
  RESOURCE_CONFLICT: 409,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  UPSTREAM_ERROR: 502,
  TIMEOUT: 504,
  BAD_REQUEST: 400,
  METHOD_NOT_ALLOWED: 405,
  UNSUPPORTED_MEDIA_TYPE: 415,
};

/**
 * Build a standardized error response
 */
export function buildErrorResponse(options: {
  code: ErrorCode;
  path: string;
  method: string;
  correlationId?: string;
  details?: string;
  retryAfter?: number;
}): ApiError {
  const { code, path, method, correlationId, details, retryAfter } = options;

  return {
    success: false,
    error: {
      code,
      message: ErrorMessages[code],
      details,
      timestamp: new Date().toISOString(),
      path,
      method,
      correlationId,
      retryAfter,
      docs: 'https://docs.pulsepay.io/errors/' + code.toLowerCase().replace(/_/g, '-'),
    },
  };
}

/**
 * Build a standardized success response
 */
export function buildSuccessResponse<T>(data: T, correlationId?: string): ApiSuccess<T> {
  return {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      correlationId,
    },
  };
}

/**
 * Custom error class for API errors
 */
export class ApiException extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: string;
  public readonly retryAfter?: number;

  constructor(code: ErrorCode, details?: string, retryAfter?: number) {
    super(ErrorMessages[code]);
    this.name = 'ApiException';
    this.code = code;
    this.statusCode = ErrorStatusCodes[code];
    this.details = details;
    this.retryAfter = retryAfter;
  }
}
