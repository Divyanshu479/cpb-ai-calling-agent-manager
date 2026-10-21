import mongoose from 'mongoose';
import { CAMPAIGN_STATUSES } from '../config/constants.js';

const campaignSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Campaign name is required'],
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  product: {
    type: String,
    trim: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  aiCallerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AICaller',
    required: [true, 'AI Caller is required']
  },
  settings: {
    concurrencyLimit: {
      type: Number,
      default: 6,
      min: 1,
      max: 100
    },
    maxCallDuration: {
      type: Number, // in seconds
      default: 180,
      min: 30,
      max: 3600
    },
    retryGap: {
      type: Number, // in minutes
      default: 120,
      min: 0
    },
    maxRetries: {
      type: Number,
      default: 3,
      min: 0,
      max: 10
    },
    retryMode: {
      type: String,
      enum: ['queue_tail', 'backoff'],
      default: 'queue_tail', // Queue tail: immediate re-enqueue on retryable failures
    },
    callingWindow: {
      startTime: {
        type: String, // HH:mm format
        default: '09:00'
      },
      endTime: {
        type: String, // HH:mm format
        default: '18:00'
      },
      timezone: {
        type: String,
        default: 'Asia/Kolkata'
      },
      daysOfWeek: {
        type: [Number], // 0-6 (Sun-Sat)
        default: [1, 2, 3, 4, 5] // Mon-Fri
      }
    }
  },
  status: {
    type: String,
    enum: Object.values(CAMPAIGN_STATUSES),
    default: CAMPAIGN_STATUSES.DRAFT,
    index: true
  },
  stats: {
    totalLeads: {
      type: Number,
      default: 0
    },
    completed: {
      type: Number,
      default: 0
    },
    interested: {
      type: Number,
      default: 0
    },
    notInterested: {
      type: Number,
      default: 0
    },
    callback: {
      type: Number,
      default: 0
    },
    noAnswer: {
      type: Number,
      default: 0
    },
    voicemail: {
      type: Number,
      default: 0
    },
    totalCallsMade: {
      type: Number,
      default: 0
    },
    totalMinutesUsed: {
      type: Number,
      default: 0
    }
  },
  customFields: [{
    name: {
      type: String,
      required: true
    },
    mappedFrom: {
      type: String,
      required: true
    }
  }],
  runtimeAlert: {
    consecutiveFailures: { type: Number, default: 0 },
    active: { type: Boolean, default: false },
    code: { type: String, default: '' },
    title: { type: String, default: '' },
    message: { type: String, default: '' },
    failedCount: { type: Number, default: 0 },
    pausedAt: { type: Date, default: null },
    lastErrorAt: { type: Date, default: null },
  },
  startedAt: {
    type: Date
  },
  completedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes
campaignSchema.index({ createdBy: 1, createdAt: -1 });
campaignSchema.index({ status: 1 });
campaignSchema.index({ createdBy: 1, status: 1 });

// Method to check if campaign is within its configured calling window
campaignSchema.methods.isWithinCallingWindow = function() {
  const window = this.settings?.callingWindow;
  if (!window) return true;

  const timezone = window.timezone || 'Asia/Kolkata';
  const days = Array.isArray(window.daysOfWeek) ? window.daysOfWeek : [1, 2, 3, 4, 5];
  const startTime = typeof window.startTime === 'string' ? window.startTime : '09:00';
  const endTime = typeof window.endTime === 'string' ? window.endTime : '18:00';

  const parseTime = (hhmm) => {
    const [hh, mm] = String(hhmm).split(':').map((value) => Number.parseInt(value, 10));
    const hour = Number.isFinite(hh) ? hh : 0;
    const minute = Number.isFinite(mm) ? mm : 0;
    return hour * 60 + minute;
  };

  const now = new Date();
  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);

  const weekdayToken = dateParts.find((part) => part.type === 'weekday')?.value || 'Mon';
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = weekdayMap[weekdayToken] ?? 1;

  if (!days.includes(dayOfWeek)) {
    return false;
  }

  const hour = Number.parseInt(dateParts.find((part) => part.type === 'hour')?.value || '0', 10);
  const minute = Number.parseInt(dateParts.find((part) => part.type === 'minute')?.value || '0', 10);
  const currentMinutes = hour * 60 + minute;
  const startMinutes = parseTime(startTime);
  const endMinutes = parseTime(endTime);

  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
};

// Method to check if campaign can accept new calls
campaignSchema.methods.canAcceptCalls = function() {
  return this.status === CAMPAIGN_STATUSES.RUNNING && this.isWithinCallingWindow();
};

// Method to increment stats
campaignSchema.methods.incrementStats = async function(outcome, duration = 0) {
  this.stats.totalCallsMade += 1;
  this.stats.totalMinutesUsed += Math.ceil(duration / 60);

  switch(outcome) {
    case 'interested':
      this.stats.interested += 1;
      this.stats.completed += 1;
      break;
    case 'not_interested':
      this.stats.notInterested += 1;
      this.stats.completed += 1;
      break;
    case 'callback':
      this.stats.callback += 1;
      this.stats.completed += 1;
      break;
    case 'no_answer':
      this.stats.noAnswer += 1;
      break;
    case 'voicemail':
      this.stats.voicemail += 1;
      break;
  }

  return await this.save();
};

const Campaign = mongoose.model('Campaign', campaignSchema);

export default Campaign;
