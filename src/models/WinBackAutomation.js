
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// ================================================================
// models/WinBackAutomation.js
// ================================================================
const WinBackAutomationSchema = new Schema({
  businessId: {
    type: Schema.Types.ObjectId,
    ref: 'Business',
    required: true,
    unique: true // One per business
  },
  
  enabled: {
    type: Boolean,
    default: false
  },
  
  daysInactive: {
    type: Number,
    default: 30,
    min: 7,
    max: 365
  },
  
  message: {
    type: String,
    required: true,
    maxlength: 1600
  },
  
  frequency: {
    type: String,
    enum: ['once', 'weekly', 'monthly'],
    default: 'once'
  },
  
  // Time to send (in business timezone)
  sendTime: {
    type: String,
    default: '10:00' // Format: "HH:MM"
  },
  
  timezone: {
    type: String,
    default: 'America/New_York'
  },
  
  // Tracking
  lastRunAt: Date,
  nextRunAt: Date,
  
  stats: {
    totalSent: { type: Number, default: 0 },
    totalDelivered: { type: Number, default: 0 },
    totalFailed: { type: Number, default: 0 }
  }
  
}, { timestamps: true });

module.exports = mongoose.model('WinBackAutomation', WinBackAutomationSchema);