import { Router } from 'express';
import { requireAdminAuth } from '../../middlewares/authMiddleware.js';
import {
  getRankRewards,
  approveRankReward,
  rejectRankReward,
} from '../../controllers/admin/rankRewardController.js';

const router = Router();

// Protect all admin rank reward endpoints
router.use(requireAdminAuth);

// GET /api/admin/rank-rewards (query params: tab, search/uname, page, limit/rows)
router.get('/', getRankRewards);

// POST /api/admin/rank-rewards/:id/approve (body: reward_name, admin_notes)
router.post('/:id/approve', approveRankReward);

// POST /api/admin/rank-rewards/:id/reject (body: reason)
router.post('/:id/reject', rejectRankReward);

export default router;
