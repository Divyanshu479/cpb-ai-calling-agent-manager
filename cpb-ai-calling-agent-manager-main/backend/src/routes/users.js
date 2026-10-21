import express from 'express';
import {
  getManagers,
  getManager,
  createManager,
  updateManager,
  updateManagerLimits,
  deleteManager,
  getManagerUsage,
  resetManagerUsage
} from '../controllers/userController.js';
import { protect } from '../middleware/auth.js';
import { isAdmin } from '../middleware/roleCheck.js';

const router = express.Router();

// All routes require authentication and admin role
router.use(protect, isAdmin);

router.route('/')
  .get(getManagers)
  .post(createManager);

router.route('/:id')
  .get(getManager)
  .put(updateManager)
  .delete(deleteManager);

router.route('/:id/limits')
  .put(updateManagerLimits);

router.route('/:id/usage')
  .get(getManagerUsage);

router.route('/:id/reset-usage')
  .post(resetManagerUsage);

export default router;
