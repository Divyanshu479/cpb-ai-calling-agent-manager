import express from 'express';
import { protect } from '../middleware/auth.js';
import { isAdmin } from '../middleware/roleCheck.js';
import { getAllCampaigns } from '../controllers/campaignController.js';
import {
  getProviderCallLogsAdmin,
  getProviderCallLogsStatsAdmin,
  getProviderCallLogAdmin,
} from '../controllers/callLogController.js';
import {
  getUsageReports,
  getManagerUsageReport,
  getPlatformStats,
} from '../controllers/reportsController.js';
import {
  getQueueMetrics,
  getGlobalQueueMetrics,
  getDeadLetterJobs,
  replayDeadLetterJobs,
  getExtractionBackfillPreview,
  getExtractionQueueStatus,
  triggerExtractionBackfill,
} from '../controllers/dialQueueController.js';

const router = express.Router();

// All routes require admin authentication
router.use(protect);
router.use(isAdmin);

// Campaigns
router.get('/campaigns', getAllCampaigns);

// Call Logs
router.get('/provider-call-logs', getProviderCallLogsAdmin);
router.get('/provider-call-logs/stats', getProviderCallLogsStatsAdmin);
router.get('/provider-call-logs/:callSid', getProviderCallLogAdmin);

// Reports
router.get('/reports/usage', getUsageReports);
router.get('/reports/usage/:managerId', getManagerUsageReport);
router.get('/reports/platform', getPlatformStats);

// Queue monitoring
router.get('/queue/metrics', getQueueMetrics);
router.get('/queue/global', getGlobalQueueMetrics);
router.get('/queue/dead-letter', getDeadLetterJobs);
router.post('/queue/dead-letter/replay', replayDeadLetterJobs);

// Manual post-call processing
// GET  /api/admin/extraction/backfill?since=2026-10-09  → counts and a sample, nothing queued
// GET  /api/admin/extraction/queue                       → live queue depths
// POST /api/admin/extraction/backfill                   → enqueue a batch
router.get('/extraction/queue', getExtractionQueueStatus);
router.get('/extraction/backfill', getExtractionBackfillPreview);
router.post('/extraction/backfill', triggerExtractionBackfill);

export default router;
