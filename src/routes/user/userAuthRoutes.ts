import { Router } from 'express';
import {
  userLogin,
  userForgotPassword,
  userVerifyResetToken,
  userResetPassword,
  userGetMe,
  userLogout,
} from '../../controllers/user/userAuthController.js';
import { requireUserAuth } from '../../middlewares/authMiddleware.js';
import { loginRateLimiter, passwordResetRateLimiter } from '../../middlewares/rateLimiter.js';

const router = Router();

// Guest Routes
router.post('/login', loginRateLimiter, userLogin);
router.post('/forgot-password', passwordResetRateLimiter, userForgotPassword);
router.get('/verify-reset-token/:token', userVerifyResetToken);
router.post('/reset-password', passwordResetRateLimiter, userResetPassword);

// Protected Routes
router.get('/me', requireUserAuth as any, userGetMe as any);
router.post('/logout', userLogout);

export default router;
