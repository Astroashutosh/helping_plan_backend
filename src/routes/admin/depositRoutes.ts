import { Router } from 'express';
import { requireAdminAuth } from '../../middlewares/authMiddleware.js';
import {
  getDeposits,
  approveDeposit,
  rejectDeposit,
} from '../../controllers/admin/depositController.js';

const router = Router();

// Protect all admin deposit endpoints
router.use(requireAdminAuth);

// List deposits (all or pending, with filters and stats)
router.get('/', getDeposits);

// Approve a pending deposit
router.post('/:id/approve', approveDeposit);

// Reject a pending deposit
router.post('/:id/reject', rejectDeposit);

export default router;
