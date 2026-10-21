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
  
  // Disable it for all campaigns to prevent confusion during testing
  await Campaign.updateMany({}, {
    $unset: { 'settings.callingWindow': 1 }
  });
  
  console.log('Disabled calling window for all campaigns.');
  process.exit(0);
}

run().catch(console.error);
