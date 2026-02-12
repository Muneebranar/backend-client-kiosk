// models/Business.js
// ✅ UPDATED: Added keyword auto-reply system with formatKeywordResponse method

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
    
    // ✅ NEW: Keyword Auto-Reply System
    autoReplies: {
      enabled: {
        type: Boolean,
        default: true
      },
      
      // Array of keyword-response pairs
      keywords: [{
        keyword: {
          type: String,
          required: true,
          uppercase: true, // Store keywords in uppercase for consistency
          trim: true
        },
        response: {
          type: String,
          required: true,
          maxlength: 1600 // SMS limit
        },
        matchType: {
          type: String,
          enum: ['exact', 'contains', 'starts_with'],
          default: 'exact'
        },
        active: {
          type: Boolean,
          default: true
        },
        // ✅ NEW: Expiration date support
        hasExpiration: {
          type: Boolean,
          default: false
        },
        expirationDays: {
          type: Number,
          min: 1,
          max: 365
        },
        usageCount: {
          type: Number,
          default: 0
        },
        lastUsedAt: {
          type: Date
        },
        createdAt: {
          type: Date,
          default: Date.now
        },
        updatedAt: {
          type: Date,
          default: Date.now
        }
      }],
      
      // Fallback message when no keyword matches
      fallbackMessage: {
        type: String,
        default: "Thanks for your message! We'll get back to you soon."
      },
      
      // Whether to send fallback for unmatched messages
      sendFallback: {
        type: Boolean,
        default: true
      }
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

// Indexes
businessSchema.index({ slug: 1 });
businessSchema.index({ twilioNumber: 1 });
businessSchema.index({ "autoReplies.keywords.keyword": 1 });

// ✅ Method to find matching keyword
businessSchema.methods.findMatchingKeyword = function(incomingMessage) {
  if (!this.autoReplies?.enabled || !this.autoReplies?.keywords?.length) {
    return null;
  }

  const message = incomingMessage.trim().toUpperCase();

  // Find active keywords
  const activeKeywords = this.autoReplies.keywords.filter(kw => kw.active);

  for (const keywordConfig of activeKeywords) {
    const keyword = keywordConfig.keyword.toUpperCase();

    let isMatch = false;

    switch (keywordConfig.matchType) {
      case 'exact':
        isMatch = message === keyword;
        break;
      case 'contains':
        isMatch = message.includes(keyword);
        break;
      case 'starts_with':
        isMatch = message.startsWith(keyword);
        break;
      default:
        isMatch = message === keyword;
    }

    if (isMatch) {
      return keywordConfig;
    }
  }

  return null;
};

// ✅ NEW: Method to format keyword response with dynamic expiration dates
businessSchema.methods.formatKeywordResponse = function(keywordConfig) {
  let response = keywordConfig.response;
  
  // Check if response contains expiration date placeholders
  if (keywordConfig.hasExpiration && keywordConfig.expirationDays) {
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + keywordConfig.expirationDays);
    
    // Format date as "MM/DD/YYYY"
    const formattedDate = expirationDate.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric'
    });
    
    // Replace placeholder with actual date
    // Supports both {EXPIRATION_DATE} and {{EXPIRATION_DATE}}
    response = response.replace(/\{\{?EXPIRATION_DATE\}?\}/g, formattedDate);
  }
  
  return response;
};

// ✅ Method to update keyword usage stats
businessSchema.methods.updateKeywordUsage = async function(keywordId) {
  const keyword = this.autoReplies.keywords.id(keywordId);
  if (keyword) {
    keyword.usageCount = (keyword.usageCount || 0) + 1;
    keyword.lastUsedAt = new Date();
    await this.save();
  }
};

module.exports = mongoose.model("Business", businessSchema);