  // models/PointsLedger.js
  const mongoose = require("mongoose");

  const pointsLedgerSchema = new mongoose.Schema(
    {
      businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true },
      phone: { type: String, required: true, trim: true },
      points: { type: Number, default: 0, min: 0 },
      lastCheckinAt: { type: Date, default: Date.now },
      totalCheckins: { type: Number, default: 0 },
      hasPendingReward: { type: Boolean, default: false }
    },
    { timestamps: true }
  );

  pointsLedgerSchema.index({ businessId: 1, phone: 1 }, { unique: true });

  pointsLedgerSchema.methods.addPoint = async function () {
    this.points += 1;
    this.totalCheckins += 1;
    this.lastCheckinAt = new Date();
    await this.save();
    return this;
  };

  module.exports = mongoose.model("PointsLedger", pointsLedgerSchema);
//