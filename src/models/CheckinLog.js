// models/CheckinLog.js
// Updated to include customerId for proper querying

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const CheckinLogSchema = new Schema({
  businessId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Business', 
    required: true,
    index: true
  },
  
  customerId: {
    type: Schema.Types.ObjectId,
    ref: 'Customer',
    index: true // ✅ ADDED: For querying by customer
  },
  
  phone: { 
    type: String, 
    required: true,
    index: true
  },
  
  countryCode: { 
    type: String, 
    default: '+1' 
  },
  
  status: {
    type: String,
    enum: ['manual', 'kiosk', 'api'],
    default: 'kiosk'
  },
  
  addedBy: { 
    type: Schema.Types.ObjectId, 
    ref: 'AdminUser' 
  },
  
  pointsAwarded: { 
    type: Number, 
    default: 1 
  },

  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { 
  timestamps: true 
});

// ✅ Add compound indexes for efficient queries
CheckinLogSchema.index({ businessId: 1, createdAt: -1 });
CheckinLogSchema.index({ phone: 1 });
CheckinLogSchema.index({ customerId: 1, createdAt: -1 }); // ✅ ADDED
CheckinLogSchema.index({ businessId: 1, customerId: 1 }); // ✅ ADDED

module.exports = mongoose.model('CheckinLog', CheckinLogSchema);