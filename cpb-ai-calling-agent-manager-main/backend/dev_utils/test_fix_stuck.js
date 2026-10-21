import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cpb-agent';
import Lead from '../src/models/Lead.js';
import CallSession from '../src/models/CallSession.js';

async function run() {
  await mongoose.connect(mongoUri);
  const campaignId = '69fc7d43098b8d1ef73bacdf';
  
  // Update leads
  const leadResult = await Lead.updateMany(
    { campaignId, status: 'calling' },
    { $set: { status: 'completed' } }
  );
  
  // Update sessions
  const sessionResult = await CallSession.updateMany(
    { campaignId, status: { $nin: ['completed', 'failed', 'canceled', 'no_answer', 'busy', 'voicemail'] } },
    { $set: { status: 'completed' } }
  );
  
  console.log(`Fixed ${leadResult.modifiedCount} leads from 'calling' to 'completed'.`);
  console.log(`Fixed ${sessionResult.modifiedCount} active call sessions to 'completed'.`);
  
  process.exit(0);
}

run().catch(console.error);
