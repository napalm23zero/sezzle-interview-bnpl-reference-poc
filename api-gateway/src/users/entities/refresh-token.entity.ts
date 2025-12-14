/**
 * Refresh Token Entity
 */

/**
 * Refresh token from database
 */
export interface RefreshToken {
  id: string;
  tokenId: string;
  userId: string;
  userAgent: string | null;
  ipAddress: string | null;
  deviceName: string | null;
  revoked: boolean;
  revokedAt: Date | null;
  revokedReason: string | null;
  issuedAt: Date;
  expiresAt: Date;
  lastUsedAt: Date | null;
  createdAt: Date;
}

/**
 * Create refresh token input
 */
export interface CreateRefreshTokenInput {
  tokenId: string;
  userId: string;
  expiresAt: Date;
  userAgent?: string;
  ipAddress?: string;
  deviceName?: string;
}

/**
 * Convert database row to RefreshToken entity
 */
export function rowToRefreshToken(row: Record<string, unknown>): RefreshToken {
  return {
    id: row.id as string,
    tokenId: row.token_id as string,
    userId: row.user_id as string,
    userAgent: row.user_agent as string | null,
    ipAddress: row.ip_address as string | null,
    deviceName: row.device_name as string | null,
    revoked: row.revoked as boolean,
    revokedAt: row.revoked_at ? new Date(row.revoked_at as string) : null,
    revokedReason: row.revoked_reason as string | null,
    issuedAt: new Date(row.issued_at as string),
    expiresAt: new Date(row.expires_at as string),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at as string) : null,
    createdAt: new Date(row.created_at as string),
  };
}
