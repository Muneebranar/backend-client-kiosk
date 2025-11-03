const AdminUser = require("../models/AdminUser");
const Business = require("../models/Business");
const Checkin = require("../models/Checkin");
const Reward = require("../models/Reward");
const InboundEvent = require("../models/InboundEvent");
const TwilioNumber = require("../models/TwilioNumber");
const PointsLedger = require("../models/PointsLedger");
  const Customer = require("../models/Customer");
    const CheckinLog = require("../models/CheckinLog");
    //const Reward = require("../models/Reward");
// const bcrypt = require("bcrypt");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require('mongoose');
const fs = require("fs");
const path = require("path"); // ✅ <--- this was missing
const RewardHistory = require("../models/rewardHistory");











// ==========================================
// 🔐 AUTHENTICATION & USER MANAGEMENT
// ==========================================

/**
 * Create initial master admin
 * POST /admin/create-master
 */
exports.createMasterAdmin = async (req, res) => {
  try {
    // Check if master already exists
    const existingMaster = await AdminUser.findOne({ role: "master" });
    if (existingMaster) {
      return res.status(400).json({ error: "Master admin already exists" });
    }

    const { name, email, password } = req.body;

    const master = await AdminUser.create({
      name,
      email,
      password,
      role: "master",
    });

    res.json({
      ok: true,
      message: "Master admin created successfully",
      user: {
        id: master._id,
        name: master.name,
        email: master.email,
        role: master.role,
      },
    });
  } catch (err) {
    console.error("Create Master Error:", err);
    res.status(500).json({ error: err.message });
  }
};


/**
 * Get all users (role-based)
 * GET /admin/users
 */
exports.getAllUsers = async (req, res) => {
  try {
    let query = {};

    // Admin can only see users of their business
    if (req.user.role === "admin") {
      query.businessId = req.user.businessId;
    }

    const users = await AdminUser.find(query)
      .populate("businessId", "name slug")
      .select("-password")
      .sort({ createdAt: -1 });

    res.json({
      ok: true,
      users,
    });
  } catch (err) {
    console.error("Get Users Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Create new user (admin or staff)
 * POST /admin/users
 */
exports.createUser = async (req, res) => {
  try {
    const { name, email, password, role, businessId } = req.body;

    // Validation
    if (req.user.role === "admin" && role === "admin") {
      return res
        .status(403)
        .json({ error: "Admins cannot create other admins" });
    }

    if (req.user.role === "staff") {
      return res.status(403).json({ error: "Staff cannot create users" });
    }

    // Check if email exists
    const existing = await AdminUser.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: "Email already exists" });
    }

    // Create user
    const user = await AdminUser.create({
      name,
      email,
      password,
      role,
      businessId:
        req.user.role === "admin" ? req.user.businessId : businessId,
    });

    res.json({
      ok: true,
      message: "User created successfully",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        businessId: user.businessId,
      },
    });
  } catch (err) {
    console.error("Create User Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Update user
 * PUT /admin/users/:id
 */
exports.updateUser = async (req, res) => {
  try {
    const { name, role, businessId, isActive, permissions } = req.body;

    const user = await AdminUser.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Permission checks
    if (req.user.role === "admin" && user.role === "admin") {
      return res
        .status(403)
        .json({ error: "Admins cannot update other admins" });
    }

    if (req.user.role === "staff") {
      return res.status(403).json({ error: "Staff cannot update users" });
    }

    // Update fields
    if (name) user.name = name;
    if (isActive !== undefined) user.isActive = isActive;

    // Only master can change role and businessId
    if (req.user.role === "master") {
      if (role) user.role = role;
      if (businessId) user.businessId = businessId;
      if (permissions) user.permissions = { ...user.permissions, ...permissions };
    }

    await user.save();

    res.json({
      ok: true,
      message: "User updated successfully",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        businessId: user.businessId,
        isActive: user.isActive,
        permissions: user.permissions,
      },
    });
  } catch (err) {
    console.error("Update User Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Delete user
 * DELETE /admin/users/:id
 */
exports.deleteUser = async (req, res) => {
  try {
    const user = await AdminUser.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Permission checks
    if (req.user.role === "admin" && user.role === "admin") {
      return res
        .status(403)
        .json({ error: "Admins cannot delete other admins" });
    }

    if (req.user.role === "staff") {
      return res.status(403).json({ error: "Staff cannot delete users" });
    }

    await user.deleteOne();

    res.json({
      ok: true,
      message: "User deleted successfully",
    });
  } catch (err) {
    console.error("Delete User Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ==========================================
// 🏢 BUSINESS SETTINGS (Enhanced for Age Gate)
// ==========================================

/**
 * Update business settings including age gate
 * PUT /admin/business/:id/settings
 */
exports.updateBusinessSettings = async (req, res) => {
  try {
    const {
      ageGateEnabled,
      ageGateMinimum,
      timezone,
      welcomeText,
      colors,
      rewardThreshold,
    } = req.body;

    const business = await Business.findById(req.params.id);
    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    // Check access
    if (
      req.user.role !== "master" &&
      business._id.toString() !== req.user.businessId.toString()
    ) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Update settings
    if (ageGateEnabled !== undefined) {
      business.ageGateEnabled = ageGateEnabled;
    }
    if (ageGateMinimum !== undefined) {
      business.ageGateMinimum = ageGateMinimum; // 18 or 21
    }
    if (timezone) business.timezone = timezone;
    if (welcomeText) business.welcomeText = welcomeText;
    if (colors) business.branding.colors = { ...business.branding.colors, ...colors };
    if (rewardThreshold) business.rewardThreshold = rewardThreshold;

    await business.save();

    res.json({
      ok: true,
      message: "Settings updated successfully",
      business,
    });
  } catch (err) {
    console.error("Update Settings Error:", err);
    res.status(500).json({ error: err.message });
  }
};



exports.assignTwilioNumber = async (req, res) => {
  try {
    const { id } = req.params;
    const { twilioNumber, isActive } = req.body;

    const business = await Business.findById(id);
    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    // Check access
    if (
      req.user.role !== "master" &&
      business._id.toString() !== req.user.businessId.toString()
    ) {
      return res.status(403).json({ error: "Access denied" });
    }

    business.twilioNumber = twilioNumber;
    business.twilioNumberActive = isActive !== undefined ? isActive : true;

    await business.save();

    res.json({
      ok: true,
      message: "Twilio number updated successfully",
      business,
    });
  } catch (err) {
    console.error("Assign Twilio Number Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ==========================================
// 📊 DASHBOARD STATS (Enhanced)
// ==========================================

/**
 * Get dashboard statistics for business
 * GET /admin/business/:id/stats
 */
exports.getBusinessStats = async (req, res) => {
  try {
    const businessId = req.params.id;

    // Check access
    if (
      req.user.role !== "master" &&
      businessId !== req.user.businessId.toString()
    ) {
      return res.status(403).json({ error: "Access denied" });
    }

  

    // Get counts
    const totalCustomers = await Customer.countDocuments({ businessId });
    const activeCustomers = await Customer.countDocuments({
      businessId,
      subscriberStatus: "active",
    });
    const totalCheckins = await CheckinLog.countDocuments({ businessId });
    const totalRewardsIssued = await Reward.countDocuments({ businessId });
    const activeRewards = await Reward.countDocuments({
      businessId,
      redeemed: false,
      expiresAt: { $gt: new Date() },
    });

    // Recent activity (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentCheckins = await CheckinLog.countDocuments({
      businessId,
      createdAt: { $gte: thirtyDaysAgo },
    });

    res.json({
      ok: true,
      stats: {
        totalCustomers,
        activeCustomers,
        totalCheckins,
        recentCheckins,
        totalRewardsIssued,
        activeRewards,
      },
    });
  } catch (err) {
    console.error("Get Stats Error:", err);
    res.status(500).json({ error: err.message });
  }
}

/* ---------------------------------------------------
   ✅ 1. AUTO-CREATE DEFAULT ADMIN FROM .env AT STARTUP
--------------------------------------------------- */
(async () => {
  try {
    const defaultEmail = process.env.DEFAULT_ADMIN_EMAIL;
    const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD;

    if (!defaultEmail || !defaultPassword) {
      console.warn("⚠️ Default admin credentials not set in .env — skipping seed.");
      return;
    }

    const existing = await AdminUser.findOne({ email: defaultEmail });
    if (!existing) {
      const hashed = await bcrypt.hash(defaultPassword, 10);
      await AdminUser.create({
        email: defaultEmail,
        password: hashed,
        name: "Default Admin",
      });
      console.log("✅ Default admin created successfully from .env!");
    } else {
      console.log("✅ Default admin already exists.");
    }
  } catch (err) {
    console.error("❌ Failed to seed default admin:", err);
  }
})();


/* ---------------------------------------------------
   2. CREATE ADMIN
--------------------------------------------------- */
exports.createAdmin = async (req, res) => {
  try {
    const { name, email, password, role, businessId } = req.body;

    const existing = await AdminUser.findOne({ email });
    if (existing) return res.status(400).json({ ok: false, error: "Email already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    // ✅ Define valid roles
const validRoles = ["staff", "admin", "master"];

// ✅ Fallback to "staff" if role is missing or invalid
const userRole = validRoles.includes(role) ? role : "staff";

    const newUser = await AdminUser.create({
      name,
      email,
      password: hashedPassword,
      role: userRole,   // <-- use the validated/fallback role,
      businessId,
    });

    res.status(201).json({ ok: true, message: "Admin created successfully", user: newUser });
  } catch (err) {
    console.error("Error creating admin:", err);
    res.status(500).json({ ok: false, error: "Server error during creation" });
  }
};




exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "Email and password required" });
    }

    const DEFAULT_ADMIN_EMAIL = process.env.DEFAULT_ADMIN_EMAIL || "darronwilliams@verizon.net";
    const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || "EngageDFW@#";
    const JWT_SECRET = process.env.JWT_SECRET || "muneeb";

    // ✅ Step 1: Check Default Admin
    if (email === DEFAULT_ADMIN_EMAIL && password === DEFAULT_ADMIN_PASSWORD) {
      const token = jwt.sign({ id: "default-admin", role: "master" }, JWT_SECRET, { expiresIn: "7d" });
      return res.status(200).json({
        ok: true,
        message: "Login successful",
        token,
        user: {
          id: "default-admin",
          name: "Admin",
          email: DEFAULT_ADMIN_EMAIL,
          role: "master",
          lastLogin: new Date(),
        },
      });
    }

    // ✅ Step 2: Check Database Users (with populate)
    const user = await AdminUser.findOne({ email }).populate("businessId", "name");
    if (!user) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ ok: false, error: "Invalid password" });
    }

    // ✅ Step 3: Update last login timestamp
    user.lastLogin = new Date();
    await user.save();

    // ✅ Step 4: Generate JWT for normal admins
    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });

    // ✅ CRITICAL FIX: Extract businessId and businessName properly
    const businessId = user.businessId?._id 
      ? String(user.businessId._id)  // If populated, get _id
      : user.businessId 
        ? String(user.businessId)    // If not populated, convert to string
        : undefined;                  // If null/undefined, leave undefined

    const businessName = user.businessId?.name || undefined;

    res.status(200).json({
      ok: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        businessId: businessId,           // ✅ Always a string now
        businessName: businessName,        // ✅ Extract name from populated object
        lastLogin: user.lastLogin,
      },
    });
  } catch (err) {
    console.error("❌ Login Error:", err);
    res.status(500).json({ ok: false, error: "Server error during login" });
  }
};




// ===================================================
// USER MANAGEMENT
// ===================================================

// --- GET ALL USERS ---
exports.getAllUsers = async (req, res) => {
  try {
    const users = await AdminUser.find()
      .populate("businessId", "name slug")
      .sort({ createdAt: -1 });

    res.json({ ok: true, users });
  } catch (err) {
    console.error("Fetch users error:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
};

// --- CREATE USER (admin/staff) ---
exports.createUser = async (req, res) => {
  try {
    const { name, email, password, role, businessId } = req.body;

    const existing = await AdminUser.findOne({ email });
    if (existing)
      return res.status(400).json({ ok: false, error: "Email already in use" });

    if (role !== "master" && !businessId)
      return res
        .status(400)
        .json({ ok: false, error: "Business ID is required for this role" });

    const hashed = await bcrypt.hash(password, 10);

    const user = await AdminUser.create({
      name,
      email,
      password: hashed,
      role,
      businessId: role !== "master" ? businessId : null,
    });

    res.json({ ok: true, user });
  } catch (err) {
    console.error("Create user error:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
};


exports.updateUser = async (req, res) => {
  try {
    const { name, role, businessId, isActive, permissions, password } = req.body;

    const user = await AdminUser.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    // 🛡 Permission checks
    if (req.user.role === "staff") {
      return res.status(403).json({ ok: false, error: "Staff cannot update users" });
    }

    if (req.user.role === "admin" && user.role === "admin") {
      return res.status(403).json({ ok: false, error: "Admins cannot update other admins" });
    }

    // ✏️ Update allowed fields
    if (name) user.name = name;
    if (isActive !== undefined) user.isActive = isActive;

    // 🔒 Only master can modify role, business, and permissions
    if (req.user.role === "master") {
      if (role) user.role = role;
      if (businessId) user.businessId = businessId;
      if (permissions) {
        user.permissions = { ...user.permissions, ...permissions };
      }
    }

    // 🔑 Optional: allow password change (hashed)
    if (password && password.trim().length > 0) {
      const bcrypt = require("bcryptjs");
      user.password = await bcrypt.hash(password, 10);
    }

    await user.save();

    res.json({
      ok: true,
      message: "✅ User updated successfully",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        businessId: user.businessId,
        isActive: user.isActive,
        permissions: user.permissions,
      },
    });
  } catch (err) {
    console.error("❌ Update User Error:", err);
res.status(500).json({ ok: false, error: err.message });

  }
};


exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    // 🛡 Safety: prevent self-deletion
    if (req.user._id.toString() === id) {
      return res.status(400).json({ ok: false, error: "You cannot delete your own account" });
    }

    // 🧩 Fetch target user
    const targetUser = await AdminUser.findById(id);
    if (!targetUser) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    // 🛡 Role-based access control
    if (req.user.role === "staff") {
      return res.status(403).json({ ok: false, error: "Staff cannot delete users" });
    }

    if (req.user.role === "admin" && targetUser.role === "admin") {
      return res.status(403).json({ ok: false, error: "Admins cannot delete other admins" });
    }

    // 🗑 Perform deletion
    await AdminUser.findByIdAndDelete(id);

    res.json({
      ok: true,
      message: `✅ User '${targetUser.name}' deleted successfully`,
    });
  } catch (err) {
    console.error("❌ Delete User Error:", err);
    res.status(500).json({ ok: false, error: "Server error while deleting user" });
  }
};



/* ---------------------------------------------------
   4. CREATE BUSINESS
--------------------------------------------------- */
exports.createBusiness = async (req, res) => {
  try {
    const { name, slug, twilioNumber, rewardPoints } = req.body;
    const imageUrl = req.file ? req.file.path : ""; // ensure string
    console.log("imageUrl :", req.file);

    if (!name || !slug) {
      return res.status(400).json({ error: "name and slug required" });
    }

    // ✅ Validate Twilio number if provided, otherwise use default
    let selectedTwilio = null;
    if (twilioNumber) {
      selectedTwilio = await TwilioNumber.findOne({ number: twilioNumber });
      if (!selectedTwilio)
        return res.status(400).json({ error: "Invalid Twilio number" });
    }

    const business = await Business.create({
      name,
      slug,
      twilioNumber: selectedTwilio
        ? selectedTwilio.number
        : process.env.DEFAULT_TWILIO_NUMBER || null, // default fallback
      logo: imageUrl,
      rewardPoints: rewardPoints || 0,
      rewards: [] // instead of null

    });


    console.log(business);
    res.json({ ok: true, business });
  } catch (err) {
    console.error("❌ Failed to create business:", err);
    res.status(500).json({ error: "Failed to save business" });
  }
};






/* ---------------------------------------------------
   5. UPDATE BUSINESS
--------------------------------------------------- */
exports.updateBusiness = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      name, 
      slug, 
      twilioNumber, 
      rewardPoints, 
      rewardThreshold,  // ✅ Added this
      welcomeText,       // ✅ Added this
      timezone,          // ✅ Added this
      branding, 
      ageGateEnabled, 
      ageGateMinAge 
    } = req.body;

    const business = await Business.findById(id);
    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    // Check permissions (admin can only update their business)
    if (req.user.role === 'admin' && req.user.businessId.toString() !== id) {
      return res.status(403).json({ error: "Access denied" });
    }

    // ✅ FIXED: Only validate if name is ACTUALLY changing
    const isNameChanging = name && name !== business.name;
    const isSlugChanging = slug && slug !== business.slug;

    // If name is changing, require slug to be provided
    if (isNameChanging && !slug) {
      return res.status(400).json({ 
        error: "Slug required when changing business name" 
      });
    }

    // If slug is changing, verify it's not taken
    if (isSlugChanging) {
      const existingBusiness = await Business.findOne({ 
        slug, 
        _id: { $ne: id } 
      });
      if (existingBusiness) {
        return res.status(400).json({ 
          error: "Slug already in use by another business" 
        });
      }
    }

    // Validate Twilio number if provided
    let selectedTwilio = null;
    if (twilioNumber) {
      selectedTwilio = await TwilioNumber.findOne({ number: twilioNumber });
      if (!selectedTwilio)
        return res.status(400).json({ error: "Invalid Twilio number" });
    }

    // ✅ Update fields
    if (name) business.name = name;
    if (slug) business.slug = slug;
    if (selectedTwilio) business.twilioNumber = selectedTwilio.number;
    if (rewardPoints !== undefined) business.rewardPoints = rewardPoints;
    if (branding) {
      business.branding = {
        ...business.branding,
        ...branding, // merge existing branding with new branding (e.g., logo)
      };
    }
    
    // Update age gate settings
    if (ageGateEnabled !== undefined) {
      business.ageGate = business.ageGate || {};
      business.ageGate.enabled = ageGateEnabled;
    }
    if (ageGateMinAge !== undefined) {
      business.ageGate = business.ageGate || {};
      business.ageGate.minAge = ageGateMinAge;
    }

    business.updatedAt = new Date();
    await business.save();

    res.json({ ok: true, business });
  } catch (err) {
    console.error("❌ Failed to update business:", err);
    res.status(500).json({ error: "Failed to update business" });
  }
};
/* ---------------------------------------------------
   5. GET BUSINESS BY SLUG
--------------------------------------------------- */
exports.getBusiness = async (req, res) => {
  try {
    const { slug } = req.params;
    const business = await Business.findOne({ slug });
    if (!business) return res.status(404).json({ error: "not found" });
    res.json({ ok: true, business });
  } catch (err) {
    console.error("❌ Failed to fetch business:", err);
    res.status(500).json({ error: "server error" });
  }
};

/* ---------------------------------------------------
   6. GET ALL BUSINESSES
--------------------------------------------------- */
exports.getAllBusinesses = async (req, res) => {
  try {
    let query = {};
    
    // ✅ Regular admins can only see their own business
    if (req.user.role === 'admin' && req.user.businessId) {
      query._id = req.user.businessId;
    }
    // Master/SuperAdmin see all businesses (no filter)
    
    const list = await Business.find(query).sort({ createdAt: -1 });
    res.json({ ok: true, list });
  } catch (err) {
    console.error("❌ Failed to fetch businesses:", err);
    res.status(500).json({ error: "server error" });
  }
};
/* ---------------------------------------------------
   8. UPLOAD LOGO
--------------------------------------------------- */
exports.uploadLogo = async (req, res) => {
  try {
    const { id } = req.params;

    console.log("controller")

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid business ID" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "file required" });
    }
     const imageUrl = req.file ? req.file.path : null;

    const logoPath = imageUrl;
    await Business.findByIdAndUpdate(id, { $set: { logo: logoPath } });

    res.json({ ok: true, logo: logoPath });
  } catch (err) {
    console.error("❌ Failed to upload logo:", err);
    res.status(500).json({ error: "server error" });
  }
};









/* ---------------------------------------------------
   8. DELETE BUSINESS (with cleanup)
--------------------------------------------------- */
exports.deleteBusiness = async (req, res) => {
  try {
    const { id } = req.params;

    console.log("🧹 Deleting all related data for:", id);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid business ID" });
    }

    const business = await Business.findById(id);
    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    // ✅ Delete related data
    await Promise.all([
      Reward.deleteMany({ businessId: id }),
      //Customer.deleteMany({ businessId: id }),
      Checkin.deleteMany({ businessId: id }),
      PointsLedger.deleteMany({ businessId: id }),
      InboundEvent.deleteMany({ businessId: id }),
    ]);

    console.log(`🧹 All related data for ${business.name} deleted.`);

    // ✅ Delete logo file if exists
    if (business.logo) {
      const logoPath = path.join(__dirname, `../${business.logo}`);
      if (fs.existsSync(logoPath)) {
        fs.unlinkSync(logoPath);
        console.log("🗑️ Logo deleted:", logoPath);
      }
    }

    // ✅ Finally, delete the business
    await Business.findByIdAndDelete(id);
    console.log("✅ Business deleted:", business.name);

    res.json({ ok: true, message: `${business.name} and related data deleted successfully` });
  } catch (err) {
    console.error("❌ Failed to delete business:", err);
    res.status(500).json({ error: err.message });
  }
};


/* ---------------------------------------------------
   8. TWILIO NUMBERS (GET / ADD)
--------------------------------------------------- */
exports.getTwilioNumbers = async (req, res) => {
  try {
    const numbers = await TwilioNumber.find().sort({ createdAt: -1 });
    res.json({ ok: true, numbers });
  } catch (err) {
    console.error("❌ Failed to get Twilio numbers:", err);
    res.status(500).json({ error: "server error" });
  }
};

exports.addTwilioNumber = async (req, res) => {
  try {
    const { number, friendlyName } = req.body;
    if (!number) return res.status(400).json({ error: "number required" });

    const exists = await TwilioNumber.findOne({ number });
    if (exists) return res.status(400).json({ error: "Number already exists" });

    const newNum = await TwilioNumber.create({ number, friendlyName });
    res.json({ ok: true, newNum });
  } catch (err) {
    console.error("❌ Failed to add Twilio number:", err);
    res.status(500).json({ error: "server error" });
  }
};

/* ---------------------------------------------------
   9. GET ALL CUSTOMER CONSENTS / CHECK-INS
--------------------------------------------------- */
exports.getConsents = async (req, res) => {
  try {
    // 🔹 Fetch check-ins with business info
    const checkins = await Checkin.find()
      .populate("businessId", "name slug")
      .sort({ createdAt: -1 });

    // 🔹 Build full list with inbound messages
    const list = await Promise.all(
      checkins.map(async (checkin) => {
        // find inbound messages for this checkin
        const inboundEvents = await InboundEvent.find({
          checkinId: checkin._id,
        })
          .sort({ createdAt: -1 })
          .lean();

        return {
          _id: checkin._id,
          phone: checkin.phone,
          businessName: checkin.businessId?.name || "Unknown",
          businessSlug: checkin.businessId?.slug || "",
          createdAt: checkin.createdAt,
          status: checkin.sentCompliance ? "Sent" : "Pending",

          // 🔹 Map inbound messages in frontend-friendly shape
          inboundEvents: inboundEvents.map((e) => ({
            from: e.fromNumber || "Unknown",
            message: e.body || "",
            type: e.eventType || "OTHER",
            createdAt: e.createdAt,
          })),
        };
      })
    );

    res.json({ ok: true, list });
  } catch (err) {
    console.error("❌ Failed to fetch check-ins:", err);
    res.status(500).json({ error: "Server error" });
  }
};

/* ---------------------------------------------------
   10. GET ALL INBOUND TWILIO EVENTS
--------------------------------------------------- */
exports.getInboundEvents = async (req, res) => {
  try {
    let query = {};
    if (req.user.role === 'admin' || req.user.role === 'staff') {
      query.businessId = req.user.businessId;
    }

    const items = await InboundEvent.find(query)
      .populate("checkinId", "phone businessId")
      .populate("businessId", "name slug")
      .sort({ createdAt: -1 })
      .limit(300)
      .lean();

    const list = items.map((e) => ({
      _id: e._id,
      from: e.fromNumber,
      message: e.body,
      type: e.eventType,
      businessName: e.businessId?.name || "Unknown",
      createdAt: e.createdAt,
    }));

    res.json({ ok: true, list });
  } catch (err) {
    console.error("❌ Failed to fetch inbound events:", err);
    res.status(500).json({ ok: false, error: "server error" });
  }
};


/* ---------------------------------------------------
   11. HANDLE INBOUND TWILIO WEBHOOK
--------------------------------------------------- */
exports.handleInboundTwilio = async (req, res) => {
  try {
    const { From, To, Body } = req.body;

    // Always keep + prefix
    const fromNumber = From?.startsWith("+") ? From : `+${From}`;
    const toNumber = To?.startsWith("+") ? To : `+${To}`;

    // Find checkin by sender number
    const checkin = await Checkin.findOne({ phone: fromNumber }).sort({ createdAt: -1 });

    const inbound = await InboundEvent.create({
      checkinId: checkin?._id || null,
      businessId: checkin?.businessId || null, // ✅ link business if known
      fromNumber,
      body: Body,
      eventType: "INBOUND_SMS",
      raw: req.body,
    });

    console.log("✅ Inbound event saved:", inbound._id);

    res.status(200).send("<Response></Response>");
  } catch (err) {
    console.error("❌ Failed to handle inbound Twilio event:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
};

//Rewards



exports.updateRewardSettings = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      rewardThreshold,
      maxActiveRewards,
      checkinCooldownHours,
      welcomeMessage,
      rewardExpiryDays
    } = req.body;

    const business = await Business.findById(id);
    if (!business) return res.status(404).json({ error: "Business not found" });

    if (rewardThreshold !== undefined) business.rewardThreshold = rewardThreshold;
    if (maxActiveRewards !== undefined) business.maxActiveRewards = maxActiveRewards;
    if (checkinCooldownHours !== undefined) business.checkinCooldownHours = checkinCooldownHours;
    if (welcomeMessage !== undefined) business.welcomeMessage = welcomeMessage;
    if (rewardExpiryDays !== undefined) business.rewardExpiryDays = rewardExpiryDays;

    await business.save();
    res.json({ ok: true, business });
  } catch (err) {
    //console.error("❌ Failed to update reward settings:", err);
    res.status(500).json({ error: "server error" });
  }
};


// ✅ REDEEM A REWARD
exports.redeemReward = async (req, res) => {
  try {
    const { id } = req.params;
    const reward = await Reward.findById(id);
    if (!reward) return res.status(404).json({ ok: false, error: "Reward not found" });

    reward.redeemed = true;
    await reward.save();

    res.json({ ok: true, reward });
  } catch (err) {
    console.error("❌ Error redeeming reward:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
};




/* ---------------------------------------------------
   11. GET BUSINESS REWARD STATS & POINTS LEDGER
--------------------------------------------------- */
// const Reward = require("../models/Reward");

exports.getBusinessRewardsOverview = async (req, res) => {
  try {
    const { id } = req.params; // businessId

    const business = await Business.findById(id);
    if (!business) return res.status(404).json({ error: "Business not found" });

    // 📊 Get total points + user-level data
    const pointsLedger = await PointsLedger.find({ businessId: business._id })
      .sort({ updatedAt: -1 })
      .select("phoneNumber points totalCheckins lastCheckinAt hasPendingReward");

    const totalPoints = pointsLedger.reduce((acc, l) => acc + (l.points || 0), 0);
    const totalUsers = pointsLedger.length;

    // 🎁 Active rewards
    const activeRewards = await Reward.find({
      businessId: business._id,
      redeemed: false,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    }).sort({ createdAt: -1 });

    res.json({
      ok: true,
      business: {
        id: business._id,
        name: business.name,
        rewardThreshold: business.rewardThreshold,
        checkinCooldownHours: business.checkinCooldownHours,
        welcomeMessage: business.welcomeMessage,
      },
      totalUsers,
      totalPoints,
      pointsLedger,
      activeRewards,
    });
  } catch (err) {
    console.error("❌ Failed to fetch reward overview:", err);
    res.status(500).json({ error: "Server error" });
  }
};






/* ---------------------------------------------------
   12. GET ALL POINTS LEDGER
--------------------------------------------------- */
exports.getPointsLedger = async (req, res) => {
  try {
    const list = await PointsLedger.find()
      .populate("businessId", "name")
      .sort({ createdAt: -1 })
      .lean();

    // 🧠 Add a direct field for businessName to simplify frontend
    const formattedList = list.map((item) => ({
      ...item,
      businessName: item.businessId?.name || "—",
    }));

    res.json({ ok: true, list: formattedList });
  } catch (err) {
    console.error("❌ Error fetching ledger:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
};





/* ---------------------------------------------------
   13. GET ALL REWARDS
--------------------------------------------------- */
exports.getAllRewards = async (req, res) => {
  try {
    let query = {};
    if (req.user.role === 'admin' || req.user.role === 'staff') {
      query.businessId = req.user.businessId;
    }

    console.log("👤 Role:", req.user.role);
    console.log("🔍 Query used:", query);

    const list = await Reward.find(query)
      .populate("businessId", "name slug")
      .sort({ createdAt: -1 });

    res.json({ ok: true, list });
  } catch (err) {
    console.error("❌ Error fetching rewards:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
};





//Graph Controller get checkin daily
/**
 * Get daily check-in statistics for the last 30 days
 * GET /admin/checkins/daily-stats
 * Uses CheckinLog collection to count check-ins
 */
exports.getDailyCheckinStats = async (req, res) => {
  try {
    const { businessId } = req.query;
    
    // DEBUGGING: Check what collections exist
    console.log('CheckinLog model collection name:', CheckinLog.collection.name);
    
    // Count total documents
    const totalDocs = await CheckinLog.countDocuments();
    console.log('Total CheckinLog documents:', totalDocs);
    
    // Get current date
    const now = new Date();
    
    // Calculate 30 days ago
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    console.log('Fetching check-ins from:', thirtyDaysAgo, 'to:', now);

    // Build query for CheckinLog
    const matchQuery = {
      createdAt: { $gte: thirtyDaysAgo },
      status: { $ne: "cooldown" } // Only count successful check-ins
    };

    // Add businessId filter if provided
    if (businessId) {
      matchQuery.businessId = new mongoose.Types.ObjectId(businessId);
    }

    console.log('Match query:', JSON.stringify(matchQuery));
    
    // Count matching documents
    const matchingDocs = await CheckinLog.countDocuments(matchQuery);
    console.log('Matching documents:', matchingDocs);
    
    // Get sample documents for debugging
    const sampleDocs = await CheckinLog.find(matchQuery).limit(3).lean();
    console.log('Sample documents:', JSON.stringify(sampleDocs, null, 2));

    // Aggregate check-ins by date from CheckinLog
    const dailyStats = await CheckinLog.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: {
            $dateToString: { 
              format: "%Y-%m-%d", 
              date: "$createdAt"
            }
          },
          totalCheckins: { $sum: 1 },
          uniqueCustomers: { $addToSet: "$phone" }
        }
      },
      {
        $project: {
          _id: 0,
          date: "$_id",
          totalCheckins: 1,
          uniqueCustomers: { $size: "$uniqueCustomers" }
        }
      },
      { $sort: { date: 1 } }
    ]);

    console.log(`Found ${dailyStats.length} days with check-ins`);
    console.log('All daily stats:', JSON.stringify(dailyStats, null, 2));

    // Create a map for quick lookup
    const statsMap = new Map(
      dailyStats.map(stat => [stat.date, stat])
    );

    // Fill in missing dates with 0
    const filledStats = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const existingStat = statsMap.get(dateStr);
      filledStats.push({
        date: dateStr,
        totalCheckins: existingStat?.totalCheckins || 0,
        uniqueCustomers: existingStat?.uniqueCustomers || 0
      });
    }

    // Get today's stats specifically for debugging
    const todayStr = now.toISOString().split('T')[0];
    const todayStats = filledStats.find(s => s.date === todayStr);
    console.log('Today\'s stats:', todayStats);
    console.log('Last 5 days:', filledStats.slice(-5));

    res.json({
      success: true,
      data: filledStats,
      debug: {
        collectionName: CheckinLog.collection.name,
        totalDocuments: totalDocs,
        matchingDocuments: matchingDocs,
        totalDaysWithData: dailyStats.length,
        todayDate: todayStr,
        todayCheckins: todayStats?.totalCheckins || 0,
        dateRange: {
          from: thirtyDaysAgo.toISOString(),
          to: now.toISOString()
        },
        sampleData: sampleDocs.length > 0 ? sampleDocs[0] : null
      }
    });
  } catch (error) {
    console.error('Error fetching daily check-in stats:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch daily statistics',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * Get overall check-in summary statistics
 * GET /admin/checkins/summary
 */
exports.getCheckinSummary = async (req, res) => {
  try {
    const { businessId } = req.query;
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const matchQuery = {
      status: { $ne: "cooldown" } // Only successful check-ins
    };

    if (businessId) {
      matchQuery.businessId = new mongoose.Types.ObjectId(businessId);
    }

    // Get stats from CheckinLog
    const [totalStats, recentStats] = await Promise.all([
      // All-time stats from CheckinLog
      CheckinLog.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: null,
            totalCheckins: { $sum: 1 },
            uniqueCustomers: { $addToSet: "$phone" }
          }
        },
        {
          $project: {
            _id: 0,
            totalCheckins: 1,
            uniqueCustomers: { $size: "$uniqueCustomers" }
          }
        }
      ]),
      
      // Last 30 days stats
      CheckinLog.aggregate([
        { 
          $match: { 
            ...matchQuery,
            createdAt: { $gte: thirtyDaysAgo }
          } 
        },
        {
          $group: {
            _id: null,
            recentCheckins: { $sum: 1 },
            activeCustomers: { $addToSet: "$phone" }
          }
        },
        {
          $project: {
            _id: 0,
            recentCheckins: 1,
            activeCustomers: { $size: "$activeCustomers" }
          }
        }
      ])
    ]);

    res.json({
      success: true,
      data: {
        totalCheckins: totalStats[0]?.totalCheckins || 0,
        uniqueCustomers: totalStats[0]?.uniqueCustomers || 0,
        recentCheckins: recentStats[0]?.recentCheckins || 0,
        activeCustomers: recentStats[0]?.activeCustomers || 0
      }
    });
  } catch (error) {
    console.error('Error fetching check-in summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch check-in summary',
      message: error.message
    });
  }
};




/* ---------------------------------------------------
   14. GET REWARD HISTORY
--------------------------------------------------- */
// controllers/rewardHistoryController.js
exports.getRewardHistory = async (req, res) => {
  try {
    const histories = await RewardHistory.find()
      .populate("businessId", "name")
      .populate("rewardId", "name code expiresAt redeemed description threshold")
      .populate("checkinId", "createdAt")
      .sort({ createdAt: -1 })
      .lean();

    const formatted = histories.map((h) => {
      const reward = h.rewardId || {};
      const business = h.businessId || {};

      // ✅ Final shape (frontend-ready)
      return {
        _id: h._id,
        business: { name: business.name || "—" }, // ✅ fix this line        
        phone: h.phone || "—",
        name: reward.name || "—",
        code: reward.code || "—",
        issuedAt: h.createdAt || null,
        expiresAt: reward.expiresAt || null,
        status:
          h.status ||
          (reward.redeemed
            ? "Redeemed"
            : reward.expiresAt && new Date(reward.expiresAt) < new Date()
            ? "Expired"
            : "Active"),
      };
    });

    res.json({ ok: true, list: formatted });
  } catch (err) {
    console.error("❌ Error fetching reward history:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
};





//Inbound Messages


// GET /admin/business/:id/points-ledger
exports.getBusinessPointsLedger = async (req, res) => {
  try {
    const { id } = req.params;

    const ledger = await PointsLedger.find({ businessId: id })
      .sort({ points: -1 })
      .lean();

    res.json({ ok: true, ledger });
  } catch (err) {
    console.error("💥 Error fetching points ledger:", err);
    res.status(500).json({ error: "server error" });
  }
};






// GET /admin/business/:id/checkins
exports.getBusinessCheckins = async (req, res) => {
  try {
    const { id } = req.params; // businessId

    const checkins = await Checkin.find({ businessId: id })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ ok: true, checkins });
  } catch (err) {
    console.error("💥 Error fetching checkins:", err);
    res.status(500).json({ error: "server error" });
  }
};


exports.redeemReward = async (req, res) => {
  try {
    const { businessName, phone, code } = req.body;

    // Validate required fields
    if (!businessName || !phone || !code) {
      return res.status(400).json({ 
        ok: false, 
        error: 'businessName, phone, and code are required' 
      });
    }

    // Normalize phone number
    let normalizedPhone = phone.trim().replace(/\D/g, "");
    if (!normalizedPhone.startsWith("1")) normalizedPhone = "1" + normalizedPhone;
    normalizedPhone = "+" + normalizedPhone;

    console.log("🔍 Looking for reward:", { businessName, phone: normalizedPhone, code });

    // Find the business by name
    const business = await Business.findOne({ name: businessName });
    
    if (!business) {
      return res.status(404).json({ 
        ok: false, 
        error: 'Business not found' 
      });
    }

    // Find the reward template by code/name
    const rewardTemplate = await Reward.findOne({ 
      businessId: business._id,
      phone: { $exists: false }, // Template only
      $or: [
        { code: code },
        { name: { $regex: new RegExp(code, 'i') } } // Fuzzy match
      ]
    });

    if (!rewardTemplate) {
      return res.status(404).json({ 
        ok: false, 
        error: 'Reward template not found' 
      });
    }

    // Find the reward history entry
    const rewardHistory = await RewardHistory.findOne({
      businessId: business._id,
      phone: normalizedPhone,
      rewardId: rewardTemplate._id,
      status: { $in: ['Active', 'Expired'] } // Can redeem Active or Expired
    });

    if (!rewardHistory) {
      return res.status(404).json({ 
        ok: false, 
        error: 'No active reward found for this customer' 
      });
    }

    // Check if already redeemed
    if (rewardHistory.status === 'Redeemed') {
      return res.status(400).json({ 
        ok: false, 
        error: 'Reward already redeemed' 
      });
    }

    // Check if expired (optional - you can allow redeeming expired ones)
    if (rewardHistory.expiresAt && new Date(rewardHistory.expiresAt) < new Date()) {
      // Update to expired if not already
      if (rewardHistory.status !== 'Expired') {
        rewardHistory.status = 'Expired';
      }
      
      // You can choose to allow or block expired redemption
      // Uncomment below to block:
      // await rewardHistory.save();
      // return res.status(400).json({ 
      //   ok: false, 
      //   error: 'Reward has expired' 
      // });
    }

    // Update status to Redeemed
    rewardHistory.status = 'Redeemed';
    rewardHistory.redeemedAt = new Date();
    await rewardHistory.save();

    console.log('✅ Reward redeemed:', {
      business: businessName,
      phone: normalizedPhone,
      reward: rewardTemplate.name
    });

    res.json({
      ok: true,
      message: 'Reward redeemed successfully',
      data: {
        businessName: business.name,
        phone: normalizedPhone,
        rewardName: rewardTemplate.name,
        status: rewardHistory.status,
        redeemedAt: rewardHistory.redeemedAt,
      },
    });

  } catch (error) {
    console.error('❌ Redeem error:', error);

    res.status(500).json({ 
      ok: false, 
      error: 'Server error while redeeming reward' 
    });
  }
};