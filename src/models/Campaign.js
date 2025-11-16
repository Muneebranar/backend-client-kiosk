// models/Campaign.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const CampaignSchema = new Schema({
  businessId: {
    type: Schema.Types.ObjectId,
    ref: 'Business',
    required: true,
    index: true
  },
  
  createdBy: {
    type: Schema.Types.Mixed, // Supports both ObjectId and "default-admin"
    required: true
  },
  
  name: {
    type: String,
    required: true,
    trim: true
  },
  
  type: {
    type: String,
    enum: ['sms', 'mms', 'win-back'],
    default: 'sms'
  },
  
  message: {
    type: String,
    required: true,
    maxlength: 1600 // SMS limit
  },
  
  // For MMS campaigns
  mediaUrl: {
    type: String,
    default: null
  },
  
  // Audience selection
  audienceFilter: {
    type: String,
    enum: ['all', 'last_30_days', 'reward_earners', 'custom'],
    default: 'all'
  },
  
  // Custom audience criteria (if audienceFilter = 'custom')
  customCriteria: {
    tags: [String],
    minPoints: Number,
    maxPoints: Number,
    lastCheckinDays: Number
  },
  
  // Campaign scheduling
  scheduledFor: {
    type: Date,
    default: null
  },
  
  timezone: {
    type: String,
    default: 'America/New_York'
  },
  
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'sending', 'completed', 'cancelled', 'failed'],
    default: 'draft',
    index: true
  },
  
  // Win-back automation settings
  winBackSettings: {
    enabled: Boolean,
    daysInactive: Number, // Days since last checkin
    frequency: {
      type: String,
      enum: ['once', 'weekly', 'monthly'],
      default: 'once'
    }
  },
  
  // Statistics
  stats: {
    totalRecipients: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    optedOut: { type: Number, default: 0 },
    invalid: { type: Number, default: 0 },
    pending: { type: Number, default: 0 }
  },
  
  // Execution tracking
  startedAt: Date,
  completedAt: Date,
  
  // Error tracking
  errors: [{
    customerId: Schema.Types.ObjectId,
    phone: String,
    errorCode: String,
    errorMessage: String,
    timestamp: Date
  }]
  
}, { timestamps: true });

// Index for faster queries
CampaignSchema.index({ businessId: 1, status: 1 });
CampaignSchema.index({ scheduledFor: 1, status: 1 });
CampaignSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Campaign', CampaignSchema);


