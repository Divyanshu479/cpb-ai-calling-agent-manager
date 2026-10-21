import Campaign from '../models/Campaign.js';
import { AppError } from '../middleware/errorHandler.js';
import providerCallLogsService from '../services/providerCallLogsService.js';
import callSessionService from '../services/callSessionService.js';

const providerCache = new Map();

const getProviderCacheTtlMs = () => {
  const raw = Number.parseInt(process.env.PROVIDER_CALL_LOGS_CACHE_TTL_MS || '15000', 10);
  if (Number.isFinite(raw) && raw >= 0) {
    return raw;
  }
  return 15000;
};

const buildProviderCacheKey = (scope, req) => {
  const query = req.query || {};
  const queryKey = Object.keys(query)
    .sort()
    .map((key) => `${key}:${String(query[key])}`)
    .join('|');
  return `${scope}|user:${req.user?._id || ''}|${queryKey}`;
};

const getCachedProviderResponse = async (key, resolver) => {
  const ttlMs = getProviderCacheTtlMs();
  if (ttlMs === 0) {
    return resolver();
  }

  const now = Date.now();
  const cached = providerCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = await resolver();

  providerCache.set(key, {
    value,
    expiresAt: now + ttlMs,
  });

  if (providerCache.size > 500) {
    for (const [cacheKey, entry] of providerCache.entries()) {
      if (entry.expiresAt <= now) {
        providerCache.delete(cacheKey);
      }
    }
  }

  return value;
};

// @desc    Get provider-backed call logs for campaign manager
// @route   GET /api/call-logs/provider
// @access  Private/CampaignManager
export const getProviderCallLogs = async (req, res, next) => {
  try {
    const {
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
      limit = 50,
      offset = 0,
    } = req.query;

    const cacheKey = buildProviderCacheKey('cm-list', req);
    const result = await getCachedProviderResponse(cacheKey, () =>
      providerCallLogsService.listForCampaignManager({
        userId: req.user._id,
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
      })
    );

    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get provider-backed call logs stats for campaign manager
// @route   GET /api/call-logs/provider/stats
// @access  Private/CampaignManager
export const getProviderCallLogsStats = async (req, res, next) => {
  try {
    const {
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
    } = req.query;

    const cacheKey = buildProviderCacheKey('cm-stats', req);
    const stats = await getCachedProviderResponse(cacheKey, () =>
      providerCallLogsService.statsForCampaignManager({
        userId: req.user._id,
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
      })
    );

    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
};

// @desc    Download the call logs that match the current filters
// @route   GET /api/call-logs/provider/export
// @access  Private/CampaignManager
export const exportProviderCallLogs = async (req, res, next) => {
  try {
    const {
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
    } = req.query;

    const campaignIds = await providerCallLogsService.getCampaignIdsForUser({
      userId: req.user._id,
      campaignId,
    });
    if (campaignIds.length === 0) {
      return next(new AppError('No campaigns found for this export', 404));
    }

    const query = await callSessionService.buildSessionMatch({
      campaignIds,
      createdBy: req.user._id,
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

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="call_logs_export.csv"');
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

// @desc    Get provider-backed call log detail for campaign manager
// @route   GET /api/call-logs/provider/:callSid
// @access  Private/CampaignManager
export const getProviderCallLog = async (req, res, next) => {
  try {
    const detail = await providerCallLogsService.getCallDetailForCampaignManager({
      userId: req.user._id,
      callSid: req.params.callSid,
    });

    res.json({ success: true, data: detail });
  } catch (error) {
    next(error);
  }
};

// @desc    Get provider-backed call logs (Admin)
// @route   GET /api/admin/provider-call-logs
// @access  Private/Admin
export const getProviderCallLogsAdmin = async (req, res, next) => {
  try {
    const {
      managerId,
      campaignId,
      status,
      dateFrom,
      dateTo,
      search,
      limit = 50,
      offset = 0,
    } = req.query;

    const cacheKey = buildProviderCacheKey('admin-list', req);
    const result = await getCachedProviderResponse(cacheKey, () =>
      providerCallLogsService.listForAdmin({
        managerId,
        campaignId,
        status,
        dateFrom,
        dateTo,
        search,
        limit,
        offset,
      })
    );

    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get provider-backed call logs stats (Admin)
// @route   GET /api/admin/provider-call-logs/stats
// @access  Private/Admin
export const getProviderCallLogsStatsAdmin = async (req, res, next) => {
  try {
    const { managerId, campaignId, status, dateFrom, dateTo, search } = req.query;

    const cacheKey = buildProviderCacheKey('admin-stats', req);
    const stats = await getCachedProviderResponse(cacheKey, () =>
      providerCallLogsService.statsForAdmin({
        managerId,
        campaignId,
        status,
        dateFrom,
        dateTo,
        search,
      })
    );

    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
};

// @desc    Get provider-backed call log detail (Admin)
// @route   GET /api/admin/provider-call-logs/:callSid
// @access  Private/Admin
export const getProviderCallLogAdmin = async (req, res, next) => {
  try {
    const detail = await providerCallLogsService.getCallDetailForAdmin({
      callSid: req.params.callSid,
    });

    res.json({ success: true, data: detail });
  } catch (error) {
    next(error);
  }
};
