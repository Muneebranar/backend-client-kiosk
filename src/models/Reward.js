const mongoose = require("mongoose");

const rewardSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
    },
    phone: { type: String }, // ✅ Customer phone (undefined for template rewards)
    name: { type: String, required: true },
    description: { type: String },
    threshold: { type: Number, required: true },
    code: { type: String, unique: true, required: true },
    redeemed: { type: Boolean, default: false },
    redeemedAt: { type: Date },
    expiresAt: { type: Date },
    expiryDays: { type: Number },
    priority: { type: Number, default: 1 },
    isActive: { type: Boolean, default: true },
    
    // ✅ Discount fields
    discountType: { 
      type: String, 
      enum: ['percentage', 'fixed', 'none'], 
      default: 'none' 
    },
    discountValue: { 
      type: Number, 
      default: 0,
      min: 0 
    },
  },
  { timestamps: true }
);

// ✅ Validation: Ensure percentage discounts are between 0-100
rewardSchema.pre('save', function(next) {
  if (this.discountType === 'percentage' && this.discountValue > 100) {
    this.discountValue = 100;
  }
  if (this.discountType === 'none') {
    this.discountValue = 0;
  }
  next();
});

// ✅ Auto-delete issued rewards when a template is deleted
rewardSchema.pre("findOneAndDelete", async function (next) {
  try {
    const doc = await this.model.findOne(this.getFilter());
    // If this is a reward template (no phone field)
    if (doc && !doc.phone) {
      await mongoose.model("Reward").deleteMany({
        businessId: doc.businessId,
        name: doc.name,
        phone: { $exists: true }, // delete issued rewards only
      });
      console.log(`🧹 Deleted issued rewards for template: ${doc.name}`);
    }
  } catch (err) {
    console.error("❌ Error in reward cleanup middleware:", err);
  }
  next();
});

// ✅ Virtual to get discount display text
rewardSchema.virtual('discountDisplay').get(function() {
  if (this.discountType === 'percentage') {
    return `${this.discountValue}% off`;
  } else if (this.discountType === 'fixed') {
    return `$${this.discountValue.toFixed(2)} off`;
  }
  return 'No discount';
});

// ✅ Virtual to check if reward is expired
rewardSchema.virtual('isExpired').get(function() {
  if (!this.expiresAt) return false;
  return new Date() > this.expiresAt;
});

// ✅ Virtual to check if reward is valid (not redeemed and not expired)
rewardSchema.virtual('isValid').get(function() {
  return !this.redeemed && !this.isExpired && this.isActive;
});

// ✅ Ensure virtuals are included when converting to JSON
rewardSchema.set('toJSON', { virtuals: true });
rewardSchema.set('toObject', { virtuals: true });

// ✅ Index for faster queries
rewardSchema.index({ businessId: 1, phone: 1 });
rewardSchema.index({ businessId: 1, redeemed: 1, expiresAt: 1 });
rewardSchema.index({ code: 1 });

module.exports = mongoose.model("Reward", rewardSchema);