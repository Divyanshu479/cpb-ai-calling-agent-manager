import mongoose from 'mongoose';
import TelephonyConfig from '../models/TelephonyConfig.js';
import Integration from '../models/Integration.js';
import User from '../models/User.js';

export async function migrateTelephonyConfigs() {
  try {
    // 1. Check if telephony integrations already exist in Integration collection
    const telephonyCount = await Integration.countDocuments({ type: 'telephony' });
    if (telephonyCount > 0) {
      console.log('[Migration] Telephony integrations already present in Integration collection. Skipping migration.');
      return;
    }

    // 2. Fetch active TelephonyConfig
    const oldConfig = await TelephonyConfig.findOne({ isActive: true });
    if (!oldConfig) {
      console.log('[Migration] No active legacy TelephonyConfig found. Skipping migration.');
      return;
    }

    console.log('[Migration] Found legacy TelephonyConfig for provider:', oldConfig.provider);

    // Find a system user (preferably admin) to associate with createdBy
    let creator = await User.findOne({ role: 'admin' });
    if (!creator) {
      creator = await User.findOne({});
    }

    if (!creator) {
      console.warn('[Migration] No user found in database to associate with migration. Cannot migrate telephony config.');
      return;
    }

    const provider = String(oldConfig.provider || 'twilio').toLowerCase();
    const credentials = oldConfig.credentials || {};

    // Determine credential fields mapping
    let username = '';
    let password = '';
    let apiBaseUrl = oldConfig.apiBaseUrl || credentials.apiBaseUrl || '';

    if (provider === 'twilio') {
      username = credentials.accountSid || '';
      password = credentials.authToken || '';
      if (!apiBaseUrl) apiBaseUrl = 'https://api.twilio.com';
    } else if (provider === 'vobiz') {
      username = credentials.authId || '';
      password = credentials.authToken || '';
      if (!apiBaseUrl) apiBaseUrl = 'https://api.vobiz.ai/api/v1';
    } else {
      username = credentials.authId || credentials.apiKey || credentials.sid || '';
      password = credentials.authToken || credentials.apiToken || '';
    }

    const metadata = {
      provider,
      callerIds: oldConfig.callerIds && oldConfig.callerIds.length > 0
        ? oldConfig.callerIds
        : (oldConfig.callerId ? [oldConfig.callerId] : []),
      settings: oldConfig.settings || {
        recordCalls: true,
        recordingFormat: 'mp3',
        maxCallDuration: 600,
      },
      streamWsUrl: credentials.streamWsUrl || '',
      apiBaseUrl: apiBaseUrl || '',
    };

    const newIntegration = new Integration({
      name: `System Default ${provider.toUpperCase()}`,
      type: 'telephony',
      description: `Migrated default telephony configuration for ${provider}`,
      baseUrl: apiBaseUrl || 'https://api.vobiz.ai/api/v1',
      authType: provider === 'twilio' ? 'basic_auth' : 'custom_header',
      authConfig: {
        username,
        password,
      },
      isActive: true,
      isDefault: true,
      createdBy: creator._id,
      metadata,
    });

    await newIntegration.save();
    console.log(`[Migration] Successfully migrated legacy TelephonyConfig to Integration model (ID: ${newIntegration._id})`);
  } catch (error) {
    console.error('[Migration] Error migrating telephony configuration:', error);
  }
}
