import jwt from 'jsonwebtoken';
import { AppError } from './errorHandler.js';
import User from '../models/User.js';

export const protect = async (req, res, next) => {
  try {
    let token;

    // Check for token in headers
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return next(new AppError(`Not authorized to access this route ${req.originalUrl}`, 401));
    }

    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Get user from token
      req.user = await User.findById(decoded.id).select('-password');

      if (!req.user) {
        return next(new AppError('User not found', 404));
      }

      if (!req.user.isActive) {
        return next(new AppError('User account is inactive', 403));
      }

      next();
    } catch (error) {
      return next(new AppError(`Not authorized to access this route ${req.originalUrl}`, 401));
    }
  } catch (error) {
    next(error);
  }
};
