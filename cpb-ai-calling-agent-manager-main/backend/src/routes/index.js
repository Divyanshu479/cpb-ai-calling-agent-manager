import express from 'express';
import authRoutes from './auth.js';
import userRoutes from './users.js';
import callerRoutes from './callers.js';
import campaignRoutes from './campaigns.js';
import leadRoutes from './leads.js';
import callLogRoutes from './callLogs.js';
import knowledgeRoutes from './knowledge.js';
import telephonyRoutes from './telephony.js';
import adminRoutes from './admin.js';
import integrationRoutes from './integrations.js';

const router = express.Router();

// Health check (must be before leadRoutes to avoid being caught by '/')
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// Mount routes
router.use('/auth', authRoutes);
router.use('/admin/managers', userRoutes);
router.use('/admin', adminRoutes);
router.use('/integrations', integrationRoutes);
router.use('/callers', callerRoutes);
router.use('/campaigns', campaignRoutes);
router.use('/call-logs', callLogRoutes);
router.use('/knowledge', knowledgeRoutes);
router.use('/telephony', telephonyRoutes);
router.use('/', leadRoutes); // Must be last as it catches all routes

export default router;
