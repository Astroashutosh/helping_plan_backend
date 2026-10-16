import { Router } from 'express';
import { requireAdminAuth } from '../../middlewares/authMiddleware.js';
import {
  getReportsSummary,
  getReferralCommissionReport,
  getLevelCommissionReport,
  getRankRewardReport,
  getAllTransactionsReport,
} from '../../controllers/admin/reportController.js';

const router = Router();

// Require admin authentication for all report routes
router.use(requireAdminAuth);

// High-level summary metrics
router.get('/summary', getReportsSummary);

// Referral Commission report
router.get('/referral', getReferralCommissionReport);

// Level Commission report
router.get('/level', getLevelCommissionReport);

// Rank Reward report
router.get('/rank-reward', getRankRewardReport);

// All Transactions ledger
router.get('/transactions', getAllTransactionsReport);

export default router;
