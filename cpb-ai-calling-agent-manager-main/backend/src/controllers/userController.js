import { AppError } from '../middleware/errorHandler.js';
import User from '../models/User.js';
import { ROLES } from '../config/constants.js';

// @desc    Get all campaign managers
// @route   GET /api/admin/managers
// @access  Private/Admin
export const getManagers = async (req, res, next) => {
  try {
    const managers = await User.find({ role: ROLES.CAMPAIGN_MANAGER })
      .select('-password')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: managers.length,
      data: managers
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single manager
// @route   GET /api/admin/managers/:id
// @access  Private/Admin
export const getManager = async (req, res, next) => {
  try {
    const manager = await User.findById(req.params.id).select('-password');

    if (!manager) {
      return next(new AppError('Manager not found', 404));
    }

    if (manager.role !== ROLES.CAMPAIGN_MANAGER) {
      return next(new AppError('User is not a campaign manager', 400));
    }

    res.status(200).json({
      success: true,
      data: manager
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create campaign manager
// @route   POST /api/admin/managers
// @access  Private/Admin
export const createManager = async (req, res, next) => {
  try {
    const { email, name, limits, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return next(new AppError('User with this email already exists', 400));
    }

    // Generate random password if not provided
    const generatedPassword = password || Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10).toUpperCase() + '@1';

    // Create manager
    const manager = await User.create({
      email,
      password: generatedPassword,
      name,
      role: ROLES.CAMPAIGN_MANAGER,
      limits: {
        maxCalls: limits?.maxCalls || 1000,
        maxMinutes: limits?.maxMinutes || 500
      },
      createdBy: req.user._id
    });

    // Return manager data with temporary password (only on creation)
    const responseData = manager.toObject();
    delete responseData.password;

    res.status(201).json({
      success: true,
      data: responseData,
      credentials: {
        email: manager.email,
        temporaryPassword: generatedPassword,
        message: 'Please save these credentials. The password will not be shown again.'
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update campaign manager
// @route   PUT /api/admin/managers/:id
// @access  Private/Admin
export const updateManager = async (req, res, next) => {
  try {
    const { name, email, isActive } = req.body;

    const manager = await User.findById(req.params.id);

    if (!manager) {
      return next(new AppError('Manager not found', 404));
    }

    if (manager.role !== ROLES.CAMPAIGN_MANAGER) {
      return next(new AppError('User is not a campaign manager', 400));
    }

    // Update fields
    if (name) manager.name = name;
    if (email) manager.email = email;
    if (typeof isActive !== 'undefined') manager.isActive = isActive;

    await manager.save();

    manager.password = undefined;

    res.status(200).json({
      success: true,
      data: manager
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update manager limits
// @route   PUT /api/admin/managers/:id/limits
// @access  Private/Admin
export const updateManagerLimits = async (req, res, next) => {
  try {
    const { maxCalls, maxMinutes } = req.body;

    const manager = await User.findById(req.params.id);

    if (!manager) {
      return next(new AppError('Manager not found', 404));
    }

    if (manager.role !== ROLES.CAMPAIGN_MANAGER) {
      return next(new AppError('User is not a campaign manager', 400));
    }

    // Update limits
    if (typeof maxCalls !== 'undefined') {
      manager.limits.maxCalls = maxCalls;
    }
    if (typeof maxMinutes !== 'undefined') {
      manager.limits.maxMinutes = maxMinutes;
    }

    await manager.save();

    manager.password = undefined;

    res.status(200).json({
      success: true,
      data: manager
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete campaign manager
// @route   DELETE /api/admin/managers/:id
// @access  Private/Admin
export const deleteManager = async (req, res, next) => {
  try {
    const manager = await User.findById(req.params.id);

    if (!manager) {
      return next(new AppError('Manager not found', 404));
    }

    if (manager.role !== ROLES.CAMPAIGN_MANAGER) {
      return next(new AppError('User is not a campaign manager', 400));
    }

    // Instead of deleting, we'll deactivate
    manager.isActive = false;
    await manager.save();

    res.status(200).json({
      success: true,
      message: 'Manager deactivated successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get manager usage stats
// @route   GET /api/admin/managers/:id/usage
// @access  Private/Admin
export const getManagerUsage = async (req, res, next) => {
  try {
    const manager = await User.findById(req.params.id).select('-password');

    if (!manager) {
      return next(new AppError('Manager not found', 404));
    }

    const usageStats = {
      limits: manager.limits,
      usage: manager.usage,
      percentageUsed: {
        calls: manager.limits.maxCalls > 0
          ? (manager.usage.callsUsed / manager.limits.maxCalls * 100).toFixed(2)
          : 0,
        minutes: manager.limits.maxMinutes > 0
          ? (manager.usage.minutesUsed / manager.limits.maxMinutes * 100).toFixed(2)
          : 0
      },
      remaining: {
        calls: Math.max(0, manager.limits.maxCalls - manager.usage.callsUsed),
        minutes: Math.max(0, manager.limits.maxMinutes - manager.usage.minutesUsed)
      }
    };

    res.status(200).json({
      success: true,
      data: usageStats
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Reset manager usage
// @route   POST /api/admin/managers/:id/reset-usage
// @access  Private/Admin
export const resetManagerUsage = async (req, res, next) => {
  try {
    const manager = await User.findById(req.params.id);

    if (!manager) {
      return next(new AppError('Manager not found', 404));
    }

    manager.usage.callsUsed = 0;
    manager.usage.minutesUsed = 0;

    await manager.save();

    manager.password = undefined;

    res.status(200).json({
      success: true,
      message: 'Usage reset successfully',
      data: manager
    });
  } catch (error) {
    next(error);
  }
};
