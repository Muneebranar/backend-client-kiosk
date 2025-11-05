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

    // ✅ CASE 1: Default admin (master)
    if (email === DEFAULT_ADMIN_EMAIL && password === DEFAULT_ADMIN_PASSWORD) {
      // Sign token with role 'master'
      const token = jwt.sign(
        { id: "default-admin", role: "master" }, 
        JWT_SECRET, 
        { expiresIn: "7d" }
      );

      return res.status(200).json({
        ok: true,
        message: "Login successful",
        token,
        user: {
          id: "default-admin",
          name: "Admin",
          email: DEFAULT_ADMIN_EMAIL,
          role: "master", // ✅ Master admin role
          lastLogin: new Date(),
        },
      });
    }

    // ✅ CASE 2: Database users (admin/staff)
    const user = await AdminUser.findOne({ email }).populate("businessId", "name");
    if (!user) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ ok: false, error: "Invalid password" });
    }

    // ✅ Update last login timestamp
    user.lastLogin = new Date();
    await user.save();

    // ✅ Generate JWT
    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });

    // ✅ Extract businessId and businessName properly
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
        role: user.role, // Will be 'admin' or 'staff' from database
        businessId: businessId,
        businessName: businessName,
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



// ==========================================
// 📞 TWILIO NUMBER MANAGEMENT (COMPLETE)
// ==========================================

/**
 * Get all Twilio numbers
 * GET /admin/twilio-numbers
 */
exports.getTwilioNumbers = async (req, res) => {
  try {
    const numbers = await TwilioNumber.find().sort({ createdAt: -1 });
    
    res.json({ 
      ok: true, 
      numbers 
    });
  } catch (err) {
    console.error("❌ Failed to get Twilio numbers:", err);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to fetch Twilio numbers" 
    });
  }
};

/**
 * Add new Twilio number
 * POST /admin/twilio-numbers
 */
exports.addTwilioNumber = async (req, res) => {
  try {
    const { number, friendlyName } = req.body;

    // Validate required field
    if (!number) {
      return res.status(400).json({ 
        ok: false, 
        error: "Phone number is required" 
      });
    }

    // Normalize phone number format
    let cleanedNumber = number.replace(/\D/g, "");
    
    // Ensure it starts with country code
    if (!cleanedNumber.startsWith("1")) {
      cleanedNumber = "1" + cleanedNumber;
    }
    
    const formattedNumber = "+" + cleanedNumber;

    // Validate US/Canada format (11 digits starting with 1)
    if (cleanedNumber.length !== 11) {
      return res.status(400).json({ 
        ok: false, 
        error: "Invalid phone number format. Must be US/Canada format (+1XXXXXXXXXX)" 
      });
    }

    // Check if number already exists
    const existingNumber = await TwilioNumber.findOne({ number: formattedNumber });
    if (existingNumber) {
      return res.status(400).json({ 
        ok: false, 
        error: "This Twilio number already exists" 
      });
    }

    // Create new Twilio number
    const newNumber = await TwilioNumber.create({
      number: formattedNumber,
      friendlyName: friendlyName || formattedNumber,
      isActive: true,
      assignedBusinesses: []
    });

    console.log("✅ Twilio number added:", formattedNumber);

    res.status(201).json({ 
      ok: true, 
      message: "Twilio number added successfully",
      number: newNumber 
    });
  } catch (err) {
    console.error("❌ Failed to add Twilio number:", err);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to add Twilio number" 
    });
  }
};

/**
 * Update Twilio number
 * PUT /admin/twilio-numbers/:id
 */
exports.updateTwilioNumber = async (req, res) => {
  try {
    const { id } = req.params;
    const { friendlyName, isActive } = req.body;

    const twilioNumber = await TwilioNumber.findById(id);
    if (!twilioNumber) {
      return res.status(404).json({ 
        ok: false, 
        error: "Twilio number not found" 
      });
    }

    // Update fields
    if (friendlyName !== undefined) {
      twilioNumber.friendlyName = friendlyName;
    }
    if (isActive !== undefined) {
      twilioNumber.isActive = isActive;
    }

    await twilioNumber.save();

    console.log("✅ Twilio number updated:", twilioNumber.number);

    res.json({ 
      ok: true, 
      message: "Twilio number updated successfully",
      number: twilioNumber 
    });
  } catch (err) {
    console.error("❌ Failed to update Twilio number:", err);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to update Twilio number" 
    });
  }
};

/**
 * Delete Twilio number
 * DELETE /admin/twilio-numbers/:id
 */
exports.deleteTwilioNumber = async (req, res) => {
  try {
    const { id } = req.params;

    const twilioNumber = await TwilioNumber.findById(id);
    if (!twilioNumber) {
      return res.status(404).json({ 
        ok: false, 
        error: "Twilio number not found" 
      });
    }

    // Check if number is assigned to any businesses
    const assignedBusinesses = await Business.find({ 
      twilioNumber: twilioNumber.number 
    });

    if (assignedBusinesses.length > 0) {
      return res.status(400).json({ 
        ok: false, 
        error: `Cannot delete - this number is assigned to ${assignedBusinesses.length} business(es). Unassign it first.` 
      });
    }

    await TwilioNumber.findByIdAndDelete(id);

    console.log("✅ Twilio number deleted:", twilioNumber.number);

    res.json({ 
      ok: true, 
      message: "Twilio number deleted successfully" 
    });
  } catch (err) {
    console.error("❌ Failed to delete Twilio number:", err);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to delete Twilio number" 
    });
  }
};

/**
 * Assign Twilio number to business
 * PUT /admin/business/:id/twilio-number
 * ✅ FIXED: Supports master admin and business admins
 */
exports.assignTwilioNumber = async (req, res) => {
  try {
    const { id } = req.params;
    const { twilioNumber, isActive } = req.body;

    console.log('🔧 assignTwilioNumber called:', {
      businessId: id,
      twilioNumber,
      isActive,
      userRole: req.user?.role,
      userId: req.user?.id || req.user?._id,
      userBusinessId: req.user?.businessId
    });

    // Find business
    const business = await Business.findById(id);
    if (!business) {
      console.log('❌ Business not found:', id);
      return res.status(404).json({ 
        ok: false, 
        error: "Business not found" 
      });
    }

    // ✅ FIXED: Permission check for master admin and business admins
    // master = full access to all businesses (no businessId)
    // admin = can manage their own business only
    // staff = can manage their own business only
    
    const isMaster = req.user.role === 'master';
    
    // For database users with businessId
    let isOwnBusiness = false;
    if (req.user.businessId) {
      // Handle both ObjectId and string comparison
      const userBusinessId = req.user.businessId._id 
        ? req.user.businessId._id.toString() 
        : req.user.businessId.toString();
      isOwnBusiness = userBusinessId === business._id.toString();
    }
    
    // Allow if master OR managing own business
    if (!isMaster && !isOwnBusiness) {
      console.log('❌ Access denied:', {
        userRole: req.user.role,
        userBusinessId: req.user.businessId,
        targetBusinessId: business._id,
        isMaster,
        isOwnBusiness
      });
      return res.status(403).json({ 
        ok: false, 
        error: "Access denied - you can only manage your own business" 
      });
    }

    console.log('✅ Permission granted:', {
      userRole: req.user.role,
      isMaster,
      isOwnBusiness
    });

    // If unassigning (empty twilioNumber)
    if (!twilioNumber || twilioNumber === "") {
      console.log('🔄 Unassigning number from business:', business.name);
      
      // Remove from old Twilio number's assignedBusinesses
      if (business.twilioNumber) {
        await TwilioNumber.updateOne(
          { number: business.twilioNumber },
          { $pull: { assignedBusinesses: business._id.toString() } }
        );
      }

      business.twilioNumber = null;
      business.twilioNumberActive = false;
      await business.save();

      console.log('✅ Number unassigned successfully');

      return res.json({
        ok: true,
        message: "Twilio number unassigned successfully",
        business,
      });
    }

    // Validate that Twilio number exists
    const twilioDoc = await TwilioNumber.findOne({ number: twilioNumber });
    if (!twilioDoc) {
      console.log('❌ Twilio number not found:', twilioNumber);
      return res.status(400).json({ 
        ok: false, 
        error: "Invalid Twilio number - not found in system" 
      });
    }

    console.log('🔄 Assigning number to business:', {
      business: business.name,
      number: twilioNumber,
      isActive
    });

    // Remove business from old Twilio number (if changing)
    if (business.twilioNumber && business.twilioNumber !== twilioNumber) {
      await TwilioNumber.updateOne(
        { number: business.twilioNumber },
        { $pull: { assignedBusinesses: business._id.toString() } }
      );
    }

    // Add business to new Twilio number's assignedBusinesses
    await TwilioNumber.updateOne(
      { number: twilioNumber },
      { $addToSet: { assignedBusinesses: business._id.toString() } }
    );

    // Update business
    business.twilioNumber = twilioNumber;
    business.twilioNumberActive = isActive !== undefined ? isActive : true;
    await business.save();

    console.log("✅ Twilio number assigned:", {
      business: business.name,
      number: twilioNumber,
      active: business.twilioNumberActive
    });

    res.json({
      ok: true,
      message: "Twilio number assigned successfully",
      business,
    });
  } catch (err) {
    console.error("❌ Failed to assign Twilio number:", err);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to assign Twilio number",
      message: err.message 
    });
  }
};

/**
 * Get Twilio numbers with business assignments
 * GET /admin/twilio-numbers/with-assignments
 */
exports.getTwilioNumbersWithAssignments = async (req, res) => {
  try {
    const numbers = await TwilioNumber.find().sort({ createdAt: -1 });
    
    // Get all businesses for assignment info
    const businesses = await Business.find().select('name twilioNumber twilioNumberActive');
    
    // Map numbers with their assigned businesses
    const numbersWithAssignments = numbers.map(num => {
      const assignedBusinesses = businesses.filter(
        b => b.twilioNumber === num.number
      );
      
      return {
        ...num.toObject(),
        assignedBusinesses: assignedBusinesses.map(b => ({
          _id: b._id,
          name: b.name,
          isActive: b.twilioNumberActive
        }))
      };
    });

    res.json({ 
      ok: true, 
      numbers: numbersWithAssignments 
    });
  } catch (err) {
    console.error("❌ Failed to get Twilio numbers with assignments:", err);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to fetch Twilio numbers" 
    });
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


exports.getBusinessById = async (req, res) => {
  try {
    const { id } = req.params; // expecting /business/:id
    const business = await Business.findById(id);

    if (!business) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }

    res.json({ ok: true, business });
  } catch (err) {
    console.error("❌ Failed to fetch business by ID:", err);

    // Handle invalid ObjectId error
    if (err.kind === 'ObjectId') {
      return res.status(400).json({ ok: false, error: "Invalid business ID" });
    }

    res.status(500).json({ ok: false, error: "Server error" });
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







exports.addCustomerCheckin = async (req, res) => {
  try {
    const { id } = req.params;
    const { businessId, role } = req.user;
    
    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ ok: false, error: "Customer not found" });
    }

    // ✅ Check if customer is blocked
    if (customer.subscriberStatus === "blocked") {
      return res.status(403).json({
        ok: false,
        error: "Customer is blocked and cannot check in",
      });
    }

    // ✅ Check business access for non-master users
    if (role !== "master" && customer.businessId.toString() !== businessId.toString()) {
      return res.status(403).json({
        ok: false,
        error: "Access denied - customer belongs to different business",
      });
    }

    // ✅ UPDATE CUSTOMER: Add points and increment check-in count
    customer.points = (customer.points || 0) + 1;
    customer.totalCheckins = (customer.totalCheckins || 0) + 1;
    customer.lastCheckinAt = new Date();
    
    if (!customer.firstCheckinAt) {
      customer.firstCheckinAt = new Date();
    }

    await customer.save();

    // ✅ CREATE CHECK-IN LOG
    const checkin = new CheckinLog({
      businessId: role === 'master' ? customer.businessId : businessId,
      customerId: customer._id, // ✅ Add customer ID reference
      phone: customer.phone,
      pointsAwarded: 1, // ✅ Track points awarded
      type: "manual", // ✅ Mark as manual check-in
      addedBy: req.user._id || req.user.username, // ✅ Track who added it
      status: "completed",
    });
    
    await checkin.save();

    // ✅ OPTIONAL: Create points ledger entry
    // await PointsLedger.create({
    //   customerId: customer._id,
    //   businessId: customer.businessId,
    //   type: "earned",
    //   points: 1,
    //   balance: customer.points,
    //   description: "Manual check-in by admin",
    // });

    // ✅ Return updated customer data
    res.json({
      ok: true,
      success: true,
      message: "Check-in added successfully",
      customer: {
        _id: customer._id,
        phone: customer.phone,
        points: customer.points,
        totalCheckins: customer.totalCheckins,
        lastCheckinAt: customer.lastCheckinAt,
      },
      checkin,
    });
  } catch (err) {
    console.error("❌ addCustomerCheckin Error:", err);
    res.status(500).json({
      ok: false,
      error: "Server error",
      message: err.message,
    });
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
   GET ALL INBOUND TWILIO EVENTS
--------------------------------------------------- */
exports.getInboundEvents = async (req, res) => {
  try {
    let query = {};
    
    // Filter by business for non-master admins
    if (req.user.role === 'admin' || req.user.role === 'staff') {
      if (!req.user.businessId) {
        return res.status(403).json({ 
          ok: false, 
          error: 'No business assigned' 
        });
      }
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
      from: e.fromNumber,           // ✅ Customer phone
      to: e.toNumber,                // ✅ Your Twilio number (added)
      message: e.body,
      type: e.eventType,
      status: e.status || 'received',
      businessName: e.businessId?.name || "Unknown",
      businessId: e.businessId?._id,
      createdAt: e.createdAt,
      messageSid: e.messageSid
    }));

    res.json({ ok: true, list });
  } catch (err) {
    console.error("❌ Failed to fetch inbound events:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
};

/* ---------------------------------------------------
   HANDLE INBOUND TWILIO WEBHOOK
--------------------------------------------------- */
exports.handleInboundTwilio = async (req, res) => {
  try {
    const { From, To, Body, MessageSid, AccountSid } = req.body;

    console.log("📨 Inbound SMS received:", {
      from: From,
      to: To,
      body: Body?.substring(0, 50)
    });

    // Normalize phone numbers (keep + prefix)
    const fromNumber = From?.startsWith("+") ? From : `+${From}`;
    const toNumber = To?.startsWith("+") ? To : `+${To}`;

    // Find which business owns this Twilio number
    let businessId = null;
    const twilioNumber = await TwilioNumber.findOne({ 
      phoneNumber: toNumber,
      isActive: true 
    });

    if (twilioNumber?.businessId) {
      businessId = twilioNumber.businessId;
      console.log(`✅ Found business for ${toNumber}:`, businessId);
    }

    // Try to find recent checkin from this customer
    let checkin = null;
    if (fromNumber) {
      checkin = await Checkin.findOne({ 
        phone: fromNumber 
      })
        .sort({ createdAt: -1 })
        .limit(1);
      
      // If we found a checkin but didn't have businessId, use it from checkin
      if (checkin && !businessId) {
        businessId = checkin.businessId;
        console.log(`✅ Found business from checkin:`, businessId);
      }
    }

    // Create inbound event record
    const inbound = await InboundEvent.create({
      checkinId: checkin?._id || null,
      businessId: businessId || null,
      fromNumber,
      toNumber,  // ✅ Now saving the recipient number
      body: Body,
      eventType: "INBOUND_SMS",
      messageSid: MessageSid,
      accountSid: AccountSid,
      status: 'received',
      raw: req.body,
    });

    console.log("✅ Inbound event saved:", {
      id: inbound._id,
      from: fromNumber,
      to: toNumber,
      business: businessId
    });

    // Send Twilio response (empty TwiML = no auto-reply)
    res.status(200).type('text/xml').send("<Response></Response>");
    
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


// 📦 Create a new Reward
exports.createReward = async (req, res) => {
  try {
    const {
      name,
      description,
      threshold,
      code,
      expiryDays,
      discountType,
      discountValue,
      priority,
    } = req.body;

    // ✅ Ensure businessId is coming from logged-in admin/staff
    const businessId =
      req.user.role === "superadmin"
        ? req.body.businessId
        : req.user.businessId;

    if (!businessId || !name || !threshold || !code) {
      return res.status(400).json({
        ok: false,
        message: "businessId, name, threshold, and code are required.",
      });
    }

    // ✅ Check for duplicate reward code
    const existing = await Reward.findOne({ code });
    if (existing) {
      return res.status(400).json({
        ok: false,
        message: "Reward code already exists. Use a unique one.",
      });
    }

    // ✅ Calculate expiry date
    let expiresAt = null;
    if (expiryDays && Number(expiryDays) > 0) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + Number(expiryDays));
    }

    // ✅ Create reward
    const reward = new Reward({
      businessId,
      name,
      description: description || "",
      threshold,
      code,
      expiryDays,
      expiresAt,
      discountType: discountType || "none",
      discountValue: discountValue || 0,
      priority: priority || 1,
    });

    await reward.save();

    res.status(201).json({
      ok: true,
      message: "Reward created successfully.",
      data: reward,
    });
  } catch (err) {
    console.error("❌ Error creating reward:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
};
/**
 * Get dashboard statistics (customers, rewards, check-ins)
 * GET /admin/dashboard-stats
 * Works for both master (all businesses) and admin (specific business)
 */
exports.getDashboardStats = async (req, res) => {
  try {
    const { businessId } = req.query;
    const userRole = req.user?.role || 'admin';

    console.log('📊 getDashboardStats called:', { 
      role: userRole, 
      businessId: businessId || 'ALL',
      userId: req.user?.id 
    });

    // Build query filters
    const customerQuery = { 
      deleted: { $ne: true },
      isDeleted: { $ne: true },
      subscriberStatus: { $nin: ['blocked', 'opted-out', 'invalid'] }
    };
    
    const rewardQuery = {};
    const checkinQuery = {
      status: { $ne: 'cooldown' }
    };

    // For non-master users, filter by businessId
    if (userRole !== 'master' && businessId) {
      const bid = new mongoose.Types.ObjectId(businessId);
      customerQuery.businessId = bid;
      rewardQuery.businessId = bid;
      checkinQuery.businessId = bid;
    }

    console.log('Query filters:', { customerQuery, rewardQuery, checkinQuery });

    // Fetch data in parallel
    const [customers, rewards, checkinStats] = await Promise.all([
      Customer.find(customerQuery).lean(),
      Reward.find(rewardQuery).lean(),
      CheckinLog.aggregate([
        { $match: checkinQuery },
        {
          $group: {
            _id: null,
            totalCheckins: { $sum: 1 }
          }
        }
      ])
    ]);

    console.log('Raw data counts:', {
      customers: customers.length,
      rewards: rewards.length,
      totalCheckins: checkinStats[0]?.totalCheckins || 0
    });

    // Calculate stats
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    let activeCustomers = 0;
    customers.forEach(customer => {
      if (customer.lastCheckinAt && new Date(customer.lastCheckinAt) >= thirtyDaysAgo) {
        activeCustomers++;
      }
    });

    const stats = {
      totalCustomers: customers.length,
      activeCustomers,
      totalCheckins: checkinStats[0]?.totalCheckins || 0,
      totalRewardsIssued: rewards.length,
      activeRewards: rewards.filter(r => !r.redeemed && !r.expired).length
    };

    console.log('✅ Final stats:', stats);

    res.json({
      success: true,
      data: stats,
      meta: {
        role: userRole,
        businessId: businessId || 'ALL',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('❌ Error in getDashboardStats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard statistics',
      message: error.message
    });
  }
};

/**
 * Get daily check-in statistics for the last 30 days
 * GET /admin/checkins/daily-stats
 */
exports.getDailyCheckinStats = async (req, res) => {
  try {
    const { businessId } = req.query;
    const userRole = req.user?.role || 'admin';

    console.log('📊 getDailyCheckinStats called:', { 
      role: userRole, 
      businessId: businessId || 'ALL' 
    });

    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    // Build match query
    const matchQuery = {
      status: { $ne: 'cooldown' },
      createdAt: { $gte: thirtyDaysAgo }
    };

    // For non-master users, filter by businessId
    if (userRole !== 'master' && businessId) {
      matchQuery.businessId = new mongoose.Types.ObjectId(businessId);
    }

    console.log('Daily stats match query:', matchQuery);

    // Aggregate by day
    const dailyStats = await CheckinLog.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          totalCheckins: { $sum: 1 },
          uniqueCustomers: { $addToSet: '$phone' }
        }
      },
      {
        $project: {
          _id: 0,
          date: '$_id',
          totalCheckins: 1,
          uniqueCustomers: { $size: '$uniqueCustomers' }
        }
      },
      { $sort: { date: 1 } }
    ]);

    console.log(`Found ${dailyStats.length} days with data`);

    // Fill missing days with zeros
    const statsMap = new Map(dailyStats.map(stat => [stat.date, stat]));
    const filledStats = [];
    
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const stat = statsMap.get(dateStr) || { 
        date: dateStr,
        totalCheckins: 0, 
        uniqueCustomers: 0 
      };
      
      filledStats.push(stat);
    }

    console.log('✅ Returning 30 days of data');
    console.log('Sample data (last 3 days):', filledStats.slice(-3));

    res.json({
      success: true,
      data: filledStats,
      meta: {
        role: userRole,
        businessId: businessId || 'ALL',
        totalDaysWithData: dailyStats.length,
        dateRange: {
          from: filledStats[0]?.date,
          to: filledStats[filledStats.length - 1]?.date
        }
      }
    });
  } catch (error) {
    console.error('❌ Error in getDailyCheckinStats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch daily statistics',
      message: error.message
    });
  }
};

/**
 * Get check-in summary
 * GET /admin/checkins/summary
 */
exports.getCheckinSummary = async (req, res) => {
  try {
    const { businessId } = req.query;
    const userRole = req.user?.role || 'admin';

    console.log('📊 getCheckinSummary called:', { role: userRole, businessId });

    const matchQuery = { status: { $ne: 'cooldown' } };
    
    if (userRole !== 'master' && businessId) {
      matchQuery.businessId = new mongoose.Types.ObjectId(businessId);
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisWeek = new Date(now);
    thisWeek.setDate(thisWeek.getDate() - 7);
    const thisMonth = new Date(now);
    thisMonth.setDate(thisMonth.getDate() - 30);

    const [todayCount, weekCount, monthCount, totalCount] = await Promise.all([
      CheckinLog.countDocuments({ ...matchQuery, createdAt: { $gte: today } }),
      CheckinLog.countDocuments({ ...matchQuery, createdAt: { $gte: thisWeek } }),
      CheckinLog.countDocuments({ ...matchQuery, createdAt: { $gte: thisMonth } }),
      CheckinLog.countDocuments(matchQuery)
    ]);

    const summary = {
      today: todayCount,
      last7Days: weekCount,
      last30Days: monthCount,
      allTime: totalCount
    };

    console.log('✅ Check-in summary:', summary);

    res.json({
      success: true,
      data: summary,
      meta: {
        role: userRole,
        businessId: businessId || 'ALL'
      }
    });
  } catch (error) {
    console.error('❌ Error in getCheckinSummary:', error);
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