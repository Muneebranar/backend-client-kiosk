const mongoose = require('mongoose');
const Schema = mongoose.Schema;
// ================================================================
// models/CampaignDelivery.js
// ================================================================
const CampaignDeliverySchema = new Schema({
  campaignId: {
    type: Schema.Types.ObjectId,
    ref: 'Campaign',
    required: true,
    index: true
  },
  
  businessId: {
    type: Schema.Types.ObjectId,
    ref: 'Business',
    required: true,
    index: true
  },
  
  customerId: {
    type: Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
    index: true
  },
  
  phone: {
    type: String,
    required: true
  },
  
  message: String,
  mediaUrl: String,
  
  // Twilio tracking
  messageSid: String,
  
  status: {
    type: String,
    enum: ['pending', 'queued', 'sent', 'delivered', 'failed', 'undelivered', 'opted_out', 'invalid'],
    default: 'pending',
    index: true
  },
  
  // Twilio error codes
  errorCode: String,
  errorMessage: String,
  
  // Timestamps
  sentAt: Date,
  deliveredAt: Date,
  failedAt: Date,
  
  // Retry tracking
  retryCount: { type: Number, default: 0 },
  lastRetryAt: Date
  
}, { timestamps: true });

// Indexes for performance
CampaignDeliverySchema.index({ campaignId: 1, status: 1 });
CampaignDeliverySchema.index({ customerId: 1, campaignId: 1 });
CampaignDeliverySchema.index({ phone: 1 });
CampaignDeliverySchema.index({ messageSid: 1 });

module.exports = mongoose.model('CampaignDelivery', CampaignDeliverySchema);


