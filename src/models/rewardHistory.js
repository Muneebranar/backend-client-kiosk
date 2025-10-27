// models/RewardHistory.js
const mongoose = require("mongoose");

const rewardHistorySchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
    },
    rewardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Reward",
      required: true,
    },
    checkinId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Checkin",
      required: true,
    },
    phone: { type: String, required: true },
    status: {
      type: String,
      enum: ["Active", "Redeemed", "Expired"],
      default: "Active",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("RewardHistory", rewardHistorySchema);
