import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../../config/db.js';

export interface UserModel {
  id: number;
  first_name: string | null;
  last_name: string | null;
  username: string;
  email: string;
  phone_no?: string | null;
  country_code?: string | null;
  wallet_address?: string | null;
  password?: string;
  type: string;
  status: number;
  rank_id?: number | null;
  is_block: 'yes' | 'no';
  is_suspend: 'yes' | 'no';
  wallet_blocked: 'yes' | 'no';
  image?: string | null;
}

export interface UserWalletModel {
  balance: number;
  deposit_balance: number;
  donation_wallet: number;
  donation_withdrawable: number;
  direct_wallet: number;
  level_wallet: number;
  rank_wallet: number;
  total_earning: number;
}

/**
 * Generate cryptographically secure random token (64 hex characters)
 */
export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate signed JWT for authenticated user
 */
export function generateUserJwt(user: UserModel): string {
  const secret = process.env.JWT_SECRET || 'openaid_super_secret_jwt_key_2026_secure';
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';

  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      email: user.email,
      type: user.type,
      role: 'user',
    },
    secret,
    { expiresIn: expiresIn as any }
  );
}

/**
 * Sanitizes user record and attaches wallet balances if available
 */
export function sanitizeUserResponse(user: UserModel, wallet?: UserWalletModel | null) {
  return {
    id: user.id,
    first_name: user.first_name,
    last_name: user.last_name,
    full_name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username,
    username: user.username,
    email: user.email,
    phone_no: user.phone_no || null,
    country_code: user.country_code || null,
    wallet_address: user.wallet_address || null,
    type: user.type,
    status: user.status,
    rank_id: user.rank_id || 1,
    image: user.image || null,
    wallets: wallet || {
      balance: 0,
      deposit_balance: 0,
      donation_wallet: 0,
      donation_withdrawable: 0,
      direct_wallet: 0,
      level_wallet: 0,
      rank_wallet: 0,
      total_earning: 0,
    },
  };
}

/**
 * Audit / Activity logging for user events
 */
export async function logUserAction(
  userId: number,
  action: string,
  description: string,
  ip: string
): Promise<void> {
  try {
    // Check if activity_logs or user_logs table exists
    await pool.query(
      'INSERT INTO user_logs (user_id, action, description, ip, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
      [userId, action, description, ip]
    );
  } catch {
    // Fallback gracefully if table schema differs
  }
}
