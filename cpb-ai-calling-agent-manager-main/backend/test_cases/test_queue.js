import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cpb-agent';

async function run() {
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;
  
  const campaignId = '6a4b3ac556660d1477dddc8c';
  
  const jobs = await db.collection('dialqueuejobs').find({ 
    campaignId: new mongoose.Types.ObjectId(campaignId)
  }).toArray();
  
  console.log(`Total jobs for campaign: ${jobs.length}`);
  const statusCounts = {};
  for (const job of jobs) {
    statusCounts[job.status] = (statusCounts[job.status] || 0) + 1;
  }
  console.log('Status counts:', statusCounts);
  
  const claimedJobs = jobs.filter(j => j.status === 'claimed');
  console.log(`Claimed jobs length: ${claimedJobs.length}`);
  if (claimedJobs.length > 0) {
    console.log('First 2 claimed jobs:', claimedJobs.slice(0, 2));
  }
  
  const waitingJobs = jobs.filter(j => j.status === 'waiting');
  console.log(`Waiting jobs length: ${waitingJobs.length}`);
  if (waitingJobs.length > 0) {
    console.log('First waiting job:', waitingJobs[0]);
  }

  process.exit(0);
}

run().catch(console.error);
