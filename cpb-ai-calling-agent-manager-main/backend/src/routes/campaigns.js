import express from 'express';
import {
  getCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  startCampaign,
  pauseCampaign,
  stopCampaign,
  getCampaignStats,
  getCampaignSessions,
  getCampaignSessionsExport,
  getCampaignSessionDetail,
  getAllCampaigns
} from '../controllers/campaignController.js';
import { protect } from '../middleware/auth.js';
import { isAdmin } from '../middleware/roleCheck.js';

const router = express.Router();

// Admin route for all campaigns
router.get('/admin/all', protect, isAdmin, getAllCampaigns);

// All other routes require authentication
router.use(protect);

router.route('/')
  .get(getCampaigns)
  .post(createCampaign);

router.route('/:id')
  .get(getCampaign)
  .put(updateCampaign)
  .delete(deleteCampaign);

router.post('/:id/start', startCampaign);
router.post('/:id/pause', pauseCampaign);
router.post('/:id/stop', stopCampaign);

router.get('/:id/stats', getCampaignStats);
router.get('/:id/sessions', getCampaignSessions);
router.get('/:id/sessions/export', getCampaignSessionsExport);
router.get('/:id/sessions/:sessionId', getCampaignSessionDetail);

export default router;
