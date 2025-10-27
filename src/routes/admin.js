// const express = require("express");
// const router = express.Router();
// const admin = require("../controllers/adminController");
// const rewardController = require("../controllers/rewardController");
// const { protect, authorizeRoles } = require("../middleware/auth");
// const upload = require("../config/mutler.js");
// const User = require("../models/AdminUser");

// // 🧩 Public Admin Routes
// router.post("/create-admin", admin.createAdmin); // Initial master creation
// router.post("/login", admin.login); // Public login

// // 🔒 Protected Routes (All routes below require JWT)
// router.use(protect);

// //////////////////////////
// // ✅ User Management (Master/Admin) 
// //////////////////////////

// // GET all users (master sees all, admin sees staff of their business)
// router.get("/users", authorizeRoles("master", "admin"), async (req, res) => {
//   try {
//     let query = {};
//     if (req.user.role === "admin") query.businessId = req.user.businessId;
//     const users = await User.find(query).select("-password");
//     res.json(users);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// // POST create user (master can create admin/staff, admin can create staff)
// router.post("/users", authorizeRoles("master", "admin"), async (req, res) => {
//   try {
//     const { name, email, password, role, businessId } = req.body;

//     if (req.user.role === "admin" && role === "admin") {
//       return res.status(403).json({ error: "Admins cannot create other admins" });
//     }

//     const existing = await User.findOne({ email });
//     if (existing) return res.status(400).json({ error: "Email already exists" });

//     const user = new User({
//       name,
//       email,
//       password,
//       role,
//       businessId: req.user.role === "admin" ? req.user.businessId : businessId,
//     });

//     await user.save();
//     res.json({ message: "User created successfully", user });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// // PUT update user
// router.put("/users/:id", authorizeRoles("master", "admin"), async (req, res) => {
//   try {
//     const { name, role, businessId } = req.body;
//     const user = await User.findById(req.params.id);
//     if (!user) return res.status(404).json({ error: "User not found" });

//     if (req.user.role === "admin" && user.role === "admin") {
//       return res.status(403).json({ error: "Admins cannot update other admins" });
//     }

//     user.name = name || user.name;
//     if (req.user.role === "master") user.role = role || user.role;
//     if (req.user.role === "master") user.businessId = businessId || user.businessId;

//     await user.save();
//     res.json({ message: "User updated successfully", user });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// // DELETE user
// router.delete("/users/:id", authorizeRoles("master", "admin"), async (req, res) => {
//   try {
//     const user = await User.findById(req.params.id);
//     if (!user) return res.status(404).json({ error: "User not found" });

//     if (req.user.role === "admin" && user.role === "admin") {
//       return res.status(403).json({ error: "Admins cannot delete other admins" });
//     }

//     await user.remove();
//     res.json({ message: "User deleted successfully" });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// //////////////////////////
// // ✅ Business Management
// //////////////////////////

// router.post("/business", authorizeRoles("master"), admin.createBusiness);
// router.get("/business", authorizeRoles("master"), admin.getAllBusinesses);
// router.put("/business/:id", authorizeRoles("master", "admin"), admin.updateBusiness);
// router.delete("/business/:id", authorizeRoles("master"), admin.deleteBusiness);

// // Upload Logo
// router.post(
//   "/business/:id/logo",
//   authorizeRoles("master", "admin"),
//   upload.single("logo"),
//   admin.uploadLogo
// );

// //////////////////////////
// // ✅ Twilio Numbers
// //////////////////////////

// router.get("/twilio-numbers", authorizeRoles("master", "admin"), admin.getTwilioNumbers);
// router.post("/twilio-numbers", authorizeRoles("master", "admin"), admin.addTwilioNumber);

// //////////////////////////
// // ✅ Logs & Inbound
// //////////////////////////

// router.get("/logs/consents", authorizeRoles("master", "admin"), admin.getConsents);

// // Public webhook (no auth)
// router.post("/inbound/twilio", admin.handleInboundTwilio);

// router.get("/logs/inbound", authorizeRoles("master", "admin"), admin.getInboundEvents);

// //////////////////////////
// // ✅ Rewards Settings & CRUD
// //////////////////////////

// router.put(
//   "/business/:id/reward-settings",
//   authorizeRoles("master", "admin"),
//   admin.updateRewardSettings
// );

// router.get(
//   "/business/:id/reward-overview",
//   authorizeRoles("master", "admin"),
//   admin.getBusinessRewardsOverview
// );

// router.get(
//   "/business/:id/rewards",
//   authorizeRoles("master", "admin"),
//   rewardController.getBusinessRewards
// );

// router.post(
//   "/business/:id/rewards",
//   authorizeRoles("master", "admin"),
//   rewardController.addBusinessReward
// );

// router.delete(
//   "/business/:id/rewards/:rewardId",
//   authorizeRoles("master", "admin"),
//   rewardController.deleteBusinessReward
// );

// //////////////////////////
// // ✅ Points Ledger
// //////////////////////////

// router.get("/points-ledger", authorizeRoles("master"), admin.getPointsLedger);
// router.get(
//   "/business/:id/points-ledger",
//   authorizeRoles("master", "admin"),
//   admin.getBusinessPointsLedger
// );

// //////////////////////////
// // ✅ General Rewards
// //////////////////////////

// router.get("/rewards", authorizeRoles("master", "admin"), admin.getAllRewards);
// router.put("/rewards/:id/redeem", authorizeRoles("master", "admin"), admin.redeemReward);
// router.get("/rewards/active", rewardController.getRewards);
// router.get("/reward-history", authorizeRoles("master", "admin"), admin.getRewardHistory);

// module.exports = router;










const express = require("express");
const router = express.Router();
const admin = require("../controllers/adminController");
const rewardController = require("../controllers/rewardController");
const auth = require("../middleware/auth");
const upload = require("../config/mutler.js");
const kioskRouter = require("../controllers/kioskController.js")


// 🧩 Public Admin Routes
router.post("/login", admin.login);

// 🔒 Protected Routes (optional)
// router.use(auth);

// ✅ Business Management
router.post("/business", admin.createBusiness);
router.get("/business", admin.getAllBusinesses);
router.put("/business/:id", admin.updateBusiness);
router.delete("/business/:id", admin.deleteBusiness);

// ✅ Upload Logo (Form field name must be 'logo')
router.post("/business/:id/logo", upload.single("logo"), admin.uploadLogo);

// ✅ Twilio Numbers Management
router.get("/twilio-numbers", admin.getTwilioNumbers);
router.post("/twilio-numbers", admin.addTwilioNumber);

// ✅ Logs and Reports
router.get("/logs/consents", admin.getConsents);
// ✅ Twilio Webhook for Inbound SMS
router.post("/inbound/twilio", admin.handleInboundTwilio);
router.get("/logs/inbound", admin.getInboundEvents);

// ✅ Rewards Settings
router.put("/business/:id/reward-settings", admin.updateRewardSettings);
router.get("/business/:id/reward-overview", admin.getBusinessRewardsOverview);


router.get("/business/:id/rewards", rewardController.getBusinessRewards);
router.post("/business/:id/rewards", rewardController.addBusinessReward);
router.delete("/business/:id/rewards/:rewardId", rewardController.deleteBusinessReward);


// ✅ Add these two new lines 👇
router.get("/points-ledger", admin.getPointsLedger);
router.get("/business/:id/points-ledger", admin.getBusinessPointsLedger);
router.get("/rewards", admin.getAllRewards);
//Redeem Reward
// ✅ Redeem a reward
router.patch('/reward-history/redeem', admin.redeemReward);// GET all active rewards (not redeemed and not expired)
router.get("/rewards/active", rewardController.getRewards);



//reward history
router.get("/reward-history", admin.getRewardHistory);


// ✅ NEW: Fetch all inbound messages
// router.get("/inbound", adminController.getInboundEvents);

module.exports = router;
