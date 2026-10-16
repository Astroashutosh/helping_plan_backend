import { Router } from 'express';
import { requireAdminAuth } from '../../middlewares/authMiddleware.js';
import {
  getAdminDashboardOverview,
  getSidebarCounters,
} from '../../controllers/admin/adminDashboardController.js';

const router = Router();

// GET /api/admin/dashboard
router.get('/', requireAdminAuth, getAdminDashboardOverview);
router.get('/overview', requireAdminAuth, getAdminDashboardOverview);
router.get('/sidebar-counters', requireAdminAuth, getSidebarCounters);

export default router;
