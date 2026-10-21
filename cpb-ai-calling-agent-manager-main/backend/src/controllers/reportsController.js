import User from '../models/User.js';
import Campaign from '../models/Campaign.js';
import CallSession from '../models/CallSession.js';
import { AppError } from '../middleware/errorHandler.js';

// @desc    Get usage reports for all managers
// @route   GET /api/admin/reports/usage
// @access  Private/Admin
export const getUsageReports = async (req, res, next) => {
  try {
    const { dateFrom, dateTo, managerId } = req.query;

    // Build query for managers
    let managerQuery = { role: 'campaign_manager' };
    if (managerId) {
      managerQuery._id = managerId;
    }

    // Get all campaign managers with their limits
    const managers = await User.find(managerQuery).select('name email limits');

    // Build date filter
    const dateFilter = {};
    if (dateFrom || dateTo) {
      dateFilter.createdAt = {};
      if (dateFrom) dateFilter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) dateFilter.createdAt.$lte = new Date(dateTo);
    }

    // Get usage data for each manager
    const usageData = await Promise.all(
      managers.map(async (manager) => {
        // Get campaigns for this manager
        const campaigns = await Campaign.find({
          createdBy: manager._id,
          ...dateFilter,
        });

        // Get call sessions for this manager's campaigns
        const campaignIds = campaigns.map((c) => c._id);
        const callSessions = await CallSession.find({
          campaignId: { $in: campaignIds },
          ...dateFilter,
        }).select('status durationSeconds').lean();

        // Calculate stats
        const totalCalls = callSessions.length;
        const totalDurationSeconds = callSessions.reduce((sum, log) => sum + (log.durationSeconds || 0), 0);
        const totalMinutes = totalDurationSeconds / 60;
        const completedCalls = callSessions.filter((log) => log.status === 'completed').length;
        const failedCalls = callSessions.filter((log) => log.status === 'failed').length;

        // Calculate usage percentages
        const maxCallsLimit = manager.limits?.maxCalls || 0;
        const maxMinutesLimit = manager.limits?.maxMinutes || 0;
        const callsUsagePercent = maxCallsLimit
          ? ((totalCalls / maxCallsLimit) * 100).toFixed(2)
          : 0;
        const minutesUsagePercent = maxMinutesLimit
          ? ((totalMinutes / maxMinutesLimit) * 100).toFixed(2)
          : 0;

        return {
          managerId: manager._id,
          managerName: manager.name,
          managerEmail: manager.email,
          limits: {
            calls: maxCallsLimit,
            minutes: maxMinutesLimit,
          },
          usage: {
            totalCalls,
            totalMinutes: Math.round(totalMinutes),
            completedCalls,
            failedCalls,
            activeCampaigns: campaigns.filter((c) => c.status === 'running').length,
            totalCampaigns: campaigns.length,
          },
          usagePercent: {
            calls: parseFloat(callsUsagePercent),
            minutes: parseFloat(minutesUsagePercent),
          },
          isOverLimit: (maxCallsLimit > 0 && totalCalls > maxCallsLimit) || (maxMinutesLimit > 0 && totalMinutes > maxMinutesLimit),
        };
      })
    );

    // Calculate totals across all managers
    const totals = usageData.reduce(
      (acc, data) => ({
        totalCalls: acc.totalCalls + data.usage.totalCalls,
        totalMinutes: acc.totalMinutes + data.usage.totalMinutes,
        totalCampaigns: acc.totalCampaigns + data.usage.totalCampaigns,
        activeCampaigns: acc.activeCampaigns + data.usage.activeCampaigns,
      }),
      { totalCalls: 0, totalMinutes: 0, totalCampaigns: 0, activeCampaigns: 0 }
    );

    res.json({
      success: true,
      data: {
        managers: usageData,
        totals,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get detailed usage report for a specific manager
// @route   GET /api/admin/reports/usage/:managerId
// @access  Private/Admin
export const getManagerUsageReport = async (req, res, next) => {
  try {
    const { managerId } = req.params;
    const { dateFrom, dateTo } = req.query;

    const manager = await User.findById(managerId);
    if (!manager) {
      return next(new AppError('Manager not found', 404));
    }

    // Build date filter
    const dateFilter = {};
    if (dateFrom || dateTo) {
      dateFilter.createdAt = {};
      if (dateFrom) dateFilter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) dateFilter.createdAt.$lte = new Date(dateTo);
    }

    // Get campaigns
    const campaigns = await Campaign.find({
      createdBy: managerId,
      ...dateFilter,
    }).populate('aiCallerId', 'name');

    // Get detailed stats for each campaign
    const campaignStats = await Promise.all(
      campaigns.map(async (campaign) => {
        const sessions = await CallSession.find({
          campaignId: campaign._id,
          ...dateFilter,
        }).select('status durationSeconds').lean();

        const totalCalls = sessions.length;
        const totalDurationSeconds = sessions.reduce((sum, log) => sum + (log.durationSeconds || 0), 0);
        const totalMinutes = totalDurationSeconds / 60;
        const completedCalls = sessions.filter((log) => log.status === 'completed').length;
        const failedCalls = sessions.filter((log) => log.status === 'failed').length;

        return {
          campaignId: campaign._id,
          campaignName: campaign.name,
          status: campaign.status,
          aiCaller: campaign.aiCallerId?.name || 'N/A',
          stats: {
            totalCalls,
            totalMinutes: Math.round(totalMinutes),
            completedCalls,
            failedCalls,
            successRate:
              totalCalls > 0 ? ((completedCalls / totalCalls) * 100).toFixed(2) : 0,
          },
          createdAt: campaign.createdAt,
        };
      })
    );

    // Calculate totals
    const totalCalls = campaignStats.reduce((sum, c) => sum + c.stats.totalCalls, 0);
    const totalMinutes = campaignStats.reduce((sum, c) => sum + c.stats.totalMinutes, 0);
    const completedCalls = campaignStats.reduce((sum, c) => sum + c.stats.completedCalls, 0);

    const maxCallsLimit = manager.limits?.maxCalls || 0;
    const maxMinutesLimit = manager.limits?.maxMinutes || 0;

    res.json({
      success: true,
      data: {
        manager: {
          id: manager._id,
          name: manager.name,
          email: manager.email,
          limits: {
            calls: maxCallsLimit,
            minutes: maxMinutesLimit,
          },
        },
        summary: {
          totalCalls,
          totalMinutes,
          completedCalls,
          totalCampaigns: campaigns.length,
          activeCampaigns: campaigns.filter((c) => c.status === 'running').length,
          usagePercent: {
            calls: maxCallsLimit
              ? ((totalCalls / maxCallsLimit) * 100).toFixed(2)
              : 0,
            minutes: maxMinutesLimit
              ? ((totalMinutes / maxMinutesLimit) * 100).toFixed(2)
              : 0,
          },
        },
        campaigns: campaignStats,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get platform-wide statistics
// @route   GET /api/admin/reports/platform
// @access  Private/Admin
export const getPlatformStats = async (req, res, next) => {
  try {
    const { dateFrom, dateTo } = req.query;

    // Build date filter
    const dateFilter = {};
    if (dateFrom || dateTo) {
      dateFilter.createdAt = {};
      if (dateFrom) dateFilter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) dateFilter.createdAt.$lte = new Date(dateTo);
    }

    // Get counts
    const totalManagers = await User.countDocuments({ role: 'campaign_manager' });
    const totalCampaigns = await Campaign.countDocuments(dateFilter);
    const activeCampaigns = await Campaign.countDocuments({
      status: 'running',
      ...dateFilter,
    });
    const totalCallLogs = await CallSession.countDocuments(dateFilter);

    // Get call stats
    const callStats = await CallSession.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalDuration: { $sum: '$durationSeconds' },
        },
      },
    ]);

    // Get total duration
    const totalDuration = callStats.reduce((sum, stat) => sum + (stat.totalDuration || 0), 0);
    const totalMinutes = totalDuration / 60;

    // Format call stats
    const callsByStatus = {
      completed: 0,
      failed: 0,
      no_answer: 0,
      busy: 0,
      voicemail: 0,
    };

    callStats.forEach((stat) => {
      if (Object.prototype.hasOwnProperty.call(callsByStatus, stat._id)) {
        callsByStatus[stat._id] = stat.count;
      }
    });

    // Get campaign stats by status
    const campaignsByStatus = await Campaign.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]);

    const campaignStatusCounts = {
      draft: 0,
      running: 0,
      paused: 0,
      stopped: 0,
      completed: 0,
    };

    campaignsByStatus.forEach((stat) => {
      if (Object.prototype.hasOwnProperty.call(campaignStatusCounts, stat._id)) {
        campaignStatusCounts[stat._id] = stat.count;
      }
    });

    res.json({
      success: true,
      data: {
        overview: {
          totalManagers,
          totalCampaigns,
          activeCampaigns,
          totalCalls: totalCallLogs,
          totalMinutes: Math.round(totalMinutes),
          avgCallDuration:
            totalCallLogs > 0 ? (totalDuration / totalCallLogs).toFixed(2) : 0,
        },
        callsByStatus,
        campaignsByStatus: campaignStatusCounts,
      },
    });
  } catch (error) {
    next(error);
  }
};
