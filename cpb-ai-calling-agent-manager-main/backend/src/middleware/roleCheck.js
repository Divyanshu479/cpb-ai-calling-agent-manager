import { AppError } from './errorHandler.js';
import { ROLES } from '../config/constants.js';

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Not authorized', 401));
    }

    if (!roles.includes(req.user.role)) {
      return next(new AppError(`Role ${req.user.role} is not authorized to access this route`, 403));
    }

    next();
  };
};

export const isAdmin = authorize(ROLES.ADMIN);
export const isCampaignManager = authorize(ROLES.CAMPAIGN_MANAGER);
export const isAdminOrManager = authorize(ROLES.ADMIN, ROLES.CAMPAIGN_MANAGER);
