import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../../config/db.js';

export interface AdminModel {
  id: number;
  first_name: string | null;
  last_name: string | null;
  username: string;
  email: string;
  password?: string;
  phone_no?: string | null;
  type: string;
  status: number | string;
  image?: string | null;
  google2fa_secret?: string | null;
}

/**
 * Generate cryptographically secure random token (64 hex characters)
 */
export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Issue Admin JWT Token with strict payload
 */
export function generateAdminJwt(admin: AdminModel): string {
  const secret = process.env.JWT_SECRET || 'openaid_super_secret_jwt_key_2026_secure';
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';

  return jwt.sign(
    {
      id: admin.id,
      username: admin.username,
      email: admin.email,
      type: admin.type || 'admin',
    },
    secret,
    { expiresIn } as any
  );
}

/**
 * Sanitize admin data for client response (strips password, tokens, secrets)
 */
export function sanitizeAdminResponse(admin: AdminModel) {
  return {
    id: admin.id,
    first_name: admin.first_name,
    last_name: admin.last_name,
    username: admin.username,
    email: admin.email,
    type: admin.type,
    image: admin.image || 'default.png',
  };
}

/**
 * Audit log helper (creates log in logs table if it exists)
 */
export async function logAdminAction(adminId: number, action: string, details: string, ipAddress?: string): Promise<void> {
  try {
    // Attempt audit logging if logs table exists in helping_plan
    await pool.query(
      `INSERT INTO logs (user_id, type, title, description, ip, created_at) 
       VALUES (?, 'admin', ?, ?, ?, NOW())`,
      [adminId, action, details, ipAddress || '127.0.0.1']
    ).catch(() => {
      // Fallback silently if table schema differs
    });
  } catch {
    // No-op for resilient logging
  }
}
