import { Router } from 'express';
import { requireAdminAuth } from '../../middlewares/authMiddleware.js';
import { getWeeklyReport } from '../../controllers/admin/weeklyReportController.js';

const router = Router();

// Require admin authentication for weekly report routes
router.use(requireAdminAuth);

// Weekly report overview & tab records
router.get('/', getWeeklyReport);

export default router;
