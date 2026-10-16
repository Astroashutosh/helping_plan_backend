import { Router } from 'express';
import { requireAdminAuth } from '../../middlewares/authMiddleware.js';
import {
  getActivePackagesForCredits,
  checkMember,
  getUnallottedCredits,
  generateCredits,
  deleteCredit,
  getTransferredCredits,
  transferCredits,
  getUsedCredits,
} from '../../controllers/admin/creditController.js';

const router = Router();

// Protect all credit management endpoints with admin authentication
router.use(requireAdminAuth);

// Active packages for dropdowns
router.get('/packages', getActivePackagesForCredits);

// Live member username lookup
router.get('/check-user', checkMember);

// 1. Unallotted Generated Credits (trans_pin.blade.php)
router.get('/unallotted', getUnallottedCredits);
router.post('/generate', generateCredits);
router.delete('/:id', deleteCredit);

// 2. Transferred Credits Log (transferred_pins.blade.php)
router.get('/transferred', getTransferredCredits);
router.post('/transfer', transferCredits);

// 3. Used Credits Log (used_pin.blade.php)
router.get('/used', getUsedCredits);

export default router;
