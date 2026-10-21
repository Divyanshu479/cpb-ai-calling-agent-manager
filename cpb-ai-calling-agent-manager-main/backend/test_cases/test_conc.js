import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cpb-agent';
import Campaign from '../src/models/Campaign.js';

async function run() {
  await mongoose.connect(mongoUri);
  
  const campaign = await Campaign.findById('69fc7d43098b8d1ef73bacdf');
  console.log('Max Concurrency:', campaign.settings?.maxConcurrentCalls);
  
  process.exit(0);
}

run().catch(console.error);
