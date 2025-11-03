const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const CheckinLogSchema = new Schema({
  businessId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Business', 
    required: true 
  },
  
  phone: { 
    type: String, 
    required: true 
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
  }
}, { 
  timestamps: true 
});

CheckinLogSchema.index({ businessId: 1, createdAt: -1 });
CheckinLogSchema.index({ phone: 1 });

module.exports = mongoose.model('CheckinLog', CheckinLogSchema);