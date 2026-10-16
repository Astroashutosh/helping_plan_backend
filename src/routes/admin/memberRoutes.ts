import { Router } from 'express';
import { requireAdminAuth } from '../../middlewares/authMiddleware.js';
import {
  getMembers,
  getCountries,
  updateMemberStatus,
  updateMemberPassword,
  impersonateMember,
  getMemberProfile,
  updateMemberProfile,
} from '../../controllers/admin/memberController.js';

const router = Router();

// Protect all admin member endpoints
router.use(requireAdminAuth);

// Country list for filter dropdown
router.get('/countries', getCountries);

// Member list with filtering, search, pagination
router.get('/', getMembers);

// Profile details (view & edit)
router.get('/:id/profile', getMemberProfile);
router.put('/:id/profile', updateMemberProfile);
router.post('/:id/update-profile', updateMemberProfile);

// Update account status (block, unblock, suspend, unsuspend, activate)
router.post('/status', updateMemberStatus);

// Update login or transaction password
router.post('/password', updateMemberPassword);

// Impersonate / Login as member
router.post('/impersonate', impersonateMember);


export default router;
