import express from 'express';
import { protect } from '../middleware/auth.js';
import { isCampaignManager } from '../middleware/roleCheck.js';
import {
  getLeads,
  createLead,
  uploadLeads,
  getLead,
  updateLead,
  deleteLead,
  getLeadStats,
  initiateLeadCall,
} from '../controllers/leadController.js';

const router = express.Router();

// All routes require authentication and campaign manager role
router.use(protect);
router.use(isCampaignManager);

import multer from 'multer';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max file size
});

// Campaign-specific lead routes
router.get('/campaigns/:campaignId/leads', getLeads);
router.post('/campaigns/:campaignId/leads', createLead);
router.post('/campaigns/:campaignId/leads/upload', upload.single('file'), uploadLeads);
router.get('/campaigns/:campaignId/leads/stats', getLeadStats);

// Individual lead routes
router.get('/leads/:id', getLead);
router.put('/leads/:id', updateLead);
router.delete('/leads/:id', deleteLead);
router.post('/leads/:id/call', initiateLeadCall);

export default router;
