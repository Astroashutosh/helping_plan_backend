import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';

export interface AdminPayload {
  id: number;
  username: string;
  email: string;
  type: string;
}

export interface AuthenticatedRequest extends Request {
  admin?: AdminPayload;
}

export async function requireAdminAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, message: 'Authentication required. No token provided.' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const secret = process.env.JWT_SECRET || 'openaid_super_secret_jwt_key_2026_secure';

    const decoded = jwt.verify(token, secret) as AdminPayload;

    // Verify admin still exists and is active in database
    const [rows] = await pool.query(
      'SELECT id, username, email, type, status FROM admins WHERE id = ?',
      [decoded.id]
    );

    const adminList = rows as any[];
    if (adminList.length === 0) {
      res.status(401).json({ success: false, message: 'Admin account not found.' });
      return;
    }

    const admin = adminList[0];
    if (admin.status !== 1 && admin.status !== '1') {
      res.status(403).json({ success: false, message: 'Admin account is inactive or blocked.' });
      return;
    }

    req.admin = {
      id: admin.id,
      username: admin.username,
      email: admin.email,
      type: admin.type,
    };

    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
}

export interface UserPayload {
  id: number;
  username: string;
  email: string;
  type: string;
  impersonatedByAdmin?: boolean;
}

export interface AuthenticatedUserRequest extends Request {
  user?: UserPayload;
}

export async function requireUserAuth(
  req: AuthenticatedUserRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, message: 'Authentication required. No token provided.' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const secret = process.env.JWT_SECRET || 'openaid_super_secret_jwt_key_2026_secure';

    const decoded = jwt.verify(token, secret) as UserPayload;

    // Verify user still exists in database
    const [rows] = await pool.query(
      'SELECT id, username, email, type, is_block, is_suspend, wallet_blocked FROM users WHERE id = ? LIMIT 1',
      [decoded.id]
    );

    const userList = rows as any[];
    if (userList.length === 0) {
      res.status(401).json({ success: false, message: 'User account not found.' });
      return;
    }

    const user = userList[0];
    if (user.is_block === 'yes' && !decoded.impersonatedByAdmin) {
      res.status(403).json({ success: false, message: 'You are blocked. Please contact administrator.' });
      return;
    }

    if (user.is_suspend === 'yes' && !decoded.impersonatedByAdmin) {
      res.status(403).json({ success: false, message: 'You are suspended. Please contact administrator.' });
      return;
    }

    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      type: user.type,
      impersonatedByAdmin: Boolean(decoded.impersonatedByAdmin),
    };

    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid or expired user session token.' });
  }
}
