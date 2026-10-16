import { Router } from 'express';
import { requireAdminAuth } from '../../middlewares/authMiddleware.js';
import {
  getPackages,
  getPackageById,
  createPackage,
  updatePackage,
  togglePackageStatus,
  deletePackage,
} from '../../controllers/admin/packageController.js';

const router = Router();

// All package management endpoints require admin authentication
router.use(requireAdminAuth);

router.get('/', getPackages);
router.get('/:id', getPackageById);
router.post('/', createPackage);
router.put('/:id', updatePackage);
router.patch('/:id/status', togglePackageStatus);
router.delete('/:id', deletePackage);

export default router;
