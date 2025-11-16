// models/ImportHistory.js
const mongoose = require('mongoose');

const importHistorySchema = new mongoose.Schema({
  businessId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Business',
    required: true,
  },

  // ✅ FIXED: Allow both ObjectId (for real users) and String (for "default-admin")
  userId: {
    type: mongoose.Schema.Types.Mixed, // Accepts both ObjectId and String
    required: false,
  },

  fileName: {  // ✅ Changed from 'filename' to match your controller
    type: String,
    trim: true,
  },

  status: {
    type: String,
    enum: ['queued', 'processing', 'completed', 'failed'],
    default: 'queued',
  },

  progress: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },

  // ✅ FIXED: Match the field names your frontend expects
  totalRecords: { type: Number, default: 0 },
  successCount: { type: Number, default: 0 },
  failureCount: { type: Number, default: 0 },
  
  errors: [
    {
      row: Number,
      phone: String,
      reason: String,
      data: mongoose.Schema.Types.Mixed, // Store the original row data
    },
  ],

  // Legacy support for old frontend (optional)
  results: {
    totalRows: { type: Number, default: 0 },
    created: { type: Number, default: 0 },
    updated: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    welcomesSent: { type: Number, default: 0 }, // ✅ Add this
    welcomesFailed: { type: Number, default: 0 }, // ✅ Add this
    errors: [
      {
        row: Number,
        phone: String,
        reason: String,
      },
    ],
  },

  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, {
  timestamps: true,
});

// Virtual to populate userId as user object when it's an ObjectId
importHistorySchema.virtual('user', {
  ref: 'AdminUser',
  localField: 'userId',
  foreignField: '_id',
  justOne: true,
});

// Method to get user info (handles both ObjectId and string userId)
importHistorySchema.methods.getUserInfo = async function() {
  if (typeof this.userId === 'string') {
    // Handle default-admin or other string IDs
    return {
      _id: this.userId,
      name: this.userId === 'default-admin' ? 'Master Admin' : this.userId,
      email: process.env.DEFAULT_ADMIN_EMAIL || 'admin@system.com',
    };
  } else {
    // Handle ObjectId - populate from database
    await this.populate('userId', 'name email');
    return this.userId;
  }
};

// Pre-save hook to sync results with top-level fields
importHistorySchema.pre('save', function(next) {
  // Sync results object with top-level fields for backward compatibility
  if (!this.results) {
    this.results = {
      totalRows: this.totalRecords || 0,
      created: this.successCount || 0,
      updated: 0,
      skipped: this.failureCount || 0,
      errors: this.errors || [],
    };
  }
  next();
});

module.exports = mongoose.model('ImportHistory', importHistorySchema);