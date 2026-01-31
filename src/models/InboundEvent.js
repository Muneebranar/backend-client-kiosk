const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const InboundEventSchema = new Schema({
  checkinId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Checkin' 
  },
  businessId: { 
    type: Schema.Types.ObjectId, 
    ref: "Business",
    index: true 
  },
  // ✅ NEW: Link to customer
  customerId: {
    type: Schema.Types.ObjectId,
    ref: 'Customer',
    index: true
  },
  fromNumber: { 
    type: String, 
    required: true,
    index: true 
  },
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
  raw: Schema.Types.Mixed,
  messageSid: String,
  accountSid: String,
  status: {
    type: String,
    enum: ['received', 'processed', 'failed'],
    default: 'received'
  }
}, { 
  timestamps: true 
});

// Indexes
InboundEventSchema.index({ businessId: 1, createdAt: -1 });
InboundEventSchema.index({ customerId: 1, createdAt: -1 });
InboundEventSchema.index({ fromNumber: 1, createdAt: -1 });

// ✅ Auto-link to customer before saving
InboundEventSchema.pre('save', async function(next) {
  if (!this.customerId && this.fromNumber) {
    try {
      const Customer = mongoose.model('Customer');
      const normalizedPhone = this.fromNumber.replace(/\D/g, '');
      
      const customer = await Customer.findOne({
        phone: { $regex: normalizedPhone, $options: 'i' }
      });
      
      if (customer) {
        this.customerId = customer._id;
      }
    } catch (error) {
      console.error('❌ Error auto-linking customer:', error);
    }
  }
  next();
});

module.exports = mongoose.model('InboundEvent', InboundEventSchema);