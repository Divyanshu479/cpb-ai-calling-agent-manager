import express from 'express';
import { protect } from '../middleware/auth.js';
import { isAdmin } from '../middleware/roleCheck.js';
import {
  getAll,
  getByType,
  getActiveByType,
  getOne,
  create,
  createFromTemplate,
  update,
  updateFromTemplate,
  deleteIntegration,
  setDefault,
  test,
} from '../controllers/integrationController.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// Routes accessible to all authenticated users (for getting active integrations)
router.get('/active/:type', getActiveByType);

// Admin-only routes
router.use(isAdmin);

// Get all integrations or by type
router.get('/', getAll);
router.get('/type/:type', getByType);

// CRUD operations
router.post('/', create);
router.post('/templates/s2s/:templateId/create', createFromTemplate);
router.put('/:integrationId/update-from-template', updateFromTemplate);
router.get('/:id', getOne);
router.put('/:id', update);
router.delete('/:id', deleteIntegration);

// Special operations
router.put('/:id/set-default', setDefault);
router.post('/:id/test', test);

export default router;
