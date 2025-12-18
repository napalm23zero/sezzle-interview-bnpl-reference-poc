/**
 * User Entity
 *
 * Domain model for user accounts.
 */

import type { UserRole } from '../../auth/index.js';

/**
 * User status enum
 */
export type UserStatus = 'active' | 'inactive' | 'suspended' | 'pending_verification';

/**
 * User entity from database
 */
export interface User {
  id: string;
  email: string;
  passwordHash: string;
  firstName: string | null;
  lastName: string | null;
  role: UserRole;
  permissions: string[];
  tenantId: string | null;
  merchantId: string | null;
  status: UserStatus;
  emailVerified: boolean;
  emailVerifiedAt: Date | null;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  lastLoginIp: string | null;
  passwordChangedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

/**
 * User without sensitive fields (safe for API responses)
 */
export type UserPublic = Omit<User, 'passwordHash'>;

/**
 * Create user input
 */
export interface CreateUserInput {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  role?: UserRole;
  permissions?: string[];
  tenantId?: string;
  merchantId?: string;
}

/**
 * Update user input
 */
export interface UpdateUserInput {
  firstName?: string;
  lastName?: string;
  role?: UserRole;
  permissions?: string[];
  status?: UserStatus;
  emailVerified?: boolean;
}

/**
 * User query filters
 */
export interface UserFilters {
  email?: string;
  role?: UserRole;
  status?: UserStatus;
  tenantId?: string;
  merchantId?: string;
}

/**
 * Convert database row to User entity
 */
export function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    email: row.email as string,
    passwordHash: row.password_hash as string,
    firstName: row.first_name as string | null,
    lastName: row.last_name as string | null,
    role: row.role as UserRole,
    permissions: (row.permissions as string[]) || [],
    tenantId: row.tenant_id as string | null,
    merchantId: row.merchant_id as string | null,
    status: row.status as UserStatus,
    emailVerified: row.email_verified as boolean,
    emailVerifiedAt: row.email_verified_at ? new Date(row.email_verified_at as string) : null,
    failedLoginAttempts: row.failed_login_attempts as number,
    lockedUntil: row.locked_until ? new Date(row.locked_until as string) : null,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at as string) : null,
    lastLoginIp: row.last_login_ip as string | null,
    passwordChangedAt: new Date(row.password_changed_at as string),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    createdBy: row.created_by as string | null,
    updatedBy: row.updated_by as string | null,
  };
}

/**
 * Convert User to public representation (without password)
 */
export function toPublicUser(user: User): UserPublic {
  const { passwordHash, ...publicUser } = user;
  void passwordHash;
  return publicUser;
}
