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
// PUBLIC ROUTES (BEFORE protect middleware)
// ========================================
router.post("/login", admin.login);
router.post("/campaigns/webhook/status", campaignController.handleDeliveryStatus);

// ========================================
// PROTECTED ROUTES (AFTER protect middleware)
// ========================================
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
// ✅ REWARDS - FIXED TO USE rewardController
// ========================================
// Create and list rewards (using admin controller for backward compatibility)
router.post("/rewards", admin.createReward);
router.get("/rewards", admin.getAllRewards);

// ⚠️ CRITICAL FIX: Use rewardController for redemption
router.put("/rewards/:id/redeem", rewardController.redeemReward);

// Reward history and overview
router.get("/reward-history", admin.getRewardHistory);
router.get("/business/:id/rewards-overview", admin.getBusinessRewardsOverview);
router.put("/business/:id/reward-settings", admin.updateRewardSettings);

// --- BUSINESS REWARDS MANAGEMENT ---
router.get("/business/:id/rewards", rewardController.getBusinessRewards);
router.post("/business/:id/rewards", rewardController.addBusinessReward);
router.put("/business/:id/rewards/:rewardId", rewardController.updateBusinessReward);
router.put("/business/:id/rewards/:rewardId/redeem", rewardController.redeemReward);
router.delete("/business/:id/rewards/:rewardId", rewardController.deleteBusinessReward);

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
// CAMPAIGN MANAGEMENT ROUTES
// ========================================
router.get("/campaigns", campaignController.getCampaigns);
router.post("/campaigns", campaignController.createCampaign);
router.get("/campaigns/:id", campaignController.getCampaignDetails);
router.post("/campaigns/:id/send", campaignController.sendCampaign);
router.delete("/campaigns/:id", campaignController.deleteCampaign);

// --- WIN-BACK AUTOMATION ---
router.get("/win-back/:businessId", winBackController.getWinBackSettings);
router.put("/win-back/:businessId", winBackController.updateWinBackSettings);
router.get("/win-back/:businessId/preview", winBackController.previewWinBackAudience);
router.post("/win-back/:businessId/trigger", winBackController.triggerWinBack);
router.get("/win-back/:businessId/stats", winBackController.getWinBackStats);

module.exports = router;