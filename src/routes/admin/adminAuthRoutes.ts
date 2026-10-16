import { Router } from 'express';
import {
  adminLogin,
  adminForgotPassword,
  adminVerifyResetToken,
  adminResetPassword,
  adminGetMe,
  adminLogout,
} from '../../controllers/admin/adminAuthController.js';
import { requireAdminAuth } from '../../middlewares/authMiddleware.js';
import { loginRateLimiter, passwordResetRateLimiter } from '../../middlewares/rateLimiter.js';

const router = Router();

// Public Admin Auth Routes with Rate Limiting (Brute Force Defense)
router.post('/login', loginRateLimiter, adminLogin);
router.post('/forgot-password', passwordResetRateLimiter, adminForgotPassword);
router.get('/verify-reset-token/:token', adminVerifyResetToken);
router.post('/reset-password', passwordResetRateLimiter, adminResetPassword);

// Protected Admin Auth Routes
router.get('/me', requireAdminAuth, adminGetMe);
router.post('/logout', requireAdminAuth, adminLogout);

export default router;
