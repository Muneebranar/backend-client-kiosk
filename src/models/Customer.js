  // models/Customer.js
  // Updated to focus on check-ins instead of points

  const mongoose = require("mongoose");

  const customerSchema = new mongoose.Schema(
    {
      phone: {
        type: String,
        required: true,
        trim: true,
      },
      countryCode: {
        type: String,
        default: "+1",
      },
      businessId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Business",
        required: true,
      },
      subscriberStatus: {
        type: String,
        enum: ["active", "invalid", "blocked", "opted-out", "unsubscribed"],
        default: "active",
      },
      
      // ✅ CHECKINS ONLY - No points system
      totalCheckins: {
        type: Number,
        default: 0,
        min: 0
      },
      
      // ✅ Checkin tracking
      lastCheckinAt: {
        type: Date,
      },
      firstCheckinAt: {
        type: Date,
      },
      
      // Consent & verification
      consentGiven: {
        type: Boolean,
        default: false,
      },
      consentTimestamp: {
        type: Date,
      },
      ageVerified: {
        type: Boolean,
        default: false,
      },
      ageVerifiedAt: {
        type: Date,
      },
      
      // Block/unblock tracking
      blockDate: {
        type: Date,
      },
      blockReason: {
        type: String,
      },
      unblockDate: {
        type: Date,
      },
      
      // Marketing & segmentation
      marketingConsent: {
        type: Boolean,
        default: true,
        index: true
      },
      marketingConsentDate: {
        type: Date,
        default: null
      },
      
      // Invalid tracking
      isInvalid: {
        type: Boolean,
        default: false,
        index: true
      },
      invalidReason: {
        type: String,
        default: null
      },
      invalidatedAt: {
        type: Date,
        default: null
      },
      
      // Tags for campaigns
      tags: {
        type: [String],
        default: [],
        index: true
      },
      
      // Additional metadata
      metadata: {
        name: String,
        email: String,
        notes: String,
      },
      
      // Soft delete
      deleted: {
        type: Boolean,
        default: false
      },
      deletedAt: {
        type: Date
      }
    },
    {
      timestamps: true,
    }
  );

  // Compound index for phone + businessId (unique per business)
  customerSchema.index({ phone: 1, businessId: 1 }, { unique: true });
  customerSchema.index({ lastCheckinAt: 1 });
  customerSchema.index({ subscriberStatus: 1 });

  // ✅ Virtual to calculate checkins remaining until next reward
  customerSchema.virtual('checkinsUntilReward').get(function() {
    // This will be calculated based on business rewardThreshold
    // Implementation in controller
    return null;
  });

  customerSchema.set('toJSON', { virtuals: true });
  customerSchema.set('toObject', { virtuals: true });

  module.exports = mongoose.model("Customer", customerSchema);