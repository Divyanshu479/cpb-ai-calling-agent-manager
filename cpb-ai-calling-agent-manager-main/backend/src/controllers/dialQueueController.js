import { AppError } from '../middleware/errorHandler.js';
import dialQueueObservability from '../services/dialQueueObservability.js';
import callSessionService from '../services/callSessionService.js';

// @desc    Get queue metrics for a campaign or all campaigns
// @route   GET /api/admin/queue/metrics
// @access  Private/Admin
export const getQueueMetrics = async (req, res, next) => {
  try {
    const { campaignId } = req.query;

    if (campaignId) {
      const data = await dialQueueObservability.getCampaignQueueMetrics(campaignId);
      return res.status(200).json({ success: true, data });
    }

    const data = await dialQueueObservability.getGlobalQueueMetrics();
    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// @desc    Get global queue metrics
// @route   GET /api/admin/queue/global
// @access  Private/Admin
export const getGlobalQueueMetrics = async (req, res, next) => {
  try {
    const data = await dialQueueObservability.getGlobalQueueMetrics();
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// @desc    Get dead-letter jobs for a campaign
// @route   GET /api/admin/queue/dead-letter
// @access  Private/Admin
export const getDeadLetterJobs = async (req, res, next) => {
  try {
    const { campaignId, limit = 25, skip = 0 } = req.query;

    if (!campaignId) {
      return next(new AppError('campaignId is required', 400));
    }

    const data = await dialQueueObservability.getDeadLetterJobs(
      campaignId,
      Number.parseInt(limit, 10),
      Number.parseInt(skip, 10)
    );

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// @desc    Replay dead-letter jobs for a campaign
// @route   POST /api/admin/queue/dead-letter/replay
// @access  Private/Admin
export const replayDeadLetterJobs = async (req, res, next) => {
  try {
    const { campaignId, jobIds = [] } = req.body || {};

    if (!campaignId) {
      return next(new AppError('campaignId is required', 400));
    }

    const result = await dialQueueObservability.replayDeadLetterJobs(campaignId, jobIds);

    res.status(200).json({
      success: true,
      message: `Replayed ${result.modifiedCount || 0} dead-letter jobs`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Counts for manual post-call processing. Does not enqueue anything.
// @route   GET /api/admin/extraction/backfill
// @access  Private/Admin
// @query   since (required) e.g. "2026-10-09"
// @query   until (optional)
// @query   campaignId (optional)
export const getExtractionBackfillPreview = async (req, res, next) => {
  try {
    const { since, until, campaignId } = req.query;

    if (!since) {
      return next(new AppError('Choose the date after which calls should be processed', 400));
    }

    const result = await callSessionService.previewExtractionBackfill({
      since,
      until: until || null,
      campaignId: campaignId || null,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (error?.message && !error.statusCode) {
      return next(new AppError(error.message, 400));
    }
    next(error);
  }
};

// @desc    Live extraction queue depths, without scanning call history
// @route   GET /api/admin/extraction/queue
// @access  Private/Admin
export const getExtractionQueueStatus = async (req, res, next) => {
  try {
    res.status(200).json({
      success: true,
      data: callSessionService.getExtractionQueueStatus(),
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Queue a batch of eligible calls for post-call processing
// @route   POST /api/admin/extraction/backfill
// @access  Private/Admin
// @body    { since, until?, campaignId?, limit? }
export const triggerExtractionBackfill = async (req, res, next) => {
  try {
    const { since, until, campaignId, limit } = req.body || {};

    if (!since) {
      return next(new AppError('Choose the date after which calls should be processed', 400));
    }

    const result = await callSessionService.backfillExtractions({
      since,
      until: until || null,
      campaignId: campaignId || null,
      limit: limit ?? 500,
      dryRun: false,
    });

    res.status(200).json({
      success: true,
      message: result.enqueued > 0
        ? `Queued ${result.enqueued} call${result.enqueued === 1 ? '' : 's'} for post-call processing. ${result.remaining} eligible call${result.remaining === 1 ? '' : 's'} remain.`
        : 'No eligible calls were queued.',
      data: result,
    });
  } catch (error) {
    if (error?.message && !error.statusCode) {
      return next(new AppError(error.message, 400));
    }
    next(error);
  }
};
