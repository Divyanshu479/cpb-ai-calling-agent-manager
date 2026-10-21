import mongoose from 'mongoose';
import Campaign from '../models/Campaign.js';
import CallSession from '../models/CallSession.js';
import TelephonyConfig from '../models/TelephonyConfig.js';
import twilioService from './twilioService.js';
import callSessionService from './callSessionService.js';

const TWILIO_TO_INTERNAL_STATUS = {
  queued: 'queued',
  initiated: 'initiated',
  ringing: 'ringing',
  in_progress: 'connected',
  completed: 'completed',
  busy: 'busy',
  no_answer: 'no_answer',
  failed: 'failed',
  canceled: 'canceled',
};

class ProviderCallLogsService {
  mapTwilioStatus(status = '') {
    const normalized = String(status || '').toLowerCase().trim();
    return TWILIO_TO_INTERNAL_STATUS[normalized] || normalized || 'unknown';
  }

  buildListFilters({ status, interestLevel, dateFrom, dateTo, limit, offset }) {
    const safeLimit = Number.parseInt(limit || '50', 10);
    const safeOffset = Number.parseInt(offset || '0', 10);
    const cappedLimit = Number.isFinite(safeLimit) ? Math.min(Math.max(safeLimit, 1), 100) : 50;
    const cappedOffset = Number.isFinite(safeOffset) ? Math.max(safeOffset, 0) : 0;

    const twilioLimit = Math.min(cappedLimit + cappedOffset, 500);
    const normalizedStatus = String(status || '').trim().toLowerCase();

    return {
      status: normalizedStatus,
      interestLevel: interestLevel || '',
      dateFrom: dateFrom ? new Date(dateFrom) : null,
      dateTo: dateTo ? (() => {
        const d = new Date(dateTo);
        d.setUTCHours(23, 59, 59, 999);
        return d;
      })() : null,
      limit: cappedLimit,
      offset: cappedOffset,
      twilioLimit,
    };
  }

  buildSearchMatcher(search = '') {
    const needle = String(search || '').trim().toLowerCase();
    if (!needle) return () => true;

    return (item) => {
      const haystack = [
        item.lead?.name,
        item.lead?.phoneNumber,
        item.to,
        item.from,
        item.callSid,
        item.campaignName,
        item.managerName,
      ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');
      return haystack.includes(needle);
    };
  }

  async getActiveTelephonyConfig() {
    const telephony = await TelephonyConfig.findOne({ isActive: true }).lean();
    if (!telephony) {
      const error = new Error('No active telephony provider found');
      error.statusCode = 400;
      throw error;
    }

    return telephony;
  }

  async getActiveTwilioConfig() {
    const telephony = await this.getActiveTelephonyConfig();
    if (telephony.provider !== 'twilio') {
      const error = new Error(`Provider ${telephony.provider} is not supported for provider call logs yet`);
      error.statusCode = 400;
      throw error;
    }

    const accountSid = telephony.credentials?.accountSid;
    const authToken = telephony.credentials?.authToken;
    if (!accountSid || !authToken) {
      const error = new Error('Active Twilio configuration is missing credentials');
      error.statusCode = 400;
      throw error;
    }

    return { telephony, accountSid, authToken };
  }

  async getCampaignIdsForUser({ userId, campaignId }) {
    const ids = String(campaignId || '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => /^[a-f0-9]{24}$/i.test(value));
    if (ids.length > 0) {
      const campaigns = await Campaign.find({ _id: { $in: ids }, createdBy: userId }).select('_id');
      return campaigns.map((campaign) => campaign._id);
    }

    const campaigns = await Campaign.find({ createdBy: userId }).select('_id');
    return campaigns.map((campaign) => campaign._id);
  }

  async getCampaignIdsForAdmin({ managerId, campaignId }) {
    const ids = String(campaignId || '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => /^[a-f0-9]{24}$/i.test(value));
    if (ids.length > 0) {
      const query = { _id: { $in: ids } };
      if (managerId) query.createdBy = managerId;
      const campaigns = await Campaign.find(query).select('_id');
      return campaigns.map((campaign) => campaign._id);
    }

    if (managerId) {
      const campaigns = await Campaign.find({ createdBy: managerId }).select('_id');
      return campaigns.map((campaign) => campaign._id);
    }

    const campaigns = await Campaign.find({}).select('_id');
    return campaigns.map((campaign) => campaign._id);
  }

  normalizeCallItem({ call, session, campaignById }) {
    const campaign = session?.campaignId ? campaignById.get(String(session.campaignId)) : null;

    return {
      id: call.sid,
      callSid: call.sid,
      provider: 'twilio',
      status: this.mapTwilioStatus(call.status),
      providerStatus: call.status || '',
      duration: Number.parseInt(call.duration || '0', 10) || 0,
      direction: call.direction || '',
      from: call.from || '',
      to: call.to || '',
      createdAt: call.startTime || call.dateCreated || null,
      startedAt: call.startTime || null,
      endedAt: call.endTime || null,
      answeredBy: call.answeredBy || '',
      callPrice: call.price || '',
      priceUnit: call.priceUnit || '',
      recordingUrl: session?.metadata?.recordingUrl || '',
      lead: session?.leadId
        ? {
            id: session.leadId._id,
            name: session.leadId.name || '',
            phoneNumber: session.leadId.phoneNumber || session.leadId.phone || '',
            email: session.leadId.email || '',
            outcome: session.leadId.outcome || null,
          }
        : null,
      callOutcome: session?.callOutcome || null,
      campaignId: campaign
        ? {
            _id: campaign._id,
            name: campaign.name,
            createdBy: campaign.createdBy
              ? {
                  _id: campaign.createdBy._id,
                  name: campaign.createdBy.name,
                  email: campaign.createdBy.email,
                }
              : null,
          }
        : null,
      managerName: campaign?.createdBy?.name || '',
      campaignName: campaign?.name || '',
      aiSummary: session?.summary || session?.toolEndSummary || '',
      summary: session?.summary || '',
      endReason: session?.endReason || '',
      toolEndReason: session?.toolEndReason || '',
      extracted: session?.extracted || null,
      extractionProcessed: session?.extractor?.success === true,
      parentSessionId: session?.parentSessionId || null,
      childSessions: session?.childSessions || [],
      transcriptText: session?.transcriptText || '',
      metadata: {
        ...(session?.metadata || {}),
        sessionId: session?._id ? String(session._id) : '',
      },
    };
  }

  mapSessionStatus(status = '') {
    const normalized = String(status || '').toLowerCase().trim();
    if (normalized === 'in_progress') return 'connected';
    return normalized || 'unknown';
  }

  normalizeSessionBackedItem({ session, campaignById, provider = 'vobiz' }) {
    const campaign = session?.campaignId ? campaignById.get(String(session.campaignId)) : null;
    const lead = session?.leadId || null;
    const caller = session?.callerId || null;
    const callSid = session?.twilioCallSid || String(session?._id || '');

    return {
      id: callSid,
      _id: session?._id,
      callSid,
      provider,
      status: this.mapSessionStatus(session?.status),
      providerStatus: session?.status || '',
      duration: Number(session?.durationSeconds || 0),
      direction: 'outbound',
      from: session?.metadata?.from || '',
      to: lead?.phoneNumber || lead?.phone || session?.metadata?.to || '',
      createdAt: session?.initiatedAt || session?.createdAt || null,
      startedAt: session?.connectedAt || session?.initiatedAt || session?.createdAt || null,
      endedAt: session?.endedAt || session?.completedAt || null,
      answeredBy: '',
      callPrice: '',
      priceUnit: '',
      recordingUrl: session?.metadata?.recordingUrl || '',
      lead: lead
        ? {
            id: lead._id,
            name: lead.name || '',
            phoneNumber: lead.phoneNumber || lead.phone || '',
            email: lead.email || '',
            outcome: lead.outcome || null,
          }
        : null,
      callOutcome: session?.callOutcome || null,
      callerId: caller
        ? {
            _id: caller._id,
            name: caller.name || '',
          }
        : null,
      campaignId: campaign
        ? {
            _id: campaign._id,
            name: campaign.name,
            createdBy: campaign.createdBy
              ? {
                  _id: campaign.createdBy._id,
                  name: campaign.createdBy.name,
                  email: campaign.createdBy.email,
                }
              : null,
          }
        : null,
      managerName: campaign?.createdBy?.name || '',
      campaignName: campaign?.name || '',
      aiSummary: session?.summary || session?.toolEndSummary || '',
      summary: session?.summary || '',
      endReason: session?.endReason || '',
      toolEndReason: session?.toolEndReason || '',
      extracted: session?.extracted || null,
      extractionProcessed: session?.extractor?.success === true,
      parentSessionId: session?.parentSessionId || null,
      childSessions: session?.childSessions || [],
      transcriptText: session?.transcriptText || '',
      transcriptTurns: session?.transcriptTurns || [],
      metadata: {
        ...(session?.metadata || {}),
        sessionId: session?._id ? String(session._id) : '',
      },
    };
  }

  async listFromSessions({
    campaignIds,
    createdBy = null,
    status,
    callOutcome,
    interestLevel,
    extraction,
    callbackRequested,
    availabilityOn,
    hasAvailability,
    dateFrom,
    dateTo,
    search,
    durationOp,
    durationSeconds,
    durationSecondsTo,
    sortBy,
    sortDir,
    limit,
    offset,
    provider,
  }) {
    const safeLimit = Number.isFinite(Number(limit)) ? Math.min(Math.max(Number(limit), 1), 100) : 50;
    const safeOffset = Number.isFinite(Number(offset)) ? Math.max(Number(offset), 0) : 0;
    const query = await callSessionService.buildSessionMatch({
      campaignIds,
      createdBy,
      status,
      callOutcome,
      interestLevel,
      extraction,
      callbackRequested,
      availabilityOn,
      hasAvailability,
      dateFrom,
      dateTo,
      search,
      durationOp,
      durationSeconds,
    durationSecondsTo,
    });

    const total = await CallSession.countDocuments(query);
    const sessions = await callSessionService.pageSessions(query, {
      sortBy,
      sortDir,
      skip: safeOffset,
      limit: safeLimit,
    });
    const uniqueCampaignIds = [...new Set(sessions.map((session) => String(session.campaignId?._id || session.campaignId)).filter(Boolean))];
    const campaigns = await Campaign.find({ _id: { $in: uniqueCampaignIds } })
      .select('name createdBy')
      .populate('createdBy', 'name email')
      .lean();
    const campaignById = new Map(campaigns.map((campaign) => [String(campaign._id), campaign]));
    const pageData = sessions.map((session) => {
      const plain = typeof session.toObject === 'function' ? session.toObject() : session;
      plain.campaignId = plain.campaignId?._id || plain.campaignId;
      return this.normalizeSessionBackedItem({ session: plain, campaignById, provider });
    });

    return {
      data: pageData,
      pagination: {
        total,
        limit: safeLimit,
        offset: safeOffset,
        hasMore: safeOffset + safeLimit < total,
      },
    };
  }

  async listForCampaignManager({
    userId,
    campaignId,
    status,
    callOutcome,
    interestLevel,
    extraction,
    callbackRequested,
    availabilityOn,
    hasAvailability,
    dateFrom,
    dateTo,
    search,
    durationOp,
    durationSeconds,
    durationSecondsTo,
    sortBy,
    sortDir,
    limit,
    offset,
  }) {
    const campaignIds = await this.getCampaignIdsForUser({ userId, campaignId });

    if (campaignIds.length === 0) {
      const safeLimit = Number.isFinite(Number(limit)) ? Math.min(Math.max(Number(limit), 1), 100) : 50;
      const safeOffset = Number.isFinite(Number(offset)) ? Math.max(Number(offset), 0) : 0;
      return {
        data: [],
        pagination: { total: 0, limit: safeLimit, offset: safeOffset, hasMore: false },
      };
    }

    const telephony = await this.getActiveTelephonyConfig();
    const activeProvider = String(telephony?.provider || '').toLowerCase();

    return this.listFromSessions({
      campaignIds,
      createdBy: userId,
      status,
      callOutcome,
      interestLevel,
      extraction,
      callbackRequested,
      availabilityOn,
      hasAvailability,
      dateFrom,
      dateTo,
      search,
      durationOp,
      durationSeconds,
    durationSecondsTo,
      sortBy,
      sortDir,
      limit,
      offset,
      provider: activeProvider || 'vobiz',
    });
  }

  async listForAdmin({
    managerId,
    campaignId,
    status,
    callOutcome,
    interestLevel,
    extraction,
    callbackRequested,
    availabilityOn,
    hasAvailability,
    dateFrom,
    dateTo,
    search,
    durationOp,
    durationSeconds,
    durationSecondsTo,
    sortBy,
    sortDir,
    limit,
    offset,
  }) {
    const safeLimit = Number.isFinite(Number(limit)) ? Math.min(Math.max(Number(limit), 1), 100) : 50;
    const safeOffset = Number.isFinite(Number(offset)) ? Math.max(Number(offset), 0) : 0;
    const campaignIds = await this.getCampaignIdsForAdmin({ managerId, campaignId });

    if (campaignIds.length === 0) {
      return {
        data: [],
        pagination: { total: 0, limit: safeLimit, offset: safeOffset, hasMore: false },
      };
    }

    const telephony = await this.getActiveTelephonyConfig();
    const activeProvider = String(telephony?.provider || '').toLowerCase();

    return this.listFromSessions({
      campaignIds,
      status,
      callOutcome,
      interestLevel,
      extraction,
      callbackRequested,
      availabilityOn,
      hasAvailability,
      dateFrom,
      dateTo,
      search,
      durationOp,
      durationSeconds,
    durationSecondsTo,
      sortBy,
      sortDir,
      limit,
      offset,
      provider: activeProvider || 'vobiz',
    });
  }

  buildStats(items) {
    const byStatus = {
      completed: 0,
      failed: 0,
      no_answer: 0,
      busy: 0,
      voicemail: 0,
      queued: 0,
      initiated: 0,
      ringing: 0,
      connected: 0,
      canceled: 0,
      unknown: 0,
    };

    const extracted = {
      interested: 0,
      notInterested: 0,
      callback: 0,
    };

    let totalDuration = 0;
    for (const item of items) {
      totalDuration += Number(item.duration || 0);
      if (Object.prototype.hasOwnProperty.call(byStatus, item.status)) {
        byStatus[item.status] += 1;
      } else {
        byStatus.unknown += 1;
      }

      if (item.extracted) {
        const level = String(item.extracted.interest_level || '').toLowerCase();
        const HIGH_INTEREST = new Set(['high', '5', '6', '7', '8', '9', '10']);
        const LOW_INTEREST = new Set(['low', '1', '2', '3', '4']);
        if (HIGH_INTEREST.has(level)) {
          extracted.interested += 1;
        } else if (LOW_INTEREST.has(level)) {
          extracted.notInterested += 1;
        }
        if (item.extracted.callback_requested === true || String(item.extracted.callback_requested).toLowerCase() === 'true') {
          extracted.callback += 1;
        }
      }
    }

    return {
      byStatus,
      extracted,
      total: {
        totalCalls: items.length,
        totalDuration,
        avgDuration: items.length ? totalDuration / items.length : 0,
      },
    };
  }

  async aggregateStatsFromDB({
    campaignIds,
    createdBy = null,
    status,
    callOutcome,
    interestLevel,
    extraction,
    callbackRequested,
    availabilityOn,
    hasAvailability,
    dateFrom,
    dateTo,
    search,
    durationOp,
    durationSeconds,
    durationSecondsTo,
  }) {
    const match = await callSessionService.buildSessionMatch({
      campaignIds,
      createdBy,
      status,
      callOutcome,
      interestLevel,
      extraction,
      callbackRequested,
      availabilityOn,
      hasAvailability,
      dateFrom,
      dateTo,
      search,
      durationOp,
      durationSeconds,
    durationSecondsTo,
    });

    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: null,
          totalCalls: { $sum: 1 },
          totalDuration: { $sum: { $ifNull: ['$durationSeconds', 0] } },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          successful: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', 'completed'] },
                    {
                      $not: {
                        $in: [
                          { $ifNull: ['$callOutcome', ''] },
                          ['failed', 'system_error', 'voicemail', 'call_screening', 'ivr', 'no_answer', 'busy', 'silence_timeout', 'max_duration', 'canceled'],
                        ],
                      },
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
          failed: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $in: ['$callOutcome', ['failed', 'system_error']] },
                    {
                      $and: [
                        { $eq: [{ $ifNull: ['$callOutcome', ''] }, ''] },
                        { $eq: ['$status', 'failed'] },
                      ],
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
          no_answer: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ['$callOutcome', 'no_answer'] },
                    {
                      $and: [
                        { $eq: [{ $ifNull: ['$callOutcome', ''] }, ''] },
                        { $eq: ['$status', 'no_answer'] },
                      ],
                    },
                    {
                      $and: [
                        { $eq: [{ $ifNull: ['$callOutcome', ''] }, ''] },
                        { $in: ['$status', ['completed', 'connected']] },
                        { $lte: [{ $ifNull: ['$durationSeconds', 0] }, 0] },
                      ],
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
          busy: { $sum: { $cond: [{ $eq: ['$status', 'busy'] }, 1, 0] } },
          voicemail: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $in: ['$callOutcome', ['voicemail', 'call_screening', 'ivr']] },
                    { $eq: ['$status', 'voicemail'] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          queued: { $sum: { $cond: [{ $eq: ['$status', 'queued'] }, 1, 0] } },
          initiated: { $sum: { $cond: [{ $eq: ['$status', 'initiated'] }, 1, 0] } },
          ringing: { $sum: { $cond: [{ $eq: ['$status', 'ringing'] }, 1, 0] } },
          connected: { $sum: { $cond: [{ $eq: ['$status', 'connected'] }, 1, 0] } },
          canceled: { $sum: { $cond: [{ $eq: ['$status', 'canceled'] }, 1, 0] } },
          interested: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $in: ['$extracted.interest_level', ['high', '5', '6', '7', '8', '9', '10']] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          notInterested: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $in: ['$extracted.interest_level', ['low', '1', '2', '3', '4']] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          callback: {
            $sum: {
              $cond: [{ $eq: ['$extracted.callback_requested', true] }, 1, 0],
            },
          },
        },
      },
    ];

    const results = await CallSession.aggregate(pipeline);
    const r = results[0] || {};

    return {
      byStatus: {
        completed: r.completed || 0,
        successful: r.successful || 0,
        failed: r.failed || 0,
        no_answer: r.no_answer || 0,
        busy: r.busy || 0,
        voicemail: r.voicemail || 0,
        queued: r.queued || 0,
        initiated: r.initiated || 0,
        ringing: r.ringing || 0,
        connected: r.connected || 0,
        canceled: r.canceled || 0,
        unknown: 0,
      },
      extracted: {
        interested: r.interested || 0,
        notInterested: r.notInterested || 0,
        callback: r.callback || 0,
      },
      total: {
        totalCalls: r.totalCalls || 0,
        totalDuration: r.totalDuration || 0,
        avgDuration: r.totalCalls ? r.totalDuration / r.totalCalls : 0,
      },
    };
  }

  async statsForCampaignManager({
    userId,
    campaignId,
    status,
    callOutcome,
    interestLevel,
    extraction,
    callbackRequested,
    availabilityOn,
    hasAvailability,
    dateFrom,
    dateTo,
    search,
    durationOp,
    durationSeconds,
    durationSecondsTo,
  }) {
    const campaignIds = await this.getCampaignIdsForUser({ userId, campaignId });
    if (campaignIds.length === 0) {
      return {
        byStatus: { completed: 0, successful: 0, failed: 0, no_answer: 0, busy: 0, voicemail: 0, queued: 0, initiated: 0, ringing: 0, connected: 0, canceled: 0, unknown: 0 },
        extracted: { interested: 0, notInterested: 0, callback: 0 },
        total: { totalCalls: 0, totalDuration: 0, avgDuration: 0 },
      };
    }
    return this.aggregateStatsFromDB({
      campaignIds,
      createdBy: userId,
      status,
      callOutcome,
      interestLevel,
      extraction,
      callbackRequested,
      availabilityOn,
      hasAvailability,
      dateFrom,
      dateTo,
      search,
      durationOp,
      durationSeconds,
    durationSecondsTo,
    });
  }

  async statsForAdmin({
    managerId,
    campaignId,
    status,
    callOutcome,
    interestLevel,
    extraction,
    callbackRequested,
    availabilityOn,
    hasAvailability,
    dateFrom,
    dateTo,
    search,
    durationOp,
    durationSeconds,
    durationSecondsTo,
  }) {
    const campaignIds = await this.getCampaignIdsForAdmin({ managerId, campaignId });
    if (campaignIds.length === 0) {
      return {
        byStatus: { completed: 0, successful: 0, failed: 0, no_answer: 0, busy: 0, voicemail: 0, queued: 0, initiated: 0, ringing: 0, connected: 0, canceled: 0, unknown: 0 },
        extracted: { interested: 0, notInterested: 0, callback: 0 },
        total: { totalCalls: 0, totalDuration: 0, avgDuration: 0 },
      };
    }
    return this.aggregateStatsFromDB({
      campaignIds,
      status,
      callOutcome,
      interestLevel,
      extraction,
      callbackRequested,
      availabilityOn,
      hasAvailability,
      dateFrom,
      dateTo,
      search,
      durationOp,
      durationSeconds,
    durationSecondsTo,
    });
  }

  async getCallDetailForCampaignManager({ userId, callSid }) {
    const telephony = await this.getActiveTelephonyConfig();
    const activeProvider = String(telephony?.provider || '').toLowerCase();

    if (activeProvider !== 'twilio') {
      const sessionQuery = {
        createdBy: userId,
        $or: [{ twilioCallSid: callSid }],
      };
      if (mongoose.Types.ObjectId.isValid(callSid)) {
        sessionQuery.$or.push({ _id: callSid });
      }

      const session = await CallSession.findOne(sessionQuery)
        .populate('leadId', 'name phone phoneNumber email outcome status')
        .populate('callerId', 'name')
        .select(
          'campaignId leadId callerId summary toolEndSummary transcriptText transcriptTurns twilioCallSid metadata status durationSeconds initiatedAt connectedAt endedAt completedAt createdAt extracted endReason parentSessionId childSessions callOutcome'
        )
        .lean();

      if (!session) {
        const error = new Error('Call log not found');
        error.statusCode = 404;
        throw error;
      }

      const campaign = await Campaign.findById(session.campaignId)
        .select('name createdBy')
        .populate('createdBy', 'name email')
        .lean();

      return this.normalizeSessionBackedItem({
        session,
        campaignById: new Map(campaign ? [[String(campaign._id), campaign]] : []),
        provider: activeProvider || 'vobiz',
      });
    }

    const { accountSid, authToken } = await this.getActiveTwilioConfig();
    const call = await twilioService.getCall({ accountSid, authToken, callSid });

    const session = await CallSession.findOne({ twilioCallSid: callSid, createdBy: userId })
      .populate('leadId', 'name phone phoneNumber email outcome status')
      .select('campaignId leadId summary toolEndSummary transcriptText transcriptTurns twilioCallSid metadata status extracted endReason parentSessionId childSessions callOutcome')
      .lean();

    if (!session) {
      const error = new Error('Call log not found');
      error.statusCode = 404;
      throw error;
    }

    const campaign = await Campaign.findById(session.campaignId)
      .select('name createdBy')
      .populate('createdBy', 'name email')
      .lean();

    const normalized = this.normalizeCallItem({
      call,
      session,
      campaignById: new Map(campaign ? [[String(campaign._id), campaign]] : []),
    });

    const recordings = await twilioService.listRecordings({ accountSid, authToken, callSid, limit: 1 });
    const recording = recordings[0] || null;

    return {
      ...normalized,
      recordingUrl: recording?.mediaUrl || normalized.recordingUrl,
      recordingSid: recording?.sid || '',
      transcriptTurns: session.transcriptTurns || [],
      transcriptText: session.transcriptText || '',
    };
  }

  async getCallDetailForAdmin({ callSid }) {
    const telephony = await this.getActiveTelephonyConfig();
    const activeProvider = String(telephony?.provider || '').toLowerCase();

    if (activeProvider !== 'twilio') {
      const sessionQuery = {
        $or: [{ twilioCallSid: callSid }],
      };
      if (mongoose.Types.ObjectId.isValid(callSid)) {
        sessionQuery.$or.push({ _id: callSid });
      }

      const session = await CallSession.findOne(sessionQuery)
        .populate('leadId', 'name phone phoneNumber email outcome status')
        .populate('callerId', 'name')
        .select(
          'campaignId leadId callerId summary toolEndSummary transcriptText transcriptTurns twilioCallSid metadata status durationSeconds initiatedAt connectedAt endedAt completedAt createdAt extracted endReason parentSessionId childSessions callOutcome'
        )
        .lean();

      if (!session) {
        const error = new Error('Call log not found');
        error.statusCode = 404;
        throw error;
      }

      const campaign = await Campaign.findById(session.campaignId)
        .select('name createdBy')
        .populate('createdBy', 'name email')
        .lean();

      return this.normalizeSessionBackedItem({
        session,
        campaignById: new Map(campaign ? [[String(campaign._id), campaign]] : []),
        provider: activeProvider || 'vobiz',
      });
    }

    const { accountSid, authToken } = await this.getActiveTwilioConfig();
    const call = await twilioService.getCall({ accountSid, authToken, callSid });

    const session = await CallSession.findOne({ twilioCallSid: callSid })
      .populate('leadId', 'name phone phoneNumber email outcome status')
      .select('campaignId leadId summary toolEndSummary transcriptText transcriptTurns twilioCallSid metadata status extracted endReason parentSessionId childSessions callOutcome')
      .lean();

    if (!session) {
      const error = new Error('Call log not found');
      error.statusCode = 404;
      throw error;
    }

    const campaign = await Campaign.findById(session.campaignId)
      .select('name createdBy')
      .populate('createdBy', 'name email')
      .lean();

    const normalized = this.normalizeCallItem({
      call,
      session,
      campaignById: new Map(campaign ? [[String(campaign._id), campaign]] : []),
    });

    const recordings = await twilioService.listRecordings({ accountSid, authToken, callSid, limit: 1 });
    const recording = recordings[0] || null;

    return {
      ...normalized,
      recordingUrl: recording?.mediaUrl || normalized.recordingUrl,
      recordingSid: recording?.sid || '',
      transcriptTurns: session.transcriptTurns || [],
      transcriptText: session.transcriptText || '',
    };
  }
}

export default new ProviderCallLogsService();
