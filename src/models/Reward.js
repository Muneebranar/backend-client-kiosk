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
  },
  { timestamps: true }
);

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

module.exports = mongoose.model("Reward", rewardSchema);
