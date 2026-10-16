import { Router } from 'express';
import { requireAdminAuth } from '../../middlewares/authMiddleware.js';
import {
  getWithdrawals,
  getWithdrawalDetails,
  processWithdrawal,
} from '../../controllers/admin/withdrawController.js';

const router = Router();

// All admin withdrawal routes require admin authentication
router.use(requireAdminAuth);

// List / filter withdrawals (pending or history)
router.get('/', getWithdrawals);

// Single withdrawal details
router.get('/:id', getWithdrawalDetails);

// Process withdrawal (approve or reject with wallet refund)
router.post('/:id/process', processWithdrawal);

export default router;
