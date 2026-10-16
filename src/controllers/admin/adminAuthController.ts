import { Request, Response } from 'express';
import { pool } from '../../config/db.js';
import { comparePassword, hashPassword } from '../../utils/password.js';
import {
  generateSecureToken,
  generateAdminJwt,
  sanitizeAdminResponse,
  logAdminAction,
  AdminModel,
} from '../../helpers/admin/adminAuthHelper.js';
import { sendPasswordResetEmail } from '../../helpers/mailHelper.js';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware.js';

/**
 * POST /api/admin/auth/login
 * Admin Login Endpoint
 */
export async function adminLogin(req: Request, res: Response): Promise<void> {
  try {
    const { username, password } = req.body;

    // Strict validation
    if (!username || typeof username !== 'string' || !username.trim()) {
      res.status(422).json({
        success: false,
        message: 'UserId or Email is required.',
      });
      return;
    }

    if (!password || typeof password !== 'string') {
      res.status(422).json({
        success: false,
        message: 'Password is required.',
      });
      return;
    }

    const cleanUsername = username.trim();

    // Parameterized prepared query - 0 SQL Injection
    const [rows] = await pool.query(
      'SELECT * FROM admins WHERE username = ? OR email = ? LIMIT 1',
      [cleanUsername, cleanUsername]
    );

    const adminList = rows as AdminModel[];
    if (adminList.length === 0) {
      res.status(401).json({
        success: false,
        message: 'Invalid UserId or Password',
      });
      return;
    }

    const admin = adminList[0];

    // Check account status (1 = Active)
    if (Number(admin.status) !== 1) {
      res.status(403).json({
        success: false,
        message: 'Your admin account is currently inactive or blocked. Please contact system owner.',
      });
      return;
    }

    // Verify Password with bcrypt (supporting $2y$ and $2a$)
    const isMatch = await comparePassword(password, admin.password || '');
    if (!isMatch) {
      res.status(401).json({
        success: false,
        message: 'Invalid UserId or Password',
      });
      return;
    }

    // Check Google 2FA
    if (admin.google2fa_secret) {
      res.status(200).json({
        success: true,
        requires2fa: true,
        adminId: admin.id,
        message: 'Two-Factor Authentication (2FA) is enabled for this account.',
      });
      return;
    }

    // Generate secure JWT token
    const token = generateAdminJwt(admin);
    const sanitizedUser = sanitizeAdminResponse(admin);

    // Audit log
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    await logAdminAction(admin.id, 'Admin Login', 'Admin logged in successfully', clientIp);

    res.status(200).json({
      success: true,
      message: 'Logged in successfully',
      token,
      user: sanitizedUser,
    });
  } catch (error) {
    console.error('[Admin Auth] Login error:', error);
    res.status(500).json({
      success: false,
      message: 'An internal server error occurred while processing your request.',
    });
  }
}

/**
 * POST /api/admin/auth/forgot-password
 * Admin Forgot Password Endpoint
 */
export async function adminForgotPassword(req: Request, res: Response): Promise<void> {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      res.status(422).json({
        success: false,
        message: 'A valid registered email address is required.',
      });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();

    // Query admin by email with prepared statement
    const [rows] = await pool.query(
      'SELECT id, username, email, first_name, last_name FROM admins WHERE email = ? LIMIT 1',
      [cleanEmail]
    );

    const adminList = rows as AdminModel[];
    if (adminList.length === 0) {
      res.status(404).json({
        success: false,
        message: 'Email does not exist in the system.',
      });
      return;
    }

    const admin = adminList[0];
    const resetToken = generateSecureToken();

    // Store secure token in admins table (matching Laravel behavior)
    await pool.query(
      'UPDATE admins SET password_reset_token = ? WHERE id = ?',
      [resetToken, admin.id]
    );

    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    const resetLink = `${clientUrl}/admin-reset-password/${resetToken}`;
    const adminFullName = [admin.first_name, admin.last_name].filter(Boolean).join(' ') || admin.username || 'Administrator';

    // Dispatch branded email via Brevo SMTP (matching Laravel send_email_template)
    await sendPasswordResetEmail({
      to: admin.email,
      name: adminFullName,
      resetLink,
      role: 'admin',
    });

    // Audit log
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    await logAdminAction(admin.id, 'Admin Password Reset Requested', `Reset requested for ${admin.email}`, clientIp);

    res.status(200).json({
      success: true,
      message: 'A password reset link has been sent to your registered email address. Please check your inbox or spam folder!',
      email: admin.email,
    });
  } catch (error) {
    console.error('[Admin Auth] Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while processing password reset.',
    });
  }
}

/**
 * GET /api/admin/auth/verify-reset-token/:token
 * Verify validity of reset password token
 */
export async function adminVerifyResetToken(req: Request, res: Response): Promise<void> {
  try {
    const { token } = req.params;
    const tokenStr = typeof token === 'string' ? token.trim() : String(token || '');

    if (!tokenStr) {
      res.status(400).json({
        success: false,
        message: 'Reset token parameter is required.',
      });
      return;
    }

    const [rows] = await pool.query(
      'SELECT id, username, email FROM admins WHERE password_reset_token = ? LIMIT 1',
      [tokenStr]
    );

    const adminList = rows as AdminModel[];
    if (adminList.length === 0) {
      res.status(400).json({
        success: false,
        message: 'Password reset token has expired or is invalid. Please request a new one.',
      });
      return;
    }

    res.status(200).json({
      success: true,
      email: adminList[0].email,
      username: adminList[0].username,
    });
  } catch (error) {
    console.error('[Admin Auth] Verify token error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error verifying token.',
    });
  }
}

/**
 * POST /api/admin/auth/reset-password
 * Complete Admin Password Reset
 */
export async function adminResetPassword(req: Request, res: Response): Promise<void> {
  try {
    const { token, password, password_confirmation } = req.body;

    if (!token || typeof token !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Valid reset token is required.',
      });
      return;
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      res.status(422).json({
        success: false,
        message: 'Password must be at least 6 characters.',
      });
      return;
    }

    if (password !== password_confirmation) {
      res.status(422).json({
        success: false,
        message: 'Password confirmation does not match.',
      });
      return;
    }

    const tokenStr = token.trim();

    const [rows] = await pool.query(
      'SELECT id, username, email FROM admins WHERE password_reset_token = ? LIMIT 1',
      [tokenStr]
    );

    const adminList = rows as AdminModel[];
    if (adminList.length === 0) {
      res.status(400).json({
        success: false,
        message: 'Password reset token has expired or is invalid. Please request a new one.',
      });
      return;
    }

    const admin = adminList[0];
    const newHashedPassword = await hashPassword(password);
    const randomizedInvalidationToken = generateSecureToken();

    // Atomically update password and invalidate previous token
    await pool.query(
      'UPDATE admins SET password = ?, password_reset_token = ? WHERE id = ?',
      [newHashedPassword, randomizedInvalidationToken, admin.id]
    );

    // Audit log
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    await logAdminAction(admin.id, 'Admin Password Changed', 'Admin password reset was successfully completed', clientIp);

    res.status(200).json({
      success: true,
      message: 'Your password has been changed successfully! You can now log in.',
    });
  } catch (error) {
    console.error('[Admin Auth] Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while updating password.',
    });
  }
}

/**
 * GET /api/admin/auth/me
 * Protected Route: Get Current Authenticated Admin
 */
export async function adminGetMe(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.admin) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const [rows] = await pool.query(
      'SELECT id, first_name, last_name, username, email, phone_no, type, image, status FROM admins WHERE id = ? LIMIT 1',
      [req.admin.id]
    );

    const adminList = rows as AdminModel[];
    if (adminList.length === 0) {
      res.status(404).json({ success: false, message: 'Admin profile not found.' });
      return;
    }

    res.status(200).json({
      success: true,
      user: sanitizeAdminResponse(adminList[0]),
    });
  } catch (error) {
    console.error('[Admin Auth] GetMe error:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
}

/**
 * POST /api/admin/auth/logout
 * Admin Logout
 */
export async function adminLogout(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (req.admin) {
      const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
      await logAdminAction(req.admin.id, 'Admin Logout', 'Admin logged out', clientIp);
    }
    res.status(200).json({
      success: true,
      message: 'Logged out successfully.',
    });
  } catch (error) {
    console.error('[Admin Auth] Logout error:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
}
