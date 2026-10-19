
import { Router } from "express";
import {
  getPublicDisclaimer,
  listDisclaimerAdmin,
  createDisclaimerSection,
  updateDisclaimerSection,
  deleteDisclaimerSection,
} from "../../controllers/admin/disclaimerController.js";

const router = Router();

// Public disclaimer
router.get("/disclaimer", getPublicDisclaimer);

// Admin disclaimer CRUD
router.get("/disclaimer", listDisclaimerAdmin);
router.post("/disclaimer", createDisclaimerSection);
router.put("/disclaimer/:id", updateDisclaimerSection);
router.delete("/disclaimer/:id", deleteDisclaimerSection);

export default router;
