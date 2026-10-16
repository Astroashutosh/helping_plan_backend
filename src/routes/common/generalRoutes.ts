import { Router } from 'express';
import { getGeneralSettings } from '../../controllers/common/generalController.js';

const router = Router();

// GET /api/common/general-settings
router.get('/general-settings', getGeneralSettings);
router.get('/general', getGeneralSettings);

export default router;
