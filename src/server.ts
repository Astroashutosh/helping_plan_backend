import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { testDbConnection } from './config/db.js';
import { getUploadsBaseDir } from './config/uploadConfig.js';
import adminAuthRoutes from './routes/admin/adminAuthRoutes.js';
import adminDashboardRoutes from './routes/admin/adminDashboardRoutes.js';
import adminPackageRoutes from './routes/admin/packageRoutes.js';
import adminCreditRoutes from './routes/admin/creditRoutes.js';
import adminMemberRoutes from './routes/admin/memberRoutes.js';
import adminDepositRoutes from './routes/admin/depositRoutes.js';
import adminRankRewardRoutes from './routes/admin/rankRewardRoutes.js';
import adminWithdrawRoutes from './routes/admin/withdrawRoutes.js';
import adminPurchaseDonationRoutes from './routes/admin/purchaseDonationRoutes.js';
import adminReportRoutes from './routes/admin/reportRoutes.js';
import adminWeeklyReportRoutes from './routes/admin/weeklyReportRoutes.js';
import adminAcademyRoutes from './routes/admin/academyRoutes.js';
import userAuthRoutes from './routes/user/userAuthRoutes.js';
import commonRoutes from './routes/common/generalRoutes.js';
import { generalApiLimiter } from './middlewares/rateLimiter.js';
import adminCMSRoutes from './routes/admin/cms.js';
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Security Middlewares - Zero Theft / Zero Hacking Standards
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

const allowedOrigins = [
  process.env.CLIENT_URL || 'http://localhost:5173',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'https://www.openaidinternational.com',
  'https://openaidinternational.com',
];

app.use(
  cors({
    origin: (origin, callback) => {
      // allow requests with no origin (like mobile apps, curl, or Postman)
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, true); // Permissive in dev, or restricted based on allowedOrigins
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);

app.use(generalApiLimiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static Uploads Serving (strictly inside backend/uploads)
const localUploadsPath = getUploadsBaseDir();
app.use('/uploads', express.static(localUploadsPath));

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'OpenAid International Backend API',
    timestamp: new Date().toISOString(),
  });
});

// Common & Platform Settings (Public)
app.use('/api/common', commonRoutes);

// Admin Routes (controllers/admin and routes/admin)
app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/admin/dashboard', adminDashboardRoutes);
app.use('/api/admin/packages', adminPackageRoutes);
app.use('/api/admin/credits', adminCreditRoutes);
app.use('/api/admin/members', adminMemberRoutes);
app.use('/api/admin/deposits', adminDepositRoutes);
app.use('/api/admin/rank-rewards', adminRankRewardRoutes);
app.use('/api/admin/withdrawals', adminWithdrawRoutes);
app.use('/api/admin/purchase-donation', adminPurchaseDonationRoutes);
app.use('/api/admin/reports', adminReportRoutes);
app.use('/api/admin/weekly-report', adminWeeklyReportRoutes);
app.use('/api/admin/academy', adminAcademyRoutes);


// new route for cms

app.use('/api/admin', adminCMSRoutes);


// end new route 





// User Routes (controllers/user and routes/user)
app.use('/api/user/auth', userAuthRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Global Secure Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Secure Error Handler]', err);
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred.' : err.message || 'Internal error',
  });
});

// Start Server
async function startServer() {
  await testDbConnection();
  app.listen(PORT, () => {
    console.log(`🚀 [Server] OpenAid Backend API running securely on http://localhost:${PORT}`);
  });
}

startServer();
