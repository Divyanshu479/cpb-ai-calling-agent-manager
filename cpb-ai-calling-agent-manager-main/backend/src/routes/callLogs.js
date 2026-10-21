import express from 'express';
import { protect } from '../middleware/auth.js';
import { isCampaignManager } from '../middleware/roleCheck.js';
import {
  getProviderCallLogs,
  getProviderCallLogsStats,
  exportProviderCallLogs,
  getProviderCallLog,
} from '../controllers/callLogController.js';

const router = express.Router();

// All routes require authentication and campaign manager role
router.use(protect);
router.use(isCampaignManager);

// Provider-backed call logs routes
router.get('/provider', getProviderCallLogs);
router.get('/provider/stats', getProviderCallLogsStats);
router.get('/provider/export', exportProviderCallLogs);
router.get('/provider/:callSid', getProviderCallLog);

export default router;
