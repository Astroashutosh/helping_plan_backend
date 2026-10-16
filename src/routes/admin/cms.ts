import { Router, Request, Response, NextFunction } from 'express';
import {
  manageCMS,
  getPublicCMS,
} from '../../controllers/admin/cmsController.js';
import { requireAdminAuth } from '../../middlewares/authMiddleware.js';

const router = Router();

// Public content: GET /api/admin/cms
router.get('/cms', getPublicCMS);

// Admin actions use the same POST endpoint.
router.post(
  '/cms',
  (req: Request, res: Response, next: NextFunction) => {
    if (req.body?.action === 'public_list') {
      return getPublicCMS(req, res);
    }

    return requireAdminAuth(req, res, next);
  },
  manageCMS
);

export default router;