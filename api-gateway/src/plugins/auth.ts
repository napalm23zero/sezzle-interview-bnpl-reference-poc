/**
 * Auth Plugin for Fastify
 *
 * Integrates the auth module with Fastify, providing:
 * - Request authentication decorator
 * - Route-level authorization hooks
 * - User context in requests
 *
 * @remarks
 * This plugin is the integration layer between the generic
 * auth module and Fastify-specific concerns.
 *
 * Decorators Added:
 * - `fastify.auth` - AuthService instance
 * - `request.user` - Authenticated user payload
 * - `request.authenticate()` - Manual authentication
 *
 * Route Options:
 * - `config.auth: true` - Require authentication
 * - `config.roles: ['admin']` - Require specific roles
 * - `config.permissions: ['read:users']` - Require specific permissions
 *
 * @example
 * ```typescript
 * // Register plugin
 * await fastify.register(authPlugin, { redis, jwtConfig });
 *
 * // Protected route
 * fastify.get('/api/me', {
 *   config: { auth: true }
 * }, async (request) => {
 *   return { userId: request.user.sub };
 * });
 *
 * // Admin only route
 * fastify.get('/api/admin', {
 *   config: { auth: true, roles: ['admin'] }
 * }, handler);
 * ```
 */

import type { FastifyPluginCallback, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import type { Redis } from 'ioredis';
import {
  AuthService,
  JWTProvider,
  TokenCacheService,
  type JWTProviderConfig,
  type TokenCacheConfig,
  type AuthServiceConfig,
  type TokenPayload,
  type UserRole,
  AuthError,
  PermissionDeniedError,
} from '../auth/index.js';

/**
 * Auth plugin configuration
 */
export interface AuthPluginOptions {
  /**
   * Redis client for token caching
   */
  redis?: Redis;

  /**
   * JWT provider configuration
   */
  jwt: JWTProviderConfig;

  /**
   * Token cache configuration
   */
  cache?: TokenCacheConfig;

  /**
   * Auth service configuration
   */
  service?: AuthServiceConfig;

  /**
   * Skip authentication for these paths (regex patterns)
   * @default [/^\/health/, /^\/metrics/]
   */
  skipPaths?: RegExp[];

  /**
   * Enable authentication globally
   * @default false (opt-in per route)
   */
  enableGlobal?: boolean;
}

/**
 * Route-level auth configuration
 */
export interface RouteAuthConfig {
  /**
   * Require authentication for this route
   */
  auth?: boolean;

  /**
   * Required roles (OR logic - any role matches)
   */
  roles?: UserRole[];

  /**
   * Required permissions (AND logic - all must match)
   */
  permissions?: string[];
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    auth: AuthService;
  }

  interface FastifyRequest {
    user: TokenPayload | null;
    authenticate: () => Promise<TokenPayload>;
  }

  interface FastifyContextConfig {
    auth?: boolean;
    roles?: UserRole[];
    permissions?: string[];
  }
}

/**
 * Default paths to skip authentication
 */
const DEFAULT_SKIP_PATHS = [/^\/health/, /^\/metrics/, /^\/docs/, /^\/swagger/];

/**
 * Auth Plugin Implementation
 */
const authPluginFn: FastifyPluginCallback<AuthPluginOptions> = (fastify, options, done) => {
  const {
    redis,
    jwt,
    cache,
    service,
    skipPaths = DEFAULT_SKIP_PATHS,
    enableGlobal = false,
  } = options;

  // Create JWT provider
  const jwtProvider = new JWTProvider(jwt, fastify.log);

  // Create token cache service (optional)
  const tokenCache = redis ? new TokenCacheService(redis, fastify.log, cache) : null;

  // Create auth service
  const authService = new AuthService(jwtProvider, tokenCache, fastify.log, service);

  // Decorate fastify instance with auth service
  fastify.decorate('auth', authService);

  // Decorate request with user and authenticate method
  fastify.decorateRequest('user', null);
  fastify.decorateRequest('authenticate', null);

  /**
   * Add authenticate method to each request
   */
  fastify.addHook('onRequest', (request, _reply, doneHook) => {
    // Reset user on each request
    request.user = null;

    // Add authenticate method
    request.authenticate = async (): Promise<TokenPayload> => {
      const authHeader = request.headers.authorization ?? undefined;
      const token = authService.extractTokenFromHeader(authHeader) ?? undefined;

      const result = await authService.authenticate(token);

      if (!result.success) {
        throw result.error;
      }

      request.user = result.payload;
      return result.payload;
    };

    doneHook();
  });

  /**
   * Pre-handler hook for route authentication/authorization
   */
  fastify.addHook('preHandler', async (request, reply) => {
    const routeConfig = request.routeOptions.config as RouteAuthConfig;

    // Check if path should skip authentication
    const shouldSkip = skipPaths.some((pattern) => pattern.test(request.url));

    if (shouldSkip) {
      return;
    }

    // Determine if auth is required
    const requireAuth = routeConfig?.auth ?? enableGlobal;

    if (!requireAuth) {
      return;
    }

    // Authenticate request
    try {
      await request.authenticate();
    } catch (error) {
      handleAuthError(error, reply);
      return;
    }

    // Check roles if specified
    if (routeConfig?.roles && routeConfig.roles.length > 0) {
      if (!request.user || !authService.hasRole(request.user, routeConfig.roles)) {
        handleAuthError(
          new PermissionDeniedError(`Required role: ${routeConfig.roles.join(' or ')}`),
          reply,
        );
        return;
      }
    }

    // Check permissions if specified
    if (routeConfig?.permissions && routeConfig.permissions.length > 0) {
      for (const permission of routeConfig.permissions) {
        if (!request.user || !authService.hasPermission(request.user, permission)) {
          handleAuthError(new PermissionDeniedError(`Required permission: ${permission}`), reply);
          return;
        }
      }
    }
  });

  /**
   * Handle auth errors and send appropriate response
   */
  function handleAuthError(error: unknown, reply: FastifyReply): void {
    if (error instanceof AuthError) {
      reply.code(error.statusCode).send(error.toJSON());
    } else {
      reply.code(401).send({
        success: false,
        code: 'TOKEN_INVALID',
        message: 'Authentication failed',
        statusCode: 401,
      });
    }
  }

  fastify.log.info('Auth plugin registered');

  done();
};

/**
 * Auth Plugin (wrapped with fastify-plugin for proper encapsulation)
 *
 * @remarks
 * Using fastify-plugin ensures decorators are available in parent scope.
 */
export const authPlugin = fp(authPluginFn, {
  name: 'auth',
  fastify: '4.x',
  dependencies: [],
});

export default authPlugin;
