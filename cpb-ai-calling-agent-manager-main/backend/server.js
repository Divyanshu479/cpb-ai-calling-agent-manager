import 'dotenv/config';

import app from './src/app.js';
import connectDB from './src/config/database.js';
import { initializeSocket } from './src/sockets/socketServer.js';
import twilioGeminiBridge from './src/services/twilioGeminiBridge.js';
import vobizGeminiBridge from './src/services/vobizGeminiBridge.js';
import vobizCdrPoller from './src/services/vobizCdrPoller.js';
import sttLlmTtsCallingService from './src/services/sttLlmTtsCallingService.js';


// Connect to database
await connectDB();

try {
  const { migrateTelephonyConfigs } = await import('./src/utils/migrateTelephonyConfigs.js');
  await migrateTelephonyConfigs();
} catch (err) {
  console.error('Telephony config migration failed:', err);
}

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║                                                      ║
║        AI Calling Platform - Backend Server          ║
║                                                      ║
║  Server running in ${process.env.NODE_ENV} mode.                 ║
║  Port: ${PORT}                                          ║
║  API: http://localhost:${PORT}/api                      ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
  `);
});

// Initialize Socket.io
initializeSocket(server);
twilioGeminiBridge.initialize(server);
vobizGeminiBridge.initialize(server);
sttLlmTtsCallingService.initialize(server);
// Start CDR poller as a fallback for missed webhooks
try {
  vobizCdrPoller.start();
} catch (e) {
  console.warn('Failed to start Vobiz CDR Poller', e?.message || e);
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION! Shutting down...');
  console.error(err);
  server.close(() => {
    process.exit(1);
  });
});

// Handle SIGTERM
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Process terminated');
  });
});
