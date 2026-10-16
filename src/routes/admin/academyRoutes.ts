import { Router } from 'express';
import { requireAdminAuth } from '../../middlewares/authMiddleware.js';
import {
  getCategories,
  getParentCategories,
  getSubcategories,
  createCategory,
  updateCategory,
  toggleCategoryStatus,
  deleteCategory,
  getCourses,
  getCourseDetails,
  createCourse,
  updateCourse,
  toggleCourseStatus,
  deleteCourse,
  deleteCourseDocument,
  deleteCourseContent,
  getCoursePurchases,
} from '../../controllers/admin/academyController.js';

const router = Router();

// Require admin authentication
router.use(requireAdminAuth);

// ── Categories ─────────────────────────────────────────────────────────────
router.get('/categories', getCategories);
router.get('/categories/parents', getParentCategories);
router.get('/categories/subcategories', getSubcategories);
router.post('/categories', createCategory);
router.put('/categories/:id', updateCategory);
router.patch('/categories/:id/status', toggleCategoryStatus);
router.delete('/categories/:id', deleteCategory);

// ── Courses ────────────────────────────────────────────────────────────────
router.get('/courses', getCourses);
router.get('/courses/:id', getCourseDetails);
router.post('/courses', createCourse);
router.put('/courses/:id', updateCourse);
router.patch('/courses/:id/status', toggleCourseStatus);
router.delete('/courses/:id', deleteCourse);

// ── Documents & Contents ───────────────────────────────────────────────────
router.delete('/documents/:docId', deleteCourseDocument);
router.delete('/contents/:contentId', deleteCourseContent);

// ── Purchases ──────────────────────────────────────────────────────────────
router.get('/purchases', getCoursePurchases);

export default router;
