/**
 * Auth Routes
 *
 * Authentication endpoints for user registration, login, and token refresh.
 *
 * Endpoints:
 * - POST /auth/register - Create new user account
 * - POST /auth/login - Authenticate and get tokens
 * - POST /auth/refresh - Refresh access token
 * - POST /auth/logout - Revoke refresh token
 * - GET /auth/me - Get current user info (protected)
 */

import type { FastifyPluginCallback } from 'fastify';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { randomUUID } from 'crypto';
import { UserRepository } from '../users/repositories/user.repository.js';
import { RefreshTokenRepository } from '../users/repositories/refresh-token.repository.js';
import { passwordService } from '../users/services/password.service.js';
import { toPublicUser } from '../users/entities/user.entity.js';

/**
 * Route options
 */
interface AuthRoutesOptions {
  pool: Pool;
  redis: Redis | null;
  jwtProvider: {
    generateAccessToken: (payload: Record<string, unknown>) => Promise<string>;
    generateRefreshToken: (payload: { sub: string }) => Promise<string>;
    verifyRefreshToken: (
      token: string,
    ) => Promise<{ success: boolean; payload?: { sub: string; jti?: string }; error?: Error }>;
  };
  config: {
    accessTokenExpiry: string;
    refreshTokenExpiry: string;
  };
}

/**
 * Request body types
 */
interface RegisterBody {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  role?: 'admin' | 'merchant' | 'consumer';
}

interface LoginBody {
  email: string;
  password: string;
}

interface RefreshBody {
  refreshToken: string;
}

/**
 * Parse duration string to milliseconds
 */
function parseExpiryToMs(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) return 900000; // Default 15m

  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;

  switch (unit) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      return 900000;
  }
}

/**
 * Auth Routes Plugin
 */
export const authRoutes: FastifyPluginCallback<AuthRoutesOptions> = (fastify, options, done) => {
  const { pool, redis, jwtProvider, config } = options;
  const userRepo = new UserRepository(pool, fastify.log);
  const tokenRepo = new RefreshTokenRepository(pool, redis, fastify.log);

  const refreshTokenTtlMs = parseExpiryToMs(config.refreshTokenExpiry);

  /**
   * POST /register
   *
   * Create a new user account.
   * Currently unauthenticated for initial setup.
   */
  fastify.post<{ Body: RegisterBody }>(
    '/register',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 8, maxLength: 128 },
            firstName: { type: 'string', maxLength: 100 },
            lastName: { type: 'string', maxLength: 100 },
            role: { type: 'string', enum: ['admin', 'merchant', 'consumer'] },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              user: { type: 'object' },
              accessToken: { type: 'string' },
              refreshToken: { type: 'string' },
              expiresIn: { type: 'number' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password, firstName, lastName, role } = request.body;

      // Validate password
      const validation = passwordService.validate(password);
      if (!validation.valid) {
        return reply.code(400).send({
          success: false,
          code: 'INVALID_PASSWORD',
          message: 'Password does not meet requirements',
          errors: validation.errors,
        });
      }

      // Check if email is available
      const emailAvailable = await userRepo.isEmailAvailable(email);
      if (!emailAvailable) {
        return reply.code(409).send({
          success: false,
          code: 'EMAIL_EXISTS',
          message: 'An account with this email already exists',
        });
      }

      // Create user with role
      const user = await userRepo.create({
        email,
        password,
        firstName,
        lastName,
        role: role || 'consumer',
      });

      // Generate tokens
      const tokenId = randomUUID();
      const accessToken = await jwtProvider.generateAccessToken({
        sub: user.id,
        role: user.role,
        permissions: [],
      });

      const refreshToken = await jwtProvider.generateRefreshToken({ sub: user.id });

      // Store refresh token
      await tokenRepo.create({
        tokenId,
        userId: user.id,
        expiresAt: new Date(Date.now() + refreshTokenTtlMs),
      });

      fastify.log.info({ userId: user.id, email }, 'User registered');

      return reply.code(201).send({
        success: true,
        user: toPublicUser(user),
        accessToken,
        refreshToken,
        expiresIn: 900, // 15 minutes
      });
    },
  );

  /**
   * POST /login
   *
   * Authenticate user and return tokens.
   */
  fastify.post<{ Body: LoginBody }>(
    '/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              accessToken: { type: 'string' },
              refreshToken: { type: 'string' },
              expiresIn: { type: 'number' },
              user: { type: 'object' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;

      // Find user
      const user = await userRepo.findByEmail(email);
      if (!user) {
        // Use same message to prevent email enumeration
        return reply.code(401).send({
          success: false,
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        });
      }

      // Check if account is locked
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        const remainingMs = user.lockedUntil.getTime() - Date.now();
        const remainingMins = Math.ceil(remainingMs / 60000);
        return reply.code(423).send({
          success: false,
          code: 'ACCOUNT_LOCKED',
          message: `Account is locked. Try again in ${remainingMins} minutes`,
          retryAfter: Math.ceil(remainingMs / 1000),
        });
      }

      // Check if account is active
      if (user.status !== 'active') {
        return reply.code(403).send({
          success: false,
          code: 'ACCOUNT_INACTIVE',
          message: 'Account is not active',
        });
      }

      // Verify password
      const isValidPassword = await passwordService.verify(password, user.passwordHash);
      if (!isValidPassword) {
        await userRepo.updateLoginFailure(user.id);
        return reply.code(401).send({
          success: false,
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        });
      }

      // Update login success
      const clientIp = request.ip;
      await userRepo.updateLoginSuccess(user.id, clientIp);

      // Generate tokens
      const refreshTokenId = randomUUID();

      const [accessToken, refreshToken] = await Promise.all([
        jwtProvider.generateAccessToken({
          sub: user.id,
          role: user.role,
          permissions: user.permissions,
          email: user.email,
          ...(user.tenantId && { tenantId: user.tenantId }),
          ...(user.merchantId && { merchantId: user.merchantId }),
        }),
        jwtProvider.generateRefreshToken({ sub: user.id }),
      ]);

      // Store refresh token in database
      await tokenRepo.create({
        tokenId: refreshTokenId,
        userId: user.id,
        expiresAt: new Date(Date.now() + refreshTokenTtlMs),
        userAgent: request.headers['user-agent'],
        ipAddress: clientIp,
      });

      fastify.log.info({ userId: user.id, email }, 'User logged in');

      return reply.send({
        success: true,
        accessToken,
        refreshToken,
        expiresIn: parseExpiryToMs(config.accessTokenExpiry) / 1000,
        tokenType: 'Bearer',
        user: toPublicUser(user),
      });
    },
  );

  /**
   * POST /refresh
   *
   * Refresh access token using refresh token.
   */
  fastify.post<{ Body: RefreshBody }>(
    '/refresh',
    {
      schema: {
        body: {
          type: 'object',
          required: ['refreshToken'],
          properties: {
            refreshToken: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              accessToken: { type: 'string' },
              refreshToken: { type: 'string' },
              expiresIn: { type: 'number' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { refreshToken } = request.body;

      // Verify refresh token signature
      const result = await jwtProvider.verifyRefreshToken(refreshToken);
      if (!result.success || !result.payload) {
        return reply.code(401).send({
          success: false,
          code: 'INVALID_TOKEN',
          message: 'Invalid or expired refresh token',
        });
      }

      const { sub: userId, jti: tokenId } = result.payload;

      // Check if token exists in database and is not revoked
      if (tokenId) {
        const storedToken = await tokenRepo.findByTokenId(tokenId);
        if (!storedToken) {
          return reply.code(401).send({
            success: false,
            code: 'TOKEN_REVOKED',
            message: 'Refresh token has been revoked',
          });
        }
      }

      // Get user
      const user = await userRepo.findById(userId);
      if (!user || user.status !== 'active') {
        return reply.code(401).send({
          success: false,
          code: 'USER_NOT_FOUND',
          message: 'User not found or inactive',
        });
      }

      // Revoke old refresh token (token rotation)
      if (tokenId) {
        await tokenRepo.revoke(tokenId, 'Token rotation');
      }

      // Generate new tokens
      const newRefreshTokenId = randomUUID();

      const [newAccessToken, newRefreshToken] = await Promise.all([
        jwtProvider.generateAccessToken({
          sub: user.id,
          role: user.role,
          permissions: user.permissions,
          email: user.email,
          ...(user.tenantId && { tenantId: user.tenantId }),
          ...(user.merchantId && { merchantId: user.merchantId }),
        }),
        jwtProvider.generateRefreshToken({ sub: user.id }),
      ]);

      // Store new refresh token
      await tokenRepo.create({
        tokenId: newRefreshTokenId,
        userId: user.id,
        expiresAt: new Date(Date.now() + refreshTokenTtlMs),
        userAgent: request.headers['user-agent'],
        ipAddress: request.ip,
      });

      fastify.log.info({ userId: user.id }, 'Token refreshed');

      return reply.send({
        success: true,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: parseExpiryToMs(config.accessTokenExpiry) / 1000,
        tokenType: 'Bearer',
      });
    },
  );

  /**
   * POST /logout
   *
   * Revoke refresh token.
   */
  fastify.post<{ Body: RefreshBody }>(
    '/logout',
    {
      schema: {
        body: {
          type: 'object',
          required: ['refreshToken'],
          properties: {
            refreshToken: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { refreshToken } = request.body;

      // Verify token to get tokenId
      const result = await jwtProvider.verifyRefreshToken(refreshToken);
      if (result.success && result.payload?.jti) {
        await tokenRepo.revoke(result.payload.jti, 'User logout');
      }

      return reply.send({
        success: true,
        message: 'Logged out successfully',
      });
    },
  );

  /**
   * GET /me
   *
   * Get current authenticated user info.
   */
  fastify.get(
    '/me',
    {
      config: { auth: true },
    },
    async (request, reply) => {
      const userId = request.user?.sub;
      if (!userId) {
        return reply.code(401).send({
          success: false,
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        });
      }

      const user = await userRepo.findById(userId);
      if (!user) {
        return reply.code(404).send({
          success: false,
          code: 'USER_NOT_FOUND',
          message: 'User not found',
        });
      }

      return reply.send({
        success: true,
        user: toPublicUser(user),
      });
    },
  );

  /**
   * POST /logout-all
   *
   * Revoke all refresh tokens for current user.
   */
  fastify.post(
    '/logout-all',
    {
      config: { auth: true },
    },
    async (request, reply) => {
      const userId = request.user?.sub;
      if (!userId) {
        return reply.code(401).send({
          success: false,
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        });
      }

      const count = await tokenRepo.revokeAllForUser(userId, 'Logout all devices');

      return reply.send({
        success: true,
        message: `Logged out from ${count} device(s)`,
      });
    },
  );

  done();
};

export default authRoutes;
