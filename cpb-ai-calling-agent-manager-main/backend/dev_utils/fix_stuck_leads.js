import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cpb-agent';

async function run() {
  try {
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB.');

    const Lead = mongoose.model('Lead', new mongoose.Schema({}, { strict: false }));
    const DialQueueJob = mongoose.model('DialQueueJob', new mongoose.Schema({}, { strict: false }));

    // Find all leads stuck in 'calling' state
    const stuckLeads = await Lead.find({ status: 'calling' }).toArray ? await Lead.find({ status: 'calling' }).toArray() : await Lead.find({ status: 'calling' });

    console.log(`Found ${stuckLeads.length} leads currently stuck in 'calling' state.`);

    if (stuckLeads.length === 0) {
      console.log('No stale data to clean up. Exiting.');
      process.exit(0);
    }

    const stuckLeadIds = stuckLeads.map(lead => lead._id);

    // Update leads to 'completed'
    const leadUpdateResult = await Lead.updateMany(
      { _id: { $in: stuckLeadIds } },
      { $set: { status: 'completed' } }
    );

    console.log(`Successfully updated ${leadUpdateResult.modifiedCount} leads from 'calling' to 'completed'.`);

    // We should also make sure any DialQueueJobs for these leads aren't permanently holding a 'claimed' status 
    // with no leaseOwner (the other ghost data we saw earlier).
    const jobUpdateResult = await DialQueueJob.updateMany(
      { leadId: { $in: stuckLeadIds }, status: 'claimed' },
      { $set: { status: 'completed', leaseOwner: null, leaseExpiresAt: null } }
    );

    console.log(`Successfully cleaned up ${jobUpdateResult.modifiedCount} ghost DialQueueJobs.`);

    console.log('Stale data cleanup complete!');
  } catch (error) {
    console.error('Error during cleanup:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();
