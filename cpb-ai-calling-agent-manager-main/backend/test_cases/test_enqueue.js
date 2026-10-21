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
  
  const campaignId = '69fc7d43098b8d1ef73bacdf';
  
  const count = await DialQueueJob.countDocuments({ campaignId });
  console.log(`Jobs for campaign 69fc7d43098b8d1ef73bacdf: ${count}`);
  
  const waitingCount = await DialQueueJob.countDocuments({ campaignId, status: 'waiting' });
  console.log(`Waiting jobs: ${waitingCount}`);
  
  const claimedCount = await DialQueueJob.countDocuments({ campaignId, status: 'claimed' });
  console.log(`Claimed jobs: ${claimedCount}`);
  
  process.exit(0);
}

run().catch(console.error);
