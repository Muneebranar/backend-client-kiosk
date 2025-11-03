// const mongoose = require('mongoose');
// const Schema = mongoose.Schema;

// const CustomerSchema = new Schema({
//   businessId: { 
//     type: Schema.Types.ObjectId, 
//     ref: 'Business', 
//     required: true 
//   },
  
//   phone: { 
//     type: String, 
//     required: true, 
//     trim: true 
//   },
  
//   countryCode: { 
//     type: String, 
//     default: '+1' 
//   },
  
//   points: { 
//     type: Number, 
//     default: 0, 
//     min: 0 
//   },
  
//   totalCheckins: { 
//     type: Number, 
//     default: 0 
//   },
  
//   subscriberStatus: {
//     type: String,
//     enum: ['active', 'invalid', 'blocked', 'opted-out'],
//     default: 'active'
//   },
  
//   consentGiven: { 
//     type: Boolean, 
//     default: false 
//   },
  
//   firstCheckinAt: { 
//     type: Date 
//   },
  
//   lastCheckinAt: { 
//     type: Date 
//   },
  
//   metadata: {
//     name: { type: String, default: '' },
//     email: { type: String, default: '' },
//     notes: { type: String, default: '' },
//     tags: [{ type: String }]
//   }
// }, { 
//   timestamps: true 
// });

// // Index for fast lookups
// CustomerSchema.index({ businessId: 1, phone: 1 }, { unique: true });
// CustomerSchema.index({ subscriberStatus: 1 });
// CustomerSchema.index({ lastCheckinAt: -1 });

// module.exports = mongoose.model('Customer', CustomerSchema);



// models/Customer.js
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
      enum: ["active", "invalid", "blocked", "opted-out"],
      default: "active",
    },
    points: {
      type: Number,
      default: 0,
    },
    totalCheckins: {
      type: Number,
      default: 0,
    },
    lastCheckinAt: {
      type: Date,
    },
    firstCheckinAt: {
      type: Date,
    },
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
    metadata: {
      name: String,
      email: String,
      notes: String,
      tags: [String],
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for phone + businessId (unique per business)
customerSchema.index({ phone: 1, businessId: 1 }, { unique: true });

// Index for searching
customerSchema.index({ phone: "text" });

module.exports = mongoose.model("Customer", customerSchema);