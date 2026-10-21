import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cpb-agent';
import Lead from '../src/models/Lead.js';
import DialQueueJob from '../src/models/DialQueueJob.js';

async function run() {
  await mongoose.connect(mongoUri);
  const campaignId = '69fc7d43098b8d1ef73bacdf';
  
  const activeCallsCount = await Lead.countDocuments({
    campaignId,
    status: 'calling',
  });
  
  const claimedJobsCount = await DialQueueJob.countDocuments({
    campaignId,
    status: 'claimed',
  });
  
  console.log(`Calling Leads: ${activeCallsCount}`);
  console.log(`Claimed Jobs: ${claimedJobsCount}`);
  console.log(`Total active: ${activeCallsCount + claimedJobsCount}`);
  
  process.exit(0);
}

run().catch(console.error);
