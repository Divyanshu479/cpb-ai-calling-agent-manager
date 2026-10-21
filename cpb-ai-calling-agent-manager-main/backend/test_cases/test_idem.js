import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cpb-agent';
import CallSession from '../src/models/CallSession.js';
import Lead from '../src/models/Lead.js';
import DialQueueJob from '../src/models/DialQueueJob.js';

async function run() {
  await mongoose.connect(mongoUri);
  
  const leadId = '6a4c92709a9384c1c1469e3a';
  
  const lead = await Lead.findById(leadId);
  console.log('Lead:', lead ? { status: lead.status, retryCount: lead.retryCount } : null);
  
  const sessions = await CallSession.find({ leadId }).select('attemptIndex status');
  console.log('Sessions:', sessions);
  
  const jobs = await DialQueueJob.find({ leadId }).select('attemptCount status lastError');
  console.log('Jobs:', jobs);
  
  process.exit(0);
}

run().catch(console.error);
