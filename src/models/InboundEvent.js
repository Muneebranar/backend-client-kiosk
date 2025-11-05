// models/InboundEvent.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const InboundEventSchema = new Schema({
  checkinId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Checkin' 
  },
  businessId: { 
    type: Schema.Types.ObjectId, 
    ref: "Business" 
  },
  
  // ✅ Who sent the message (customer phone)
  fromNumber: { 
    type: String, 
    required: true,
    index: true 
  },
  
  // ✅ Which Twilio number received it (your business number)
  toNumber: { 
    type: String, 
    required: true,
    index: true 
  },
  
  body: String,
  eventType: { 
    type: String, 
    default: 'INBOUND_SMS' 
  },
  
  // Store raw Twilio webhook data for debugging
  raw: Schema.Types.Mixed,
  
  // Additional useful fields
  messageSid: String, // Twilio's unique message ID
  accountSid: String,  // Twilio account ID
  status: {
    type: String,
    enum: ['received', 'processed', 'failed'],
    default: 'received'
  }
}, { 
  timestamps: true 
});

// Index for faster queries
InboundEventSchema.index({ businessId: 1, createdAt: -1 });
InboundEventSchema.index({ fromNumber: 1, createdAt: -1 });
InboundEventSchema.index({ toNumber: 1, createdAt: -1 });

module.exports = mongoose.model('InboundEvent', InboundEventSchema);