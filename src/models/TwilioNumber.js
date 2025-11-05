// models/TwilioNumber.js

const mongoose = require("mongoose");

const twilioNumberSchema = new mongoose.Schema(
  {
    number: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      // Format: +12145551234
      match: /^\+1\d{10}$/,
    },
    friendlyName: {
      type: String,
      trim: true,
      default: function() {
        return this.number;
      }
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    assignedBusinesses: [{
      type: String, // Store business IDs as strings
      default: [],
    }],
    // Optional: store Twilio account SID if you have multiple accounts
    twilioAccountSid: {
      type: String,
      trim: true,
    },
    // Optional: capabilities
    capabilities: {
      voice: { type: Boolean, default: true },
      sms: { type: Boolean, default: true },
      mms: { type: Boolean, default: false },
    },
    // Optional: metadata
    metadata: {
      type: Map,
      of: String,
      default: {},
    }
  },
  { 
    timestamps: true 
  }
);

// Index for faster queries
twilioNumberSchema.index({ number: 1 });
twilioNumberSchema.index({ isActive: 1 });

// Method to check if number is assigned
twilioNumberSchema.methods.isAssigned = function() {
  return this.assignedBusinesses && this.assignedBusinesses.length > 0;
};

// Static method to get available numbers
twilioNumberSchema.statics.getAvailableNumbers = async function() {
  return this.find({ isActive: true });
};

// Pre-save hook to format number
twilioNumberSchema.pre('save', function(next) {
  if (this.isModified('number')) {
    // Ensure + prefix
    if (!this.number.startsWith('+')) {
      this.number = '+' + this.number;
    }
    
    // Remove any non-digit characters except +
    this.number = '+' + this.number.replace(/\D/g, '');
  }
  next();
});

module.exports = mongoose.model("TwilioNumber", twilioNumberSchema);