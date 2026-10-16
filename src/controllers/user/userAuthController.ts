import { Request, Response } from 'express';
import { pool } from '../../config/db.js';
import { comparePassword, hashPassword } from '../../utils/password.js';
import {
  generateSecureToken,
  generateUserJwt,
  sanitizeUserResponse,
  logUserAction,
  UserModel,
  UserWalletModel,
} from '../../helpers/user/userAuthHelper.js';
import { sendPasswordResetEmail } from '../../helpers/mailHelper.js';
import { AuthenticatedUserRequest } from '../../middlewares/authMiddleware.js';

/**
 * POST /api/user/auth/login
 * User (Member) Login Endpoint
 * Strict security: parameterized SQL queries, bcrypt verification, status guards
 */
export async function userLogin(req: Request, res: Response): Promise<void> {
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

    const cleanInput = username.trim();
    const isEmail = cleanInput.includes('@');

    // Query user by username or email with prepared statement
    const query = isEmail
      ? 'SELECT * FROM users WHERE email = ? AND type = "user" LIMIT 1'
      : 'SELECT * FROM users WHERE username = ? AND type = "user" LIMIT 1';

    const [rows] = await pool.query(query, [cleanInput]);
    const userList = rows as UserModel[];

    if (userList.length === 0) {
      res.status(401).json({
        success: false,
        message: 'Invalid UserId or Password.',
      });
      return;
    }

    const user = userList[0];

    // Password verification with Bcrypt (handles Laravel $2y$ hashes)
    const isPasswordValid = await comparePassword(password, user.password || '');
    if (!isPasswordValid) {
      res.status(401).json({
        success: false,
        message: 'Invalid UserId or Password.',
      });
      return;
    }

    // Account status checks (exact parity with Laravel LoginController)
    if (user.is_block === 'yes') {
      res.status(403).json({
        success: false,
        message: 'You are blocked. Please contact administrator.',
      });
      return;
    }

    if (user.is_suspend === 'yes') {
      res.status(403).json({
        success: false,
        message: 'You are suspended. Please contact administrator.',
      });
      return;
    }

    if (user.wallet_blocked === 'yes') {
      res.status(403).json({
        success: false,
        message: 'Your wallet is blocked due to a negative balance limit. Please contact administrator.',
      });
      return;
    }

    // Fetch user wallets
    const [walletRows] = await pool.query(
      'SELECT * FROM user_wallets WHERE user_id = ? LIMIT 1',
      [user.id]
    );
    const wallets = (walletRows as UserWalletModel[])[0] || null;

    // Generate secure JWT token
    const token = generateUserJwt(user);
    const sanitizedUser = sanitizeUserResponse(user, wallets);

    // Audit log
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    await logUserAction(user.id, 'User Login', 'User logged in successfully', clientIp);

    res.status(200).json({
      success: true,
      message: 'Logged in successfully',
      token,
      user: sanitizedUser,
    });
  } catch (error) {
    console.error('[User Auth] Login error:', error);
    res.status(500).json({
      success: false,
      message: 'An internal server error occurred while processing your request.',
    });
  }
}

/**
 * POST /api/user/auth/forgot-password
 * User Forgot Password Endpoint
 * Generates secure single-use reset token and dispatches branded email via Brevo SMTP
 */
export async function userForgotPassword(req: Request, res: Response): Promise<void> {
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

    // Query user by email
    const [rows] = await pool.query(
      'SELECT id, username, email, first_name, last_name, is_block, is_suspend FROM users WHERE email = ? AND type = "user" LIMIT 1',
      [cleanEmail]
    );

    const userList = rows as UserModel[];
    if (userList.length === 0) {
      res.status(404).json({
        success: false,
        message: 'Email does not exist in the system.',
      });
      return;
    }

    const user = userList[0];
    if (user.is_block === 'yes' || user.is_suspend === 'yes') {
      res.status(403).json({
        success: false,
        message: 'Your account is currently restricted. Please contact administrator.',
      });
      return;
    }

    const resetToken = generateSecureToken();

    // Store token in users table
    await pool.query(
      'UPDATE users SET password_reset_token = ? WHERE id = ?',
      [resetToken, user.id]
    );

    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    const resetLink = `${clientUrl}/password/reset/${resetToken}`;
    const userFullName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Member';

    // Dispatch branded email via Brevo SMTP
    await sendPasswordResetEmail({
      to: user.email,
      name: userFullName,
      resetLink,
      role: 'user',
    });

    // Audit log
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    await logUserAction(user.id, 'User Password Reset Requested', `Reset requested for ${user.email}`, clientIp);

    res.status(200).json({
      success: true,
      message: 'A password reset link has been sent to your registered email address. Please check your inbox or spam folder!',
      email: user.email,
    });
  } catch (error) {
    console.error('[User Auth] Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while processing password reset.',
    });
  }
}

/**
 * GET /api/user/auth/verify-reset-token/:token
 * Verify validity of user password reset token
 */
export async function userVerifyResetToken(req: Request, res: Response): Promise<void> {
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
      'SELECT id, username, email FROM users WHERE password_reset_token = ? AND type = "user" LIMIT 1',
      [tokenStr]
    );

    const userList = rows as any[];
    if (userList.length === 0) {
      res.status(400).json({
        success: false,
        message: 'Invalid or expired password reset link.',
      });
      return;
    }

    res.status(200).json({
      success: true,
      email: userList[0].email,
      username: userList[0].username,
    });
  } catch (error) {
    console.error('[User Auth] Verify reset token error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify token.',
    });
  }
}

/**
 * POST /api/user/auth/reset-password
 * Reset User Password
 */
export async function userResetPassword(req: Request, res: Response): Promise<void> {
  try {
    const { token, password, password_confirmation } = req.body;

    if (!token || typeof token !== 'string') {
      res.status(422).json({
        success: false,
        message: 'Reset token is required.',
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

    // Verify token
    const [rows] = await pool.query(
      'SELECT id, username, email FROM users WHERE password_reset_token = ? AND type = "user" LIMIT 1',
      [token.trim()]
    );

    const userList = rows as any[];
    if (userList.length === 0) {
      res.status(400).json({
        success: false,
        message: 'Invalid or expired token. Please request a new password reset.',
      });
      return;
    }

    const user = userList[0];
    const hashedPassword = await hashPassword(password);
    const newRandomToken = generateSecureToken(); // Invalidate old token

    // Update password and rotate token
    await pool.query(
      'UPDATE users SET password = ?, password_reset_token = ? WHERE id = ?',
      [hashedPassword, newRandomToken, user.id]
    );

    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    await logUserAction(user.id, 'User Password Reset Completed', 'User successfully changed password', clientIp);

    res.status(200).json({
      success: true,
      message: 'Your password has been changed successfully! You can now log in.',
    });
  } catch (error) {
    console.error('[User Auth] Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while setting new password.',
    });
  }
}

/**
 * GET /api/user/auth/me
 * Authenticated user profile and wallets
 */
export async function userGetMe(req: AuthenticatedUserRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const [rows] = await pool.query(
      'SELECT * FROM users WHERE id = ? LIMIT 1',
      [req.user.id]
    );

    const userList = rows as UserModel[];
    if (userList.length === 0) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    const user = userList[0];

    // Fetch live wallets
    const [walletRows] = await pool.query(
      'SELECT * FROM user_wallets WHERE user_id = ? LIMIT 1',
      [user.id]
    );
    const wallets = (walletRows as UserWalletModel[])[0] || null;

    res.status(200).json({
      success: true,
      user: sanitizeUserResponse(user, wallets),
    });
  } catch (error) {
    console.error('[User Auth] GetMe error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve profile' });
  }
}

/**
 * POST /api/user/auth/logout
 */
export async function userLogout(req: Request, res: Response): Promise<void> {
  res.status(200).json({
    success: true,
    message: 'Logged out successfully',
  });
}
