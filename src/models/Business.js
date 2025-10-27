const mongoose = require("mongoose");



const BusinessSchema = new mongoose.Schema({
  name: { type: String, required: true },
  country: String,
  slug: { type: String, required: true, unique: true },
  logo: String,
  twilioNumber: String,

  rewardThreshold: { type: Number, default: 10 },
  rewardExpiryDays: { type: Number, default: 7 },
  checkinCooldownHours: { type: Number, default: 1 },
  maxActiveRewards: { type: Number, default: 15 },
  welcomeMessage: { type: String, default: "Welcome! You've earned your first point!" },


  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  // Add after twilioNumber field
twilioNumberActive: { type: Boolean, default: true },

// Add after welcomeMessage field
ageGateEnabled: { type: Boolean, default: false },
ageGateMinimum: { type: Number, enum: [18, 21], default: 18 },

branding: {
  colors: {
    primary: { type: String, default: "#3B82F6" },
    secondary: { type: String, default: "#10B981" },
    accent: { type: String, default: "#F59E0B" },
  },
},

timezone: { type: String, default: "America/Chicago" },
isActive: { type: Boolean, default: true },
});
// ✅ Cascade delete related data when a business is deleted
BusinessSchema.pre("findOneAndDelete", async function (next) {
  try {
    const doc = await this.model.findOne(this.getFilter());
    if (doc) {
      const businessId = doc._id;

      // Delete related collections
      await Promise.all([
        mongoose.model("Reward").deleteMany({ businessId }),
        mongoose.model("PointsLedger").deleteMany({ businessId }),
        mongoose.model("Checkin").deleteMany({ businessId }),
        mongoose.model("InboundEvent").deleteMany({ businessId }),
        mongoose.model("Customer").deleteMany({ businessId }),
      ]);

      console.log(`🧹 Deleted all related data for business: ${doc.name}`);
    }
  } catch (err) {
    console.error("❌ Error cleaning up business data:", err);
  }
  next();
});

module.exports = mongoose.model("Business", BusinessSchema);
