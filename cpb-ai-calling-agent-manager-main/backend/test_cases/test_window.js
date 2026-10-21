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
  
  const campaignId = '6a4b3ac556660d1477dddc8c';
  await Campaign.findByIdAndUpdate(campaignId, {
    $unset: { 'settings.callingWindow': 1 }
  });
  
  const campaign = await Campaign.findById(campaignId);
  console.log('Status:', campaign.status);
  console.log('Calling Window:', campaign.settings.callingWindow);
  console.log('Can Accept Calls?', campaign.canAcceptCalls());
  
  process.exit(0);
}

run().catch(console.error);
