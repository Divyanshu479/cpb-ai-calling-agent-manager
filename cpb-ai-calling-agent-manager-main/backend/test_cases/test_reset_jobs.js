import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cpb-agent';
import DialQueueJob from '../src/models/DialQueueJob.js';

async function run() {
  await mongoose.connect(mongoUri);
  
  const campaignId = '6a4b3ac556660d1477dddc8c';
  
  // Re-enqueue all waiting jobs that were stuck
  const result = await DialQueueJob.updateMany(
    { campaignId, status: { $in: ['waiting', 'queue_tail'] } },
    { $set: { status: 'waiting', nextEligibleAt: new Date(), leaseOwner: null, leaseExpiresAt: null } }
  );
  
  console.log(`Reset ${result.modifiedCount} jobs to waiting state so they get picked up instantly`);
  
  process.exit(0);
}

run().catch(console.error);
