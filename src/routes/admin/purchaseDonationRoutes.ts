import { Router } from 'express';
import { requireAdminAuth } from '../../middlewares/authMiddleware.js';
import {
  getCreditPurchasesReport,
  getDonationsReport,
  getPurchaseDonationSummary,
} from '../../controllers/admin/purchaseDonationController.js';

const router = Router();

// Require admin authentication for all routes
router.use(requireAdminAuth);

// Summary metrics
router.get('/summary', getPurchaseDonationSummary);

// Credit purchase report (epin_buy)
router.get('/credit-purchases', getCreditPurchasesReport);

// Make donation report
router.get('/donations', getDonationsReport);

export default router;
