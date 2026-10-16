import rateLimit from 'express-rate-limit';

/**
 * Strict Rate Limiter for Login Endpoints:
 * Max 5 attempts per 15 minutes per IP.
 */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'development' ? 30 : 10,
  skipSuccessfulRequests: true, // Only count failed login attempts
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: {
    success: false,
    message: 'Too many failed login attempts from this IP. Please try again after 15 minutes.',
  },
});

/**
 * Rate Limiter for Password Reset Requests:
 * Max 3 requests per 30 minutes per IP.
 */
export const passwordResetRateLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many password reset requests from this IP. Please try again after 30 minutes.',
  },
});

/**
 * General API Limiter:
 * 100 requests per minute per IP.
 */
export const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please slow down.',
  },
});
