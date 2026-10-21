import express from 'express';
import { protect } from '../middleware/auth.js';
import {
  getKnowledgeBases,
  getKnowledgeBase,
  createKnowledgeBase,
  updateKnowledgeBase,
  deleteKnowledgeBase,
  searchKnowledge,
  upload,
} from '../controllers/knowledgeController.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

router.route('/')
  .get(getKnowledgeBases)
  .post(upload.single('file'), createKnowledgeBase);

router.post('/search', searchKnowledge);

router.route('/:id')
  .get(getKnowledgeBase)
  .put(updateKnowledgeBase)
  .delete(deleteKnowledgeBase);

export default router;
