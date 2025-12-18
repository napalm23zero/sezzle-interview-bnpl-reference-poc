/**
 * Password Service
 *
 * Secure password hashing using Argon2id.
 *
 * @remarks
 * Argon2id is the recommended algorithm for password hashing:
 * - Winner of the Password Hashing Competition (PHC)
 * - Resistant to GPU/ASIC attacks
 * - Memory-hard (prevents parallel attacks)
 * - Salt is automatically generated and included in hash
 *
 * Security considerations:
 * - Uses Argon2id variant (hybrid of Argon2i and Argon2d)
 * - Memory cost: 64MB (prevents GPU attacks)
 * - Time cost: 3 iterations
 * - Parallelism: 4 threads
 *
 * @example
 * ```typescript
 * const hash = await passwordService.hash('mypassword');
 * const isValid = await passwordService.verify('mypassword', hash);
 * ```
 */

import * as argon2 from 'argon2';

/**
 * Password hashing configuration
 */
export interface PasswordConfig {
  /**
   * Memory cost in KB (default: 65536 = 64MB)
   */
  memoryCost?: number;

  /**
   * Time cost (iterations, default: 3)
   */
  timeCost?: number;

  /**
   * Parallelism (threads, default: 4)
   */
  parallelism?: number;

  /**
   * Hash length in bytes (default: 32)
   */
  hashLength?: number;
}

/**
 * Password validation result
 */
export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Default password requirements
 */
const PASSWORD_REQUIREMENTS = {
  minLength: 8,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  specialChars: '!@#$%^&*()_+-=[]{}|;:,.<>?',
};

/**
 * Password Service
 *
 * Handles secure password hashing and verification.
 */
export class PasswordService {
  private readonly config: Required<PasswordConfig>;

  constructor(config: PasswordConfig = {}) {
    this.config = {
      memoryCost: config.memoryCost ?? 65536, // 64MB
      timeCost: config.timeCost ?? 3,
      parallelism: config.parallelism ?? 4,
      hashLength: config.hashLength ?? 32,
    };
  }

  /**
   * Hash a password using Argon2id
   *
   * @param password - Plain text password
   * @returns Argon2id hash string (includes salt)
   */
  async hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: this.config.memoryCost,
      timeCost: this.config.timeCost,
      parallelism: this.config.parallelism,
      hashLength: this.config.hashLength,
    });
  }

  /**
   * Verify a password against a hash
   *
   * @param password - Plain text password to verify
   * @param hash - Argon2id hash to verify against
   * @returns True if password matches
   */
  async verify(password: string, hash: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      // Invalid hash format or other error
      return false;
    }
  }

  /**
   * Check if a hash needs to be rehashed (config changed)
   *
   * @param hash - Current password hash
   * @returns True if hash should be updated
   */
  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, {
      memoryCost: this.config.memoryCost,
      timeCost: this.config.timeCost,
    });
  }

  /**
   * Validate password against requirements
   *
   * @param password - Password to validate
   * @returns Validation result with errors if any
   */
  validate(password: string): PasswordValidationResult {
    const errors: string[] = [];

    if (password.length < PASSWORD_REQUIREMENTS.minLength) {
      errors.push(`Password must be at least ${PASSWORD_REQUIREMENTS.minLength} characters`);
    }

    if (password.length > PASSWORD_REQUIREMENTS.maxLength) {
      errors.push(`Password must be at most ${PASSWORD_REQUIREMENTS.maxLength} characters`);
    }

    if (PASSWORD_REQUIREMENTS.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (PASSWORD_REQUIREMENTS.requireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (PASSWORD_REQUIREMENTS.requireNumbers && !/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    if (PASSWORD_REQUIREMENTS.requireSpecialChars) {
      const specialCharsRegex = new RegExp(
        `[${PASSWORD_REQUIREMENTS.specialChars.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}]`,
      );
      if (!specialCharsRegex.test(password)) {
        errors.push('Password must contain at least one special character');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Generate a secure random password
   *
   * @param length - Password length (default: 16)
   * @returns Random password meeting all requirements
   */
  generateSecurePassword(length: number = 16): string {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const special = '!@#$%^&*()_+-=';
    const all = uppercase + lowercase + numbers + special;

    // Ensure at least one of each required type
    let password = '';
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += special[Math.floor(Math.random() * special.length)];

    // Fill rest with random characters
    for (let i = password.length; i < length; i++) {
      password += all[Math.floor(Math.random() * all.length)];
    }

    // Shuffle the password
    return password
      .split('')
      .sort(() => Math.random() - 0.5)
      .join('');
  }
}

// Singleton instance with default config
export const passwordService = new PasswordService();
