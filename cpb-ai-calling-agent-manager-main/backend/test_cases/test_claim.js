import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cpb-agent';
import dialQueueService from '../src/services/dialQueueService.js';

async function run() {
  await mongoose.connect(mongoUri);
  
  const campaignId = '6a4b3ac556660d1477dddc8c';
  
  try {
    const job = await dialQueueService.claimNextJob(
      'test-worker-1',
      campaignId,
      2
    );
    
    console.log('Claimed Job:', job ? job._id : 'null');
    if (job) {
      console.log('Job details:', job);
      // Revert it
      await mongoose.connection.db.collection('dialqueuejobs').updateOne(
        { _id: job._id },
        { $set: { status: 'waiting', leaseOwner: null, leaseExpiresAt: null } }
      );
    }
  } catch (err) {
    console.error('Error:', err);
  }

  process.exit(0);
}

run().catch(console.error);
