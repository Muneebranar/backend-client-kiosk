const mongoose = require("mongoose");

const checkinLogSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: false, // Optional for first-time users
    },
    phone: {
      type: String,
      required: true,
    },
    countryCode: {
      type: String,
      default: "+1",
    },
   status: {
  type: String,
  enum: ["kiosk", "checkin", "checkout", "cooldown", "api"], // ✅ Add 'api'
  required: true,
},
    pointsAwarded: {
      type: Number,
      default: 0,
    },
    metadata: {
      type: Object,
      default: {},
    },
    ipAddress: {
      type: String,
      required: false,
    },
    userAgent: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  }
);

// ✅ Index for faster queries
checkinLogSchema.index({ businessId: 1, createdAt: -1 });
checkinLogSchema.index({ customerId: 1, createdAt: -1 });
checkinLogSchema.index({ phone: 1, businessId: 1 });

module.exports = mongoose.model("CheckinLog", checkinLogSchema);