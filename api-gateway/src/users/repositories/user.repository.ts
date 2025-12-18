/**
 * User Repository
 *
 * Data access layer for user accounts.
 * Follows Repository Pattern for clean separation of concerns.
 */

import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import {
  type User,
  type CreateUserInput,
  type UpdateUserInput,
  rowToUser,
} from '../entities/user.entity.js';
import { passwordService } from '../services/password.service.js';

/**
 * User Repository Interface
 */
export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(input: CreateUserInput): Promise<User>;
  update(id: string, input: UpdateUserInput): Promise<User | null>;
  delete(id: string): Promise<boolean>;
  updateLoginSuccess(id: string, ipAddress?: string): Promise<void>;
  updateLoginFailure(id: string): Promise<void>;
  resetFailedAttempts(id: string): Promise<void>;
}

/**
 * PostgreSQL User Repository
 */
export class UserRepository implements IUserRepository {
  private readonly pool: Pool;
  private readonly logger: FastifyBaseLogger;

  constructor(pool: Pool, logger: FastifyBaseLogger) {
    this.pool = pool;
    this.logger = logger.child({ component: 'UserRepository' });
  }

  /**
   * Find user by ID
   */
  async findById(id: string): Promise<User | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT * FROM users WHERE id = $1',
      [id],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return rowToUser(row);
  }

  /**
   * Find user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
      [email],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return rowToUser(row);
  }

  /**
   * Create a new user
   */
  async create(input: CreateUserInput): Promise<User> {
    // Hash password
    const passwordHash = await passwordService.hash(input.password);

    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO users (
        email,
        password_hash,
        first_name,
        last_name,
        role,
        permissions,
        tenant_id,
        merchant_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        input.email.toLowerCase(),
        passwordHash,
        input.firstName || null,
        input.lastName || null,
        input.role || 'consumer',
        input.permissions || [],
        input.tenantId || null,
        input.merchantId || null,
      ],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to create user');
    }

    const user = rowToUser(row);
    this.logger.info({ userId: user.id, email: input.email }, 'User created');

    return user;
  }

  /**
   * Update user
   */
  async update(id: string, input: UpdateUserInput): Promise<User | null> {
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.firstName !== undefined) {
      updates.push(`first_name = $${paramIndex++}`);
      values.push(input.firstName);
    }

    if (input.lastName !== undefined) {
      updates.push(`last_name = $${paramIndex++}`);
      values.push(input.lastName);
    }

    if (input.role !== undefined) {
      updates.push(`role = $${paramIndex++}`);
      values.push(input.role);
    }

    if (input.permissions !== undefined) {
      updates.push(`permissions = $${paramIndex++}`);
      values.push(input.permissions);
    }

    if (input.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(input.status);
    }

    if (input.emailVerified !== undefined) {
      updates.push(`email_verified = $${paramIndex++}`);
      values.push(input.emailVerified);
      if (input.emailVerified) {
        updates.push(`email_verified_at = NOW()`);
      }
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    values.push(id);

    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values,
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return rowToUser(row);
  }

  /**
   * Delete user (soft delete recommended in production)
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query<Record<string, unknown>>(
      'DELETE FROM users WHERE id = $1',
      [id],
    );

    return result.rowCount !== null && result.rowCount > 0;
  }

  /**
   * Update on successful login
   */
  async updateLoginSuccess(id: string, ipAddress?: string): Promise<void> {
    await this.pool.query(
      `UPDATE users SET 
        last_login_at = NOW(),
        last_login_ip = $2,
        failed_login_attempts = 0,
        locked_until = NULL
      WHERE id = $1`,
      [id, ipAddress || null],
    );
  }

  /**
   * Update on failed login attempt
   */
  async updateLoginFailure(id: string): Promise<void> {
    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE users SET 
        failed_login_attempts = failed_login_attempts + 1,
        locked_until = CASE 
          WHEN failed_login_attempts >= 4 THEN NOW() + INTERVAL '15 minutes'
          ELSE locked_until
        END
      WHERE id = $1
      RETURNING failed_login_attempts`,
      [id],
    );

    const row = result.rows[0];
    if (row) {
      const attempts = Number(row.failed_login_attempts);
      if (attempts >= 5) {
        this.logger.warn({ userId: id, attempts }, 'User account locked due to failed attempts');
      }
    }
  }

  /**
   * Reset failed login attempts
   */
  async resetFailedAttempts(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE users SET 
        failed_login_attempts = 0,
        locked_until = NULL
      WHERE id = $1`,
      [id],
    );
  }

  /**
   * Update password
   */
  async updatePassword(id: string, newPassword: string): Promise<void> {
    const passwordHash = await passwordService.hash(newPassword);

    await this.pool.query(
      `UPDATE users SET 
        password_hash = $2,
        password_changed_at = NOW()
      WHERE id = $1`,
      [id, passwordHash],
    );

    this.logger.info({ userId: id }, 'Password updated');
  }

  /**
   * Check if email is available
   */
  async isEmailAvailable(email: string): Promise<boolean> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [email],
    );

    return result.rows.length === 0;
  }
}
