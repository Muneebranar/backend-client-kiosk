const express = require("express");
const router = express.Router();
const admin = require("../controllers/adminController");
const rewardController = require("../controllers/rewardController");
const csvImportController = require("../controllers/csvImportController");
const customerController = require("../controllers/customerController");
const kioskController = require("../controllers/kioskController");
const campaignController = require("../controllers/campaignController");
const winBackController = require("../controllers/winBackController");
const { protect } = require("../middleware/authMiddleware");
const { upload, uploadCSV } = require("../config/mutler");
const debugAuth = require('../middleware/authDebug');

// Debug Logs
console.log("✅ adminController:", Object.keys(admin));
console.log("✅ customerController:", Object.keys(customerController));
console.log("✅ rewardController:", Object.keys(rewardController));
console.log("✅ csvImportController:", Object.keys(csvImportController));

// ========================================
// ✅ PUBLIC ROUTES (BEFORE protect middleware)
// ========================================
console.log("🔓 Setting up PUBLIC routes...");

// Login endpoint - MUST be public
router.post("/login", admin.login);
console.log("  ✅ POST /admin/login (public)");

// Campaign webhook - MUST be public for Twilio
router.post("/campaigns/webhook/status", campaignController.handleDeliveryStatus);
console.log("  ✅ POST /admin/campaigns/webhook/status (public)");

// ========================================
// 🔒 PROTECTED ROUTES (AFTER protect middleware)
// ========================================
console.log("🔒 Setting up PROTECTED routes...");
router.use(protect);

// ========================================
// ✅ PROFILE ROUTE
// ========================================
router.get("/profile", async (req, res) => {
  try {
    console.log('📋 Fetching profile for user:', req.user.id);
    
    res.json({
      ok: true,
      user: {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
        businessId: req.user.businessId,
        name: req.user.name
      }
    });
  } catch (error) {
    console.error('❌ Profile fetch error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch profile'
    });
  }
});

// --- USERS ---
router.get("/users", admin.getAllUsers);
router.post("/users", admin.createAdmin);
router.put("/users/:id", admin.updateUser);
router.delete("/users/:id", admin.deleteUser);

// --- ADMIN CREATION ---
router.post("/create-admin", admin.createAdmin);

// --- BUSINESS MANAGEMENT ---
router.get("/business", admin.getAllBusinesses);
router.get("/business/by-slug/:slug", admin.getBusiness);
router.get("/business/:id", admin.getBusinessById);
router.post("/business", upload.single("logo"), admin.createBusiness);
router.post("/business/:id/logo", upload.single("logo"), admin.uploadLogo);
router.delete("/business/:id/logo", admin.deleteLogo);
router.put("/business/:id", admin.updateBusiness);
router.put("/business/:id/twilio-number", debugAuth, admin.assignTwilioNumber);
router.delete("/business/:id", admin.deleteBusiness);

// --- TWILIO NUMBERS ---
router.get("/twilio-numbers", admin.getTwilioNumbers);
router.get("/twilio-numbers/with-assignments", admin.getTwilioNumbersWithAssignments);
router.post("/twilio-numbers", admin.addTwilioNumber);

// Twilio number sync and diagnostics
router.get("/twilio-numbers/diagnostics", admin.getTwilioNumberDiagnostics);
router.post("/twilio-numbers/sync", admin.syncTwilioNumberAssignments);
router.put("/twilio-numbers/:id", admin.updateTwilioNumber);
router.delete("/twilio-numbers/:id", admin.deleteTwilioNumber);

// --- CHECK-IN LOGS ---
router.get("/logs/consents", admin.getConsents);
router.post("/inbound/twilio", admin.handleInboundTwilio);
router.get("/logs/inbound", admin.getInboundEvents);

// --- POINTS LEDGER ---
router.get("/points-ledger", admin.getPointsLedger);
router.get("/business/:id/points-ledger", admin.getBusinessPointsLedger);
router.get("/business/:id/checkins", admin.getBusinessCheckins);

// --- CHECK-IN STATISTICS ---
router.get("/checkins/daily-stats", admin.getDailyCheckinStats);
router.get("/checkins/summary", admin.getCheckinSummary);
router.get("/dashboard-stats", admin.getDashboardStats);

// ======================================== 
// ✅ REWARDS MANAGEMENT - COMPLETE & FIXED
// ======================================== 

// --- DEBUG & FIX ROUTES (Add these temporarily) ---
router.get("/business/:id/rewards/debug", rewardController.debugBusinessRewards);
router.post("/business/:id/rewards/fix", rewardController.fixRewardsToTemplates);

// --- TEMPLATE MANAGEMENT ---
router.get("/business/:id/rewards", rewardController.getBusinessRewards);
router.post("/business/:id/rewards", rewardController.addBusinessReward);
router.put("/business/:id/rewards/:rewardId", rewardController.updateBusinessReward);
router.delete("/business/:id/rewards/:rewardId", rewardController.deleteBusinessReward);

// --- ISSUED REWARDS & REDEMPTION ---
router.post("/rewards", admin.createReward);  // Issues reward to customer
router.get("/rewards", admin.getAllRewards);   // Gets all issued rewards
router.put("/rewards/:id/redeem", rewardController.redeemReward);
router.put("/business/:id/rewards/:rewardId/redeem", rewardController.redeemReward);

// --- REWARD HISTORY ---
router.get("/reward-history", admin.getRewardHistory);
router.get("/business/:id/rewards-overview", admin.getBusinessRewardsOverview);
router.put("/business/:id/reward-settings", admin.updateRewardSettings);

// --- CSV IMPORT (Must come BEFORE general customer routes) ---
router.get("/customers/import-history", csvImportController.getImportHistory);
router.get("/customers/import/:id", csvImportController.getImportStatus);
router.post("/customers/import", uploadCSV.single("csv"), csvImportController.importCustomersCSV || csvImportController.importCustomers);

// ========================================
// ✅ CUSTOMER MANAGEMENT (UPDATED)
// ========================================

// ✅ NEW: Marketing consent management (MUST be before :id routes)
router.post("/customers/bulk/marketing-consent", customerController.bulkEnableMarketingConsent);
router.put("/customers/:id/marketing-consent", customerController.enableMarketingConsent);

// Customer search and details
router.get("/customers/by-code/:code", customerController.getCustomerByRewardCode);
router.get("/customers", customerController.searchCustomers);
router.get("/customers/:id", customerController.getCustomerDetails);

// Customer actions
router.post("/customers/:id/checkin", customerController.addManualCheckin);
router.put("/customers/:id/status", customerController.updateSubscriberStatus);
router.put("/customers/:id", customerController.updateCustomer);
router.delete("/customers/:id", customerController.deleteCustomer);

// Customer export
router.get("/customers/export", customerController.exportCustomers);

// Customer blocking routes
router.post("/customers/:id/block", kioskController.blockCustomerById);
router.post("/customers/:id/unblock", kioskController.unblockCustomerById);

// Legacy kiosk routes (by phone)
router.post("/admin/unblock-customer", kioskController.unblockCustomer);
router.post("/admin/block-customer", kioskController.blockCustomer);

// ========================================
// ✅ CAMPAIGN MANAGEMENT ROUTES (WITH SCHEDULING)
// ========================================
router.get("/campaigns", campaignController.getCampaigns);
router.post("/campaigns", campaignController.createCampaign);
router.get("/campaigns/:id", campaignController.getCampaignDetails);
router.put("/campaigns/:id", campaignController.updateScheduledCampaign);
router.post("/campaigns/:id/send", campaignController.sendCampaign);
router.post("/campaigns/:id/cancel", campaignController.cancelScheduledCampaign);
router.delete("/campaigns/:id", campaignController.deleteCampaign);

// --- WIN-BACK AUTOMATION ---
router.get("/win-back/:businessId", winBackController.getWinBackSettings);
router.put("/win-back/:businessId", winBackController.updateWinBackSettings);
router.get("/win-back/:businessId/preview", winBackController.previewWinBackAudience);
router.post("/win-back/:businessId/trigger", winBackController.triggerWinBack);
router.get("/win-back/:businessId/stats", winBackController.getWinBackStats);

// ========================================
// ✅ KEYWORD AUTO-REPLY MANAGEMENT (NEW)
// ========================================
console.log("🔑 Setting up KEYWORD AUTO-REPLY routes...");

// Get all keywords for a business
router.get("/keywords/:businessId", async (req, res) => {
  try {
    const { businessId } = req.params;
    const Business = require("../models/Business");

    // Authorization check
    if (req.user.role !== "master" && req.user.businessId.toString() !== businessId) {
      return res.status(403).json({ ok: false, error: "Access denied" });
    }

    const business = await Business.findById(businessId);
    if (!business) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }

    res.json({
      ok: true,
      autoReplies: business.autoReplies || {
        enabled: true,
        keywords: [],
        fallbackMessage: "Thanks for your message! We'll get back to you soon.",
        sendFallback: true
      }
    });
  } catch (err) {
    console.error("Get Keywords Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Add new keyword
router.post("/keywords/:businessId", async (req, res) => {
  try {
    const { businessId } = req.params;
    const { keyword, response, matchType = 'exact', active = true } = req.body;
    const Business = require("../models/Business");

    // Validation
    if (!keyword || !response) {
      return res.status(400).json({ 
        ok: false, 
        error: "Keyword and response are required" 
      });
    }

    if (response.length > 1600) {
      return res.status(400).json({ 
        ok: false, 
        error: "Response must be 1600 characters or less (SMS limit)" 
      });
    }

    // Authorization check
    if (req.user.role !== "master" && req.user.businessId.toString() !== businessId) {
      return res.status(403).json({ ok: false, error: "Access denied" });
    }

    const business = await Business.findById(businessId);
    if (!business) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }

    // Initialize autoReplies if not exists
    if (!business.autoReplies) {
      business.autoReplies = {
        enabled: true,
        keywords: [],
        fallbackMessage: "Thanks for your message! We'll get back to you soon.",
        sendFallback: true
      };
    }

    // Check for duplicate keywords
    const keywordUpper = keyword.trim().toUpperCase();
    const duplicate = business.autoReplies.keywords.find(
      kw => kw.keyword.toUpperCase() === keywordUpper
    );

    if (duplicate) {
      return res.status(400).json({ 
        ok: false, 
        error: "This keyword already exists" 
      });
    }

    // Add new keyword
    const newKeyword = {
      keyword: keywordUpper,
      response: response.trim(),
      matchType,
      active,
      usageCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    business.autoReplies.keywords.push(newKeyword);
    await business.save();

    console.log(`✅ Keyword added: ${keywordUpper} for business: ${business.name}`);

    res.json({
      ok: true,
      message: "Keyword added successfully",
      keyword: business.autoReplies.keywords[business.autoReplies.keywords.length - 1]
    });
  } catch (err) {
    console.error("Add Keyword Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Update keyword
router.put("/keywords/:businessId/:keywordId", async (req, res) => {
  try {
    const { businessId, keywordId } = req.params;
    const { keyword, response, matchType, active } = req.body;
    const Business = require("../models/Business");

    // Authorization check
    if (req.user.role !== "master" && req.user.businessId.toString() !== businessId) {
      return res.status(403).json({ ok: false, error: "Access denied" });
    }

    const business = await Business.findById(businessId);
    if (!business) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }

    const keywordDoc = business.autoReplies.keywords.id(keywordId);
    if (!keywordDoc) {
      return res.status(404).json({ ok: false, error: "Keyword not found" });
    }

    // Validate response length
    if (response && response.length > 1600) {
      return res.status(400).json({ 
        ok: false, 
        error: "Response must be 1600 characters or less (SMS limit)" 
      });
    }

    // Update fields
    if (keyword) keywordDoc.keyword = keyword.trim().toUpperCase();
    if (response) keywordDoc.response = response.trim();
    if (matchType) keywordDoc.matchType = matchType;
    if (active !== undefined) keywordDoc.active = active;
    keywordDoc.updatedAt = new Date();

    await business.save();

    console.log(`✅ Keyword updated: ${keywordDoc.keyword} for business: ${business.name}`);

    res.json({
      ok: true,
      message: "Keyword updated successfully",
      keyword: keywordDoc
    });
  } catch (err) {
    console.error("Update Keyword Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Delete keyword
router.delete("/keywords/:businessId/:keywordId", async (req, res) => {
  try {
    const { businessId, keywordId } = req.params;
    const Business = require("../models/Business");

    // Authorization check
    if (req.user.role !== "master" && req.user.businessId.toString() !== businessId) {
      return res.status(403).json({ ok: false, error: "Access denied" });
    }

    const business = await Business.findById(businessId);
    if (!business) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }

    const keywordDoc = business.autoReplies.keywords.id(keywordId);
    if (!keywordDoc) {
      return res.status(404).json({ ok: false, error: "Keyword not found" });
    }

    const keywordText = keywordDoc.keyword;
    keywordDoc.remove();
    await business.save();

    console.log(`✅ Keyword deleted: ${keywordText} for business: ${business.name}`);

    res.json({
      ok: true,
      message: "Keyword deleted successfully"
    });
  } catch (err) {
    console.error("Delete Keyword Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Update auto-reply settings
router.put("/keywords/:businessId/settings", async (req, res) => {
  try {
    const { businessId } = req.params;
    const { enabled, fallbackMessage, sendFallback } = req.body;
    const Business = require("../models/Business");

    // Authorization check
    if (req.user.role !== "master" && req.user.businessId.toString() !== businessId) {
      return res.status(403).json({ ok: false, error: "Access denied" });
    }

    const business = await Business.findById(businessId);
    if (!business) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }

    // Initialize autoReplies if not exists
    if (!business.autoReplies) {
      business.autoReplies = {
        enabled: true,
        keywords: [],
        fallbackMessage: "Thanks for your message! We'll get back to you soon.",
        sendFallback: true
      };
    }

    // Update settings
    if (enabled !== undefined) business.autoReplies.enabled = enabled;
    if (fallbackMessage) business.autoReplies.fallbackMessage = fallbackMessage.trim();
    if (sendFallback !== undefined) business.autoReplies.sendFallback = sendFallback;

    await business.save();

    console.log(`✅ Auto-reply settings updated for business: ${business.name}`);

    res.json({
      ok: true,
      message: "Settings updated successfully",
      autoReplies: business.autoReplies
    });
  } catch (err) {
    console.error("Update Settings Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Get keyword statistics
router.get("/keywords/:businessId/stats", async (req, res) => {
  try {
    const { businessId } = req.params;
    const Business = require("../models/Business");

    // Authorization check
    if (req.user.role !== "master" && req.user.businessId.toString() !== businessId) {
      return res.status(403).json({ ok: false, error: "Access denied" });
    }

    const business = await Business.findById(businessId);
    if (!business) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }

    if (!business.autoReplies?.keywords?.length) {
      return res.json({
        ok: true,
        stats: {
          totalKeywords: 0,
          activeKeywords: 0,
          totalUsage: 0,
          keywords: []
        }
      });
    }

    const keywords = business.autoReplies.keywords.map(kw => ({
      keyword: kw.keyword,
      usageCount: kw.usageCount || 0,
      lastUsedAt: kw.lastUsedAt,
      active: kw.active,
      matchType: kw.matchType
    })).sort((a, b) => b.usageCount - a.usageCount);

    const stats = {
      totalKeywords: business.autoReplies.keywords.length,
      activeKeywords: business.autoReplies.keywords.filter(kw => kw.active).length,
      totalUsage: keywords.reduce((sum, kw) => sum + kw.usageCount, 0),
      keywords
    };

    res.json({
      ok: true,
      stats
    });
  } catch (err) {
    console.error("Get Stats Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

console.log("  ✅ GET    /admin/keywords/:businessId");
console.log("  ✅ POST   /admin/keywords/:businessId");
console.log("  ✅ PUT    /admin/keywords/:businessId/:keywordId");
console.log("  ✅ DELETE /admin/keywords/:businessId/:keywordId");
console.log("  ✅ PUT    /admin/keywords/:businessId/settings");
console.log("  ✅ GET    /admin/keywords/:businessId/stats");

// ========================================
// ✅ INBOUND MESSAGES
// ========================================
router.get("/inbound-messages", admin.getInboundMessages);
router.get("/customers/:id/messages", admin.getCustomerMessages);
router.get("/business/:id/inbound-messages", admin.getInboundMessages);

console.log("✅ Admin routes configured successfully");

module.exports = router;