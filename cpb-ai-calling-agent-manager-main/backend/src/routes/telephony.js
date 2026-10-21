import express from 'express';
import { protect } from '../middleware/auth.js';
import { isAdminOrManager } from '../middleware/roleCheck.js';
import {
  getTelephonyConfig,
  saveTelephonyConfig,
  testTelephonyConfig,
  deactivateTelephony,
  twilioStatusWebhook,
  twilioVoiceWebhook,
  vobizAnswerWebhook,
  vobizHangupWebhook,
  vobizStreamStatusWebhook,
  handleWebhook,
  testTelephonyIntegration,
  twilioAmdWebhook,
} from '../controllers/telephonyController.js';

const router = express.Router();

// Webhook route (public, no auth required)
router.post('/webhook/:provider', handleWebhook);
router.post('/twilio/voice', twilioVoiceWebhook);
router.post('/twilio/status', twilioStatusWebhook);
router.post('/twilio/amd', twilioAmdWebhook);
router.post('/vobiz/answer', vobizAnswerWebhook);
router.post('/vobiz/hangup', vobizHangupWebhook);
router.post('/vobiz/stream-status', vobizStreamStatusWebhook);

// All other routes require admin authentication
router.use(protect);
router.use(isAdminOrManager);

router.route('/config')
  .get(getTelephonyConfig)
  .post(saveTelephonyConfig);

router.post('/test', testTelephonyConfig);
router.post('/test-integration/:id', testTelephonyIntegration);
router.post('/deactivate', deactivateTelephony);

export default router;
