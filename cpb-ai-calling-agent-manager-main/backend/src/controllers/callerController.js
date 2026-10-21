import { AppError } from '../middleware/errorHandler.js';
import AICaller from '../models/AICaller.js';
import voicePipelineService from '../services/voicePipelineService.js';

// @desc    Get all AI callers for logged in user
// @route   GET /api/callers
// @access  Private
export const getCallers = async (req, res, next) => {
  try {
    const callers = await AICaller.find({ createdBy: req.user._id, isActive: true })
      .populate('knowledgeBaseIds', 'fileName originalName status')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: callers.length,
      data: callers
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single AI caller
// @route   GET /api/callers/:id
// @access  Private
export const getCaller = async (req, res, next) => {
  try {
    const caller = await AICaller.findOne({ _id: req.params.id, isActive: true })
      .populate('knowledgeBaseIds', 'fileName originalName status');

    if (!caller) {
      return next(new AppError('AI Caller not found', 404));
    }

    // Check ownership
    if (caller.createdBy.toString() !== req.user._id.toString()) {
      return next(new AppError('Not authorized to access this AI Caller', 403));
    }

    res.status(200).json({
      success: true,
      data: caller
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new AI caller
// @route   POST /api/callers
// @access  Private
export const createCaller = async (req, res, next) => {
  try {
    const shape = voicePipelineService.validateShape(req.body?.s2sConfig || {});
    if (!shape.valid) {
      return next(new AppError(shape.message, 400));
    }
    const callerData = {
      ...req.body,
      s2sConfig: {
        ...(req.body?.s2sConfig || {}),
        pipeline: shape.pipeline,
      },
      createdBy: req.user._id
    };

    const caller = await AICaller.create(callerData);

    res.status(201).json({
      success: true,
      data: caller
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update AI caller
// @route   PUT /api/callers/:id
// @access  Private
export const updateCaller = async (req, res, next) => {
  try {
    let caller = await AICaller.findOne({ _id: req.params.id, isActive: true });

    if (!caller) {
      return next(new AppError('AI Caller not found', 404));
    }

    // Check ownership
    if (caller.createdBy.toString() !== req.user._id.toString()) {
      return next(new AppError('Not authorized to update this AI Caller', 403));
    }

    const mergedS2sConfig = {
      ...(caller.s2sConfig?.toObject?.() || caller.s2sConfig || {}),
      ...(req.body?.s2sConfig || {}),
    };
    const shape = voicePipelineService.validateShape(mergedS2sConfig);
    if (!shape.valid) {
      return next(new AppError(shape.message, 400));
    }

    // Update caller
    const updateData = {
      ...req.body,
      s2sConfig: {
        ...mergedS2sConfig,
        pipeline: shape.pipeline,
      },
    };

    caller = await AICaller.findByIdAndUpdate(
      req.params.id,
      updateData,
      {
        new: true,
        runValidators: true
      }
    );

    res.status(200).json({
      success: true,
      data: caller
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update AI caller script
// @route   PUT /api/callers/:id/script
// @access  Private
export const updateCallerScript = async (req, res, next) => {
  try {
    const { nodes, edges } = req.body;

    const caller = await AICaller.findOne({ _id: req.params.id, isActive: true });

    if (!caller) {
      return next(new AppError('AI Caller not found', 404));
    }

    // Check ownership
    if (caller.createdBy.toString() !== req.user._id.toString()) {
      return next(new AppError('Not authorized to update this AI Caller', 403));
    }

    // Update script flow
    caller.scriptFlow = {
      nodes: nodes || [],
      edges: edges || []
    };

    await caller.save();

    res.status(200).json({
      success: true,
      data: caller
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete AI caller
// @route   DELETE /api/callers/:id
// @access  Private
export const deleteCaller = async (req, res, next) => {
  try {
    const caller = await AICaller.findOne({ _id: req.params.id, isActive: true });

    if (!caller) {
      return next(new AppError('AI Caller not found', 404));
    }

    // Check ownership
    if (caller.createdBy.toString() !== req.user._id.toString()) {
      return next(new AppError('Not authorized to delete this AI Caller', 403));
    }

    // Check if caller is being used in any campaigns
    const Campaign = (await import('../models/Campaign.js')).default;
    const campaignsUsingCaller = await Campaign.countDocuments({
      aiCallerId: caller._id,
      status: { $in: ['running', 'paused'] }
    });

    if (campaignsUsingCaller > 0) {
      return next(new AppError('Cannot delete AI Caller that is being used in active campaigns', 400));
    }

    // Soft delete by marking as inactive
    caller.isActive = false;
    await caller.save();

    res.status(200).json({
      success: true,
      message: 'AI Caller deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Test AI caller
// @route   POST /api/callers/:id/test
// @access  Private
export const testCaller = async (req, res, next) => {
  try {
    const { testInput } = req.body;

    const caller = await AICaller.findOne({ _id: req.params.id, isActive: true });

    if (!caller) {
      return next(new AppError('AI Caller not found', 404));
    }

    // Check ownership
    if (caller.createdBy.toString() !== req.user._id.toString()) {
      return next(new AppError('Not authorized to test this AI Caller', 403));
    }

    // Mock test response
    const testResponse = {
      success: true,
      message: 'Test completed successfully',
      mockTranscript: testInput || 'Hello, I am interested in your product',
      mockResponse: 'Thank you for your interest! I would love to tell you more about our amazing product...',
      mockAudioUrl: 'https://example.com/mock-audio.mp3'
    };

    res.status(200).json({
      success: true,
      data: testResponse
    });
  } catch (error) {
    next(error);
  }
};
