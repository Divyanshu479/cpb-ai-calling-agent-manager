import { AppError } from '../middleware/errorHandler.js';
import Campaign from '../models/Campaign.js';
import AICaller from '../models/AICaller.js';
import { CAMPAIGN_STATUSES } from '../config/constants.js';
import callSessionService from '../services/callSessionService.js';
import campaignAutodialerService from '../services/campaignAutodialerService.js';
import voicePipelineService from '../services/voicePipelineService.js';

import CallSession from '../models/CallSession.js';
import Lead from '../models/Lead.js';
import DialQueueJob from '../models/DialQueueJob.js';

// Helper to aggregate stats dynamically from CallSessions for a list of campaigns
const getCampaignsWithAggregatedStats = async (campaigns) => {
  const campaignIds = campaigns.map(c => c._id);
  
  const statsByCampaign = await CallSession.aggregate([
    { $match: { campaignId: { $in: campaignIds } } },
    {
      $group: {
        _id: '$campaignId',
        totalCallsMade: { $sum: 1 },
        totalDuration: { $sum: { $ifNull: ['$durationSeconds', 0] } },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        interested: {
          $sum: {
            $cond: [
              { $or: [{ $in: ['$extracted.interest_level', ['high', '5', '6', '7', '8', '9', '10']] }] },
              1, 0
            ]
          }
        },
        notInterested: {
          $sum: {
            $cond: [
              { $or: [{ $in: ['$extracted.interest_level', ['low', '1', '2', '3', '4']] }] },
              1, 0
            ]
          }
        },
        callback: {
          $sum: {
            $cond: [{ $eq: ['$extracted.callback_requested', true] }, 1, 0]
          }
        }
      }
    }
  ]);

  const statsMap = new Map(statsByCampaign.map(s => [s._id.toString(), s]));

  return campaigns.map(c => {
    const campaignObj = c.toObject ? c.toObject() : c;
    const aggStats = statsMap.get(campaignObj._id.toString()) || {};
    
    campaignObj.stats = {
      ...campaignObj.stats,
      totalCallsMade: aggStats.totalCallsMade || 0,
      totalMinutesUsed: Math.ceil((aggStats.totalDuration || 0) / 60),
      completed: aggStats.completed || 0,
      failed: aggStats.failed || 0,
      interested: aggStats.interested || 0,
      notInterested: aggStats.notInterested || 0,
      callback: aggStats.callback || 0,
    };
    
    campaignObj.statistics = campaignObj.stats;
    return campaignObj;
  });
};

// @desc    Get all campaigns for logged in user
// @route   GET /api/campaigns
// @access  Private
export const getCampaigns = async (req, res, next) => {
  try {
    const campaigns = await Campaign.find({ createdBy: req.user._id })
      .populate('aiCallerId', 'name description')
      .sort({ createdAt: -1 });

    const campaignsWithStats = await getCampaignsWithAggregatedStats(campaigns);

    res.status(200).json({
      success: true,
      count: campaignsWithStats.length,
      data: campaignsWithStats
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single campaign
// @route   GET /api/campaigns/:id
// @access  Private
export const getCampaign = async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id)
      .populate('aiCallerId', 'name description callingMechanism s2sConfig')
      .populate('createdBy', 'name email');

    if (!campaign) {
      return next(new AppError('Campaign not found', 404));
    }

    // Check ownership
    if (campaign.createdBy._id.toString() !== req.user._id.toString()) {
      return next(new AppError('Not authorized to access this campaign', 403));
    }

    const campaignWithStats = (await getCampaignsWithAggregatedStats([campaign]))[0];

    res.status(200).json({
      success: true,
      data: campaignWithStats
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new campaign
// @route   POST /api/campaigns
// @access  Private
export const createCampaign = async (req, res, next) => {
  try {
    const { aiCallerId, ...campaignData } = req.body;

    // Check if AI Caller exists and belongs to user
    const aiCaller = await AICaller.findById(aiCallerId);

    if (!aiCaller) {
      return next(new AppError('AI Caller not found', 404));
    }

    if (aiCaller.createdBy.toString() !== req.user._id.toString()) {
      return next(new AppError('Not authorized to use this AI Caller', 403));
    }

    // Create campaign
    const campaign = await Campaign.create({
      ...campaignData,
      aiCallerId,
      createdBy: req.user._id
    });

    const populatedCampaign = await Campaign.findById(campaign._id)
      .populate('aiCallerId', 'name description');

    res.status(201).json({
      success: true,
      data: populatedCampaign
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update campaign
// @route   PUT /api/campaigns/:id
// @access  Private
export const updateCampaign = async (req, res, next) => {
  try {
    let campaign = await Campaign.findById(req.params.id);

    if (!campaign) {
      return next(new AppError('Campaign not found', 404));
    }

    // Check ownership
    if (campaign.createdBy.toString() !== req.user._id.toString()) {
      return next(new AppError('Not authorized to update this campaign', 403));
    }

    // Can't update running campaigns
    if (campaign.status === CAMPAIGN_STATUSES.RUNNING) {
      return next(new AppError('Cannot update a running campaign. Please pause it first.', 400));
    }

    campaign = await Campaign.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true
      }
    ).populate('aiCallerId', 'name description');

    res.status(200).json({
      success: true,
      data: campaign
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete campaign
// @route   DELETE /api/campaigns/:id
// @access  Private
export const deleteCampaign = async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);

    if (!campaign) {
      return next(new AppError('Campaign not found', 404));
    }

    // Check ownership
    if (campaign.createdBy.toString() !== req.user._id.toString()) {
      return next(new AppError('Not authorized to delete this campaign', 403));
    }

    // Can't delete running campaigns
    if (campaign.status === CAMPAIGN_STATUSES.RUNNING) {
      return next(new AppError('Cannot delete a running campaign. Please stop it first.', 400));
    }

    await campaign.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Campaign deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Start campaign
// @route   POST /api/campaigns/:id/start
// @access  Private
export const startCampaign = async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);

    if (!campaign) {
      return next(new AppError('Campaign not found', 404));
    }

    // Check ownership
    if (campaign.createdBy.toString() !== req.user._id.toString()) {
      return next(new AppError('Not authorized to start this campaign', 403));
    }

    const hasLeads = await campaignAutodialerService.hasAnyLeads(campaign._id);
    if (!hasLeads) {
      return next(new AppError('Cannot start campaign without leads', 400));
    }

    const caller = await AICaller.findOne({
      _id: campaign.aiCallerId,
      createdBy: campaign.createdBy,
      isActive: true,
    }).select('s2sConfig');
    if (!caller) {
      return next(new AppError('The campaign AI Caller is unavailable', 400));
    }
    try {
      await voicePipelineService.validateForCall(caller.s2sConfig?.toObject?.() || caller.s2sConfig || {});
    } catch (error) {
      return next(new AppError(`AI Caller configuration is not ready: ${error.message}`, error.statusCode || 400));
    }

    // Check user limits
    if (req.user.hasExceededLimits()) {
      return next(new AppError('You have exceeded your allocated limits', 403));
    }

    const isReopening =
      campaign.status === CAMPAIGN_STATUSES.STOPPED ||
      campaign.status === CAMPAIGN_STATUSES.COMPLETED;

    // Reset any orphan in-flight states from when the campaign was previously stopped or interrupted
    await Lead.updateMany(
      { campaignId: campaign._id, status: { $in: ['calling', 'queued'] } },
      { $set: { status: 'pending' } }
    );

    // If reopening a stopped or completed campaign, ensure leads are ready to be dialed
    if (isReopening) {
      campaign.completedAt = null;

      // Clear previous queue jobs for this campaign to allow fresh queue initialization
      await DialQueueJob.deleteMany({ campaignId: campaign._id });

      const pendingLeadsCount = await Lead.countDocuments({
        campaignId: campaign._id,
        status: 'pending',
      });

      // If no pending leads exist, check if there are non-converted leads (busy, no_answer, failed, exhausted) to re-dial
      if (pendingLeadsCount === 0) {
        const unreachedLeadsCount = await Lead.countDocuments({
          campaignId: campaign._id,
          status: { $in: ['no_answer', 'busy', 'failed', 'exhausted'] },
        });

        if (unreachedLeadsCount > 0) {
          await Lead.updateMany(
            { campaignId: campaign._id, status: { $in: ['no_answer', 'busy', 'failed', 'exhausted'] } },
            { $set: { status: 'pending', callAttempts: 0, nextRetryAt: null } }
          );
        } else {
          // If all leads were completed, reset all leads so the campaign can be re-run
          await Lead.updateMany(
            { campaignId: campaign._id },
            { $set: { status: 'pending', callAttempts: 0, nextRetryAt: null } }
          );
        }
      }
    }

    const wasRunning = campaign.status === CAMPAIGN_STATUSES.RUNNING;
    campaign.status = CAMPAIGN_STATUSES.RUNNING;
    campaign.startedAt = campaign.startedAt || new Date();
    campaign.runtimeAlert = {
      consecutiveFailures: 0,
      active: false,
      code: '',
      title: '',
      message: '',
      failedCount: 0,
      pausedAt: null,
      lastErrorAt: null,
    };
    campaign.markModified('runtimeAlert');

    await campaign.save();

    await campaignAutodialerService.start(
      campaign._id.toString(),
      campaign.createdBy.toString(),
      `${req.protocol}://${req.get('host')}`
    );

    res.status(200).json({
      success: true,
      message: wasRunning
        ? 'Campaign is already running'
        : isReopening
        ? 'Campaign reopened and started successfully'
        : 'Campaign started successfully',
      data: campaign
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Pause campaign
// @route   POST /api/campaigns/:id/pause
// @access  Private
export const pauseCampaign = async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);

    if (!campaign) {
      return next(new AppError('Campaign not found', 404));
    }

    // Check ownership
    if (campaign.createdBy.toString() !== req.user._id.toString()) {
      return next(new AppError('Not authorized to pause this campaign', 403));
    }

    if (campaign.status !== CAMPAIGN_STATUSES.RUNNING) {
      return next(new AppError('Only running campaigns can be paused', 400));
    }

    campaign.status = CAMPAIGN_STATUSES.PAUSED;

    await campaign.save();
    campaignAutodialerService.pause(campaign._id.toString());

    res.status(200).json({
      success: true,
      message: 'Campaign paused successfully',
      data: campaign
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Stop campaign
// @route   POST /api/campaigns/:id/stop
// @access  Private
export const stopCampaign = async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);

    if (!campaign) {
      return next(new AppError('Campaign not found', 404));
    }

    // Check ownership
    if (campaign.createdBy.toString() !== req.user._id.toString()) {
      return next(new AppError('Not authorized to stop this campaign', 403));
    }

    campaign.status = CAMPAIGN_STATUSES.STOPPED;
    campaign.completedAt = new Date();

    await campaign.save();
    campaignAutodialerService.pause(campaign._id.toString());

    res.status(200).json({
      success: true,
      message: 'Campaign stopped successfully',
      data: campaign
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get campaign statistics
// @route   GET /api/campaigns/:id/stats
// @access  Private
export const getCampaignStats = async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);

    if (!campaign) {
      return next(new AppError('Campaign not found', 404));
    }

    // Check ownership
    if (campaign.createdBy.toString() !== req.user._id.toString()) {
      return next(new AppError('Not authorized to access this campaign', 403));
    }

    const campaignWithStats = (await getCampaignsWithAggregatedStats([campaign]))[0];

    const stats = {
      ...campaignWithStats.stats,
      conversionRate: campaignWithStats.stats.totalCallsMade > 0
        ? ((campaignWithStats.stats.interested / campaignWithStats.stats.totalCallsMade) * 100).toFixed(2)
        : 0,
      completionRate: campaignWithStats.stats.totalLeads > 0
        ? ((campaignWithStats.stats.completed / campaignWithStats.stats.totalLeads) * 100).toFixed(2)
        : 0,
      averageCallDuration: campaignWithStats.stats.totalCallsMade > 0
        ? (campaignWithStats.stats.totalMinutesUsed / campaignWithStats.stats.totalCallsMade).toFixed(2)
        : 0
    };

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get campaign call sessions
// @route   GET /api/campaigns/:id/sessions
// @access  Private
export const getCampaignSessions = async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id).select('_id createdBy');

    if (!campaign) {
      return next(new AppError('Campaign not found', 404));
    }

    if (campaign.createdBy.toString() !== req.user._id.toString()) {
      return next(new AppError('Not authorized to access this campaign', 403));
    }

    const {
      status = '',
      callOutcome = '',
      interestLevel = '',
      extraction = '',
      callbackRequested = '',
      availabilityOn = '',
      hasAvailability = '',
      search = '',
      sortBy = 'createdAt',
      sortDir = 'desc',
      dateFrom = '',
      dateTo = '',
      durationOp = 'above',
      durationSeconds = '',
      durationSecondsTo = '',
      limit = 25,
      offset = 0,
    } = req.query;

    const result = await callSessionService.listCampaignSessions({
      campaignId: campaign._id,
      ownerUserId: req.user._id,
      status,
      callOutcome,
      interestLevel,
      extraction,
      callbackRequested,
      availabilityOn,
      hasAvailability,
      search,
      sortBy,
      sortDir,
      dateFrom,
      dateTo,
      durationOp,
      durationSeconds,
      durationSecondsTo,
      limit,
      offset,
    });

    res.status(200).json({
      success: true,
      data: result.sessions,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get campaign call session detail
// @route   GET /api/campaigns/:id/sessions/:sessionId
// @access  Private
export const getCampaignSessionDetail = async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id).select('_id createdBy');

    if (!campaign) {
      return next(new AppError('Campaign not found', 404));
    }

    if (campaign.createdBy.toString() !== req.user._id.toString()) {
      return next(new AppError('Not authorized to access this campaign', 403));
    }

    const sessionDetail = await callSessionService.getCampaignSessionDetail({
      campaignId: campaign._id,
      ownerUserId: req.user._id,
      sessionId: req.params.sessionId,
    });

    if (!sessionDetail) {
      return next(new AppError('Call session not found', 404));
    }

    res.status(200).json({
      success: true,
      data: sessionDetail,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all campaigns (Admin)
// @route   GET /api/admin/campaigns
// @access  Private/Admin
export const getAllCampaigns = async (req, res, next) => {
  try {
    const campaigns = await Campaign.find()
      .populate('aiCallerId', 'name')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    const campaignsWithStats = await getCampaignsWithAggregatedStats(campaigns);

    res.status(200).json({
      success: true,
      count: campaignsWithStats.length,
      data: campaignsWithStats
    });
  } catch (error) {
    next(error);
  }
};

export const getCampaignSessionsExport = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      status = '',
      callOutcome = '',
      interestLevel = '',
      extraction = '',
      callbackRequested = '',
      availabilityOn = '',
      hasAvailability = '',
      search = '',
      sortBy = 'createdAt',
      sortDir = 'desc',
      startDate = '',
      endDate = '',
      dateFrom = '',
      dateTo = '',
      durationOp = 'above',
      durationSeconds = '',
      durationSecondsTo = '',
    } = req.query;

    const campaign = await Campaign.findById(id).select('_id createdBy');
    if (!campaign) {
      return next(new AppError('Campaign not found', 404));
    }
    if (campaign.createdBy.toString() !== req.user._id.toString()) {
      return next(new AppError('Not authorized to export this campaign', 403));
    }

    const query = await callSessionService.buildSessionMatch({
      campaignId: campaign._id,
      createdBy: req.user._id,
      status,
      callOutcome,
      interestLevel,
      extraction,
      callbackRequested,
      availabilityOn,
      hasAvailability,
      search,
      dateFrom: dateFrom || startDate,
      dateTo: dateTo || endDate,
      durationOp,
      durationSeconds,
      durationSecondsTo,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="campaign_${id}_export.csv"`);
    await callSessionService.writeSessionsCsv(res, { query, sortBy, sortDir });
    res.end();
  } catch (error) {
    if (!res.headersSent) {
      next(error);
    } else {
      res.end();
    }
  }
};
