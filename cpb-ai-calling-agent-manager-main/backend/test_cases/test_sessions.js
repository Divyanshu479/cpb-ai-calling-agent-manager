import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cpb-agent';
import CallSession from '../src/models/CallSession.js';

async function run() {
  await mongoose.connect(mongoUri);
  
  const campaignId = '69fc7d43098b8d1ef73bacdf';
  
  const recentSessions = await CallSession.find({ campaignId })
    .sort({ createdAt: -1 })
    .limit(5)
    .select('status attemptIndex createdAt');
    
  console.log('Recent sessions:', recentSessions);
  
  process.exit(0);
}

run().catch(console.error);
