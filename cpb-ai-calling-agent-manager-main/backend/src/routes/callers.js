import express from 'express';
import {
  getCallers,
  getCaller,
  createCaller,
  updateCaller,
  updateCallerScript,
  deleteCaller,
  testCaller
} from '../controllers/callerController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

router.route('/')
  .get(getCallers)
  .post(createCaller);

router.route('/:id')
  .get(getCaller)
  .put(updateCaller)
  .delete(deleteCaller);

router.route('/:id/script')
  .put(updateCallerScript);

router.route('/:id/test')
  .post(testCaller);

export default router;
