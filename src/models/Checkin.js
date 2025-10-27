const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const CheckinSchema = new Schema(
  {
    phone: { type: String, required: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },

    consentGiven: { type: Boolean, default: true },
    sentCompliance: { type: Boolean, default: false },
    pointsAwarded: { type: Number, default: 1 },

    totalCheckins: { type: Number, default: 1 }, // ✅ how many times user checked in
    lastCheckinAt: { type: Date, default: Date.now }, // ✅ timestamp of most recent check-in

    unsubscribed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// ✅ Optional: prevent duplicates in DB level
// CheckinSchema.index({ phone: 1, businessId: 1 }, { unique: true });

module.exports = mongoose.model("Checkin", CheckinSchema);
//