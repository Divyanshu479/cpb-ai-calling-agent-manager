import express from 'express';
import { login, getMe, logout, refresh, changePassword } from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.post('/login', authLimiter, login);
router.get('/me', protect, getMe);
router.post('/logout', protect, logout);
router.post('/refresh', refresh);
router.post('/change-password', protect, changePassword);

export default router;
