import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLES } from '../config/constants.js';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false
  },
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  role: {
    type: String,
    enum: Object.values(ROLES),
    required: true
  },
  limits: {
    maxCalls: {
      type: Number,
      default: 0
    },
    maxMinutes: {
      type: Number,
      default: 0
    }
  },
  usage: {
    callsUsed: {
      type: Number,
      default: 0
    },
    minutesUsed: {
      type: Number,
      default: 0
    }
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date
  }
}, {
  timestamps: true
});

// Index for faster queries
userSchema.index({ email: 1 });
userSchema.index({ role: 1 });
userSchema.index({ createdBy: 1 });

// Hash password before saving
userSchema.pre('save', async function() {
  if (!this.isModified('password')) {
    return;
  }

  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to check if user has exceeded limits
userSchema.methods.hasExceededLimits = function() {
  if (this.role === ROLES.ADMIN) {
    return false; // Admin has no limits
  }

  // Treat 0 as unlimited
  const callsExceeded = this.limits.maxCalls > 0 && this.usage.callsUsed >= this.limits.maxCalls;
  const minutesExceeded = this.limits.maxMinutes > 0 && this.usage.minutesUsed >= this.limits.maxMinutes;

  return callsExceeded || minutesExceeded;
};

// Method to increment usage
userSchema.methods.incrementUsage = async function(calls = 0, minutes = 0) {
  this.usage.callsUsed += calls;
  this.usage.minutesUsed += minutes;
  return await this.save();
};

const User = mongoose.model('User', userSchema);

export default User;
