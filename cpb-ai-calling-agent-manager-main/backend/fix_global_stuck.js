import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cpb-agent';
import Lead from './src/models/Lead.js';
import CallSession from './src/models/CallSession.js';

async function run() {
  await mongoose.connect(mongoUri);
  
  // Update all stuck leads globally
  const leadResult = await Lead.updateMany(
    { status: 'calling' },
    { $set: { status: 'completed' } }
  );
  
  // Update all stuck sessions globally
  const sessionResult = await CallSession.updateMany(
    { status: { $nin: ['completed', 'failed', 'canceled', 'no_answer', 'busy', 'voicemail', 'system_error'] } },
    { $set: { status: 'completed' } }
  );
  
  console.log(`Global Cleanup: Fixed ${leadResult.modifiedCount} leads from 'calling' to 'completed'.`);
  console.log(`Global Cleanup: Fixed ${sessionResult.modifiedCount} active call sessions to 'completed'.`);
  
  process.exit(0);
}

run().catch(console.error);
