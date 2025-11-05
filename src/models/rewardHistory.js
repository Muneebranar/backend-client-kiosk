// models/RewardHistory.js
// Updated to include customerId for proper querying

const mongoose = require("mongoose");

const rewardHistorySchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      index: true // ✅ ADDED: For querying by customer
    },
    rewardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Reward",
      required: true,
    },
    checkinId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CheckinLog", // ✅ Changed from "Checkin" to "CheckinLog"
      required: true,
    },
    phone: { 
      type: String, 
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: ["Active", "Redeemed", "Expired"],
      default: "Active",
    },
  },
  { timestamps: true }
);

// ✅ Add compound indexes for efficient queries
rewardHistorySchema.index({ businessId: 1, customerId: 1 }); // ✅ ADDED
rewardHistorySchema.index({ customerId: 1, createdAt: -1 }); // ✅ ADDED

// ✅ Prevent OverwriteModelError on hot reloads (Nodemon)
module.exports =
  mongoose.models.RewardHistory ||
  mongoose.model("RewardHistory", rewardHistorySchema);