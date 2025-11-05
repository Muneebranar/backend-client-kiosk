const express = require("express");
const router = express.Router();
const admin = require("../controllers/adminController");
const rewardController = require("../controllers/rewardController");
const csvImportController = require("../controllers/csvImportController");
const customerController = require("../controllers/customerController");
const kioskController = require("../controllers/kioskController");
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

// ========================================
// PROTECTED ROUTES (AFTER protect middleware)
// ========================================
router.use(protect);

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

// --- REWARDS ---
router.post("/rewards", admin.createReward);
router.get("/rewards", admin.getAllRewards);
router.put("/rewards/:id/redeem", admin.redeemReward);
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

// --- CUSTOMER MANAGEMENT ---
// CRITICAL: Put specific routes BEFORE parameterized routes to avoid conflicts
router.get("/customers/by-code/:code", customerController.getCustomerByRewardCode);

// General customer routes (these come AFTER specific routes)
router.get("/customers", customerController.searchCustomers);
router.get("/customers/:id", customerController.getCustomerDetails);
router.post("/customers/:id/checkin", customerController.addManualCheckin);
router.put("/customers/:id/status", customerController.updateSubscriberStatus);
router.put("/customers/:id", customerController.updateCustomer);
router.delete("/customers/:id", customerController.deleteCustomer);

// Customer blocking routes
router.post("/customers/:id/block", kioskController.blockCustomerById);
router.post("/customers/:id/unblock", kioskController.unblockCustomerById);

// Legacy kiosk routes (by phone)
router.post("/admin/unblock-customer", kioskController.unblockCustomer);
router.post("/admin/block-customer", kioskController.blockCustomer);

module.exports = router;