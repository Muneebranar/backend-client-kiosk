// models/PointsLedger.js
const mongoose = require("mongoose");

const pointsLedgerSchema = new mongoose.Schema(
  {
    // ✅ References
    customerId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "Customer", 
      required: true,
      index: true
    },
    businessId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "Business", 
      required: true,
      index: true
    },
    
    // ✅ Transaction Details
    type: { 
      type: String, 
      required: true,
      enum: ['earned', 'redeemed', 'adjusted', 'expired'],
      default: 'earned'
    },
    amount: { 
      type: Number, 
      required: true 
    },
    balance: { 
      type: Number, 
      required: true,
      min: 0
    },
    
    // ✅ Description
    description: { 
      type: String, 
      default: '' 
    },
    
    // ✅ Related Records
    rewardId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "Reward",
      default: null
    },
    checkinLogId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CheckinLog",
      default: null
    },
    
    // ✅ Metadata
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    
    // ✅ Timestamps
    transactionDate: {
      type: Date,
      default: Date.now
    }
  },
  { 
    timestamps: true // Adds createdAt and updatedAt
  }
);

// ✅ Indexes for performance
pointsLedgerSchema.index({ customerId: 1, createdAt: -1 });
pointsLedgerSchema.index({ businessId: 1, createdAt: -1 });
pointsLedgerSchema.index({ type: 1 });

// ✅ Instance method to record point transaction
pointsLedgerSchema.statics.recordTransaction = async function({
  customerId,
  businessId,
  type,
  amount,
  description,
  rewardId = null,
  checkinLogId = null,
  metadata = {},
  transactionDate = new Date()
}) {
  const Customer = mongoose.model('Customer');
  
  // Get current customer balance
  const customer = await Customer.findById(customerId);
  if (!customer) {
    throw new Error('Customer not found');
  }
  
  // Create ledger entry
  const entry = await this.create({
    customerId,
    businessId,
    type,
    amount,
    balance: customer.points, // Record balance AFTER transaction
    description,
    rewardId,
    checkinLogId,
    metadata,
    transactionDate,
    createdAt: transactionDate // Use transaction date for createdAt
  });
  
  return entry;
};

// ✅ Static method to get customer's transaction history
pointsLedgerSchema.statics.getCustomerHistory = async function(customerId, limit = 50) {
  return this.find({ customerId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('rewardId', 'title pointsRequired')
    .lean();
};

// ✅ Static method to get business transaction summary
pointsLedgerSchema.statics.getBusinessSummary = async function(businessId, startDate, endDate) {
  const match = { businessId };
  
  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = startDate;
    if (endDate) match.createdAt.$lte = endDate;
  }
  
  const summary = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$type',
        total: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    }
  ]);
  
  return summary;
};

module.exports = mongoose.model("PointsLedger", pointsLedgerSchema);