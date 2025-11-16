// const mongoose = require("mongoose");

// const BusinessSchema = new mongoose.Schema({
//   name: { type: String, required: true },
//   country: String,
//   slug: { type: String, required: true, unique: true },
//   logo: String,
//   twilioNumber: String,
//   twilioNumberActive: { type: Boolean, default: true },

//   // ✅ FIXED: Nested ageGate object (matching your checkin code)
//   ageGate: {
//     enabled: { type: Boolean, default: false },
//     minAge: { type: Number, enum: [18, 21], default: 18 }
//   },

//   // Legacy fields (kept for backward compatibility)
//   ageGateEnabled: { type: Boolean, default: false },
//   ageGateMinimum: { type: Number, enum: [18, 21], default: 18 },

//   rewardThreshold: { type: Number, default: 10 },
//   rewardExpiryDays: { type: Number, default: 7 },
//   checkinCooldownHours: { type: Number, default: 1 },
//   maxActiveRewards: { type: Number, default: 15 },
//   welcomeMessage: { 
//     type: String, 
//     default: "Welcome! You've earned your first point!" 
//   },

//   branding: {
//     colors: {
//       primary: { type: String, default: "#3B82F6" },
//       secondary: { type: String, default: "#10B981" },
//       accent: { type: String, default: "#F59E0B" },
//     },
//   },

//   timezone: { type: String, default: "America/Chicago" },
//   isActive: { type: Boolean, default: true },
  
//   createdAt: { type: Date, default: Date.now },
//   updatedAt: { type: Date, default: Date.now },
// });

// // ✅ Update timestamp on save
// BusinessSchema.pre('save', function(next) {
//   this.updatedAt = Date.now();
//   next();
// });

// // ✅ Cascade delete related data when a business is deleted
// BusinessSchema.pre("findOneAndDelete", async function (next) {
//   try {
//     const doc = await this.model.findOne(this.getFilter());
//     if (doc) {
//       const businessId = doc._id;

//       // Delete related collections
//       await Promise.all([
//         mongoose.model("Reward").deleteMany({ businessId }),
//         mongoose.model("PointsLedger").deleteMany({ businessId }),
//         mongoose.model("Checkin").deleteMany({ businessId }),
//         mongoose.model("CheckinLog").deleteMany({ businessId }), // ✅ ADDED
//         mongoose.model("InboundEvent").deleteMany({ businessId }),
//         mongoose.model("Customer").deleteMany({ businessId }),
//         mongoose.model("RewardHistory").deleteMany({ businessId }), // ✅ ADDED
//         mongoose.model("TwilioNumber").deleteMany({ businessId }), // ✅ ADDED
//       ]);

//       console.log(`🧹 Deleted all related data for business: ${doc.name}`);
//     }
//   } catch (err) {
//     console.error("❌ Error cleaning up business data:", err);
//   }
//   next();
// });

// module.exports = mongoose.model("Business", BusinessSchema);
// models/Business.js
// Add checkinCooldownHours field to allow per-business customization

const mongoose = require("mongoose");

const businessSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    logo: { type: String },
    twilioNumber: { type: String },
    twilioNumberActive: { type: Boolean, default: true },
    
    // ✅ CUSTOMIZABLE COOLDOWN (in hours)
    checkinCooldownHours: {
      type: Number,
      default: 24, // Default: 24 hours (once per day)
      min: 0.5,    // Minimum: 30 minutes
      max: 168     // Maximum: 7 days
    },
    
    // ✅ REWARD SETTINGS (based on check-ins, not points)
    rewardThreshold: {
      type: Number,
      default: 10, // Default: 10 check-ins to earn reward
      min: 1
    },
    
    rewardExpiryDays: {
      type: Number,
      default: 30, // Rewards expire in 30 days by default
      min: 1
    },
    
    maxActiveRewards: {
      type: Number,
      default: 15,
      min: 1,
      max: 50
    },
    
    // Welcome & messaging
    welcomeMessage: {
      type: String,
      default: "Welcome! Thanks for checking in."
    },
    
    // Age gate settings
    ageGate: {
      enabled: { type: Boolean, default: false },
      minAge: { type: Number, default: 18 }
    },
    
    // Branding
    branding: {
      colors: {
        primary: { type: String, default: "#3B82F6" },
        secondary: { type: String, default: "#10B981" }
      }
    },
    
    // Timezone
    timezone: {
      type: String,
      default: "America/Chicago"
    }
  },
  { timestamps: true }
);

businessSchema.index({ slug: 1 });
businessSchema.index({ twilioNumber: 1 });

module.exports = mongoose.model("Business", businessSchema);