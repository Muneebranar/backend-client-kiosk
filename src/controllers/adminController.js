const twilio = require("twilio");
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
    
    // ✅ Get current user ID (handle both _id and id)
    const currentUserId = req.user._id ? req.user._id.toString() : req.user.id;
    
    // 🛡 Safety: prevent self-deletion
    if (currentUserId === id) {
      return res.status(400).json({ 
        ok: false, 
        error: "You cannot delete your own account" 
      });
    }

    // 🧩 Fetch target user
    const targetUser = await AdminUser.findById(id);
    if (!targetUser) {
      return res.status(404).json({ 
        ok: false, 
        error: "User not found" 
      });
    }

    // 🛡 Role-based access control
    if (req.user.role === "staff") {
      return res.status(403).json({ 
        ok: false, 
        error: "Staff cannot delete users" 
      });
    }

    if (req.user.role === "admin") {
      // Admins can only delete staff from their own business
      if (targetUser.role === "admin") {
        return res.status(403).json({ 
          ok: false, 
          error: "Admins cannot delete other admins" 
        });
      }
      
      // ✅ Check if target user belongs to the same business
      const adminBusinessId = req.user.businessId ? req.user.businessId.toString() : null;
      const targetBusinessId = targetUser.businessId ? targetUser.businessId.toString() : null;
      
      if (adminBusinessId && targetBusinessId && adminBusinessId !== targetBusinessId) {
        return res.status(403).json({ 
          ok: false, 
          error: "You can only delete users from your own business" 
        });
      }
    }

    // 🛡 Master/Superadmin protection
    if (targetUser.role === "master" || targetUser.role === "superadmin") {
      if (req.user.role !== "master" && req.user.role !== "superadmin") {
        return res.status(403).json({ 
          ok: false, 
          error: "Only master/superadmin can delete master/superadmin users" 
        });
      }
    }

    // 🗑 Perform deletion
    await AdminUser.findByIdAndDelete(id);

    console.log(`✅ User deleted: ${targetUser.name} (${targetUser.email}) by ${req.user.name || req.user.id}`);

    res.json({
      ok: true,
      message: `✅ User '${targetUser.name}' deleted successfully`,
    });
  } catch (err) {
    console.error("❌ Delete User Error:", err);
    res.status(500).json({ 
      ok: false, 
      error: "Server error while deleting user" 
    });
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
 * Add these functions to your adminController.js
 */

/**
 * Sync Twilio number assignments
 * POST /admin/twilio-numbers/sync
 * Fixes mismatches between Business.twilioNumber and TwilioNumber.assignedBusinesses
 */
exports.syncTwilioNumberAssignments = async (req, res) => {
  try {
    console.log('🔧 Starting Twilio number sync...');

    // Get all businesses with Twilio numbers
    const businesses = await Business.find({ 
      twilioNumber: { $exists: true, $ne: null, $ne: '' }
    }).select('_id name twilioNumber twilioNumberActive');

    // Get all Twilio numbers
    const twilioNumbers = await TwilioNumber.find();
    const defaultNumber = process.env.DEFAULT_TWILIO_NUMBER;

    // Build correct assignment map
    const correctAssignments = new Map();
    
    for (const business of businesses) {
      const number = business.twilioNumber;
      
      // Skip default number
      if (number === defaultNumber) continue;

      if (!correctAssignments.has(number)) {
        correctAssignments.set(number, []);
      }
      correctAssignments.get(number).push(business._id.toString());
    }

    // Fix each Twilio number
    let fixedCount = 0;
    const changes = [];
    
    for (const twilioNum of twilioNumbers) {
      const expectedIds = correctAssignments.get(twilioNum.number) || [];
      const currentIds = twilioNum.assignedBusinesses || [];

      // Check if needs update
      const currentSet = new Set(currentIds);
      const expectedSet = new Set(expectedIds);
      
      const needsUpdate = 
        currentSet.size !== expectedSet.size ||
        ![...currentSet].every(id => expectedSet.has(id));

      if (needsUpdate) {
        changes.push({
          number: twilioNum.number,
          friendlyName: twilioNum.friendlyName,
          before: currentIds,
          after: expectedIds
        });
        
        twilioNum.assignedBusinesses = expectedIds;
        await twilioNum.save();
        fixedCount++;
      }
    }

    console.log(`✅ Sync completed: ${fixedCount} numbers updated`);

    res.json({
      ok: true,
      message: `Sync completed successfully`,
      stats: {
        totalNumbers: twilioNumbers.length,
        totalBusinesses: businesses.length,
        numbersFixed: fixedCount
      },
      changes: changes
    });

  } catch (err) {
    console.error("❌ Failed to sync Twilio numbers:", err);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to sync Twilio numbers",
      message: err.message 
    });
  }
};

/**
 * Get diagnostic info about Twilio number assignments
 * GET /admin/twilio-numbers/diagnostics
 */
exports.getTwilioNumberDiagnostics = async (req, res) => {
  try {
    // Get all businesses with Twilio numbers
    const businesses = await Business.find({ 
      twilioNumber: { $exists: true, $ne: null, $ne: '' }
    }).select('_id name twilioNumber twilioNumberActive');

    // Get all Twilio numbers
    const twilioNumbers = await TwilioNumber.find();
    const defaultNumber = process.env.DEFAULT_TWILIO_NUMBER;

    // Build maps
    const businessMap = new Map();
    const twilioMap = new Map();
    
    // Map businesses to their numbers
    for (const business of businesses) {
      const number = business.twilioNumber;
      if (!businessMap.has(number)) {
        businessMap.set(number, []);
      }
      businessMap.get(number).push({
        id: business._id.toString(),
        name: business.name,
        active: business.twilioNumberActive
      });
    }

    // Map Twilio numbers to their assignments
    for (const twilioNum of twilioNumbers) {
      twilioMap.set(twilioNum.number, {
        friendlyName: twilioNum.friendlyName,
        assignedBusinesses: twilioNum.assignedBusinesses || []
      });
    }

    // Find mismatches
    const mismatches = [];
    const orphanedNumbers = [];
    const missingNumbers = [];

    // Check each Twilio number
    for (const [number, data] of twilioMap) {
      const businessesUsingThis = businessMap.get(number) || [];
      const expectedIds = businessesUsingThis.map(b => b.id);
      const currentIds = data.assignedBusinesses;

      const currentSet = new Set(currentIds);
      const expectedSet = new Set(expectedIds);
      
      const isMismatch = 
        currentSet.size !== expectedSet.size ||
        ![...currentSet].every(id => expectedSet.has(id));

      if (isMismatch) {
        mismatches.push({
          number: number,
          friendlyName: data.friendlyName,
          currentAssignments: currentIds,
          expectedAssignments: expectedIds,
          businesses: businessesUsingThis
        });
      }

      if (businessesUsingThis.length === 0 && currentIds.length > 0) {
        orphanedNumbers.push({
          number: number,
          friendlyName: data.friendlyName,
          staleAssignments: currentIds
        });
      }
    }

    // Check for businesses using numbers not in TwilioNumber collection
    for (const [number, businesses] of businessMap) {
      if (number !== defaultNumber && !twilioMap.has(number)) {
        missingNumbers.push({
          number: number,
          businesses: businesses
        });
      }
    }

    res.json({
      ok: true,
      summary: {
        totalTwilioNumbers: twilioNumbers.length,
        totalBusinessesWithNumbers: businesses.length,
        defaultNumber: defaultNumber,
        mismatches: mismatches.length,
        orphanedNumbers: orphanedNumbers.length,
        missingNumbers: missingNumbers.length
      },
      details: {
        mismatches: mismatches,
        orphanedNumbers: orphanedNumbers,
        missingNumbers: missingNumbers
      }
    });

  } catch (err) {
    console.error("❌ Failed to get diagnostics:", err);
    res.status(500).json({ 
      ok: false, 
      error: "Failed to get diagnostics",
      message: err.message 
    });
  }
};



/**
 * Get all Twilio numbers
 * GET /admin/twilio-numbers
 */
exports.getTwilioNumbers = async (req, res) => {
  try {
    // Get numbers from database
    const dbNumbers = await TwilioNumber.find().sort({ createdAt: -1 });

    // Get default number from environment
    const defaultNumber = process.env.DEFAULT_TWILIO_NUMBER;
    
    // Combine database numbers with default number
    const allNumbers = [...dbNumbers];
    
    // Add default number if it exists and isn't already in the database
    if (defaultNumber) {
      const isInDb = dbNumbers.some(num => num.number === defaultNumber);
      if (!isInDb) {
        allNumbers.unshift({
          _id: defaultNumber, // Use the number itself as ID for default
          number: defaultNumber,
          friendlyName: "Default System Number",
          isActive: true,
          isDefault: true, // Flag to identify it's from env
          assignedBusinesses: []
        });
      }
    }

    res.json({ 
      ok: true, 
      numbers: allNumbers 
    });
  } catch (err) {
    console.error("❌ Failed to fetch Twilio numbers:", err);
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

    // Check if it's the default number
    const defaultNumber = process.env.DEFAULT_TWILIO_NUMBER;
    if (formattedNumber === defaultNumber) {
      return res.status(400).json({ 
        ok: false, 
        error: "This is the default system number. It's already available." 
      });
    }

    // Check if number already exists in database
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

    // Check if this is the default Twilio number
    const defaultNumber = process.env.DEFAULT_TWILIO_NUMBER;
    if (id === defaultNumber) {
      return res.status(400).json({ 
        ok: false, 
        error: "Cannot update the default Twilio number. It's configured in environment variables." 
      });
    }

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
/**
 * Assign Twilio number to business
 * PUT /admin/business/:id/twilio-number
 * ✅ FIXED: Properly updates assignedBusinesses array
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

    // ✅ Permission check for master admin and business admins
    const isMaster = req.user.role === 'master';
    
    let isOwnBusiness = false;
    if (req.user.businessId) {
      const userBusinessId = req.user.businessId._id 
        ? req.user.businessId._id.toString() 
        : req.user.businessId.toString();
      isOwnBusiness = userBusinessId === business._id.toString();
    }
    
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

    const businessIdString = business._id.toString();
    const defaultNumber = process.env.DEFAULT_TWILIO_NUMBER;

    // ✅ CASE 1: Unassigning number (empty twilioNumber)
    if (!twilioNumber || twilioNumber === "") {
      console.log('🔄 Unassigning number from business:', business.name);
      
      // Remove from old Twilio number's assignedBusinesses
      if (business.twilioNumber && business.twilioNumber !== defaultNumber) {
        const updateResult = await TwilioNumber.updateOne(
          { number: business.twilioNumber },
          { $pull: { assignedBusinesses: businessIdString } }
        );
        console.log('   Removed from old number:', updateResult);
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

    // Check if it's the default number
    const isDefaultNumber = twilioNumber === defaultNumber;

    // ✅ Validate that Twilio number exists (skip validation for default number)
    if (!isDefaultNumber) {
      const twilioDoc = await TwilioNumber.findOne({ number: twilioNumber });
      if (!twilioDoc) {
        console.log('❌ Twilio number not found in database:', twilioNumber);
        return res.status(400).json({ 
          ok: false, 
          error: "Invalid Twilio number - not found in system" 
        });
      }
    }

    console.log('🔄 Assigning number to business:', {
      business: business.name,
      number: twilioNumber,
      isDefault: isDefaultNumber,
      isActive
    });

    // ✅ CASE 2: Remove business from OLD number (if changing numbers)
    if (business.twilioNumber && business.twilioNumber !== twilioNumber) {
      const oldIsDefault = business.twilioNumber === defaultNumber;
      
      if (!oldIsDefault) {
        const removeResult = await TwilioNumber.updateOne(
          { number: business.twilioNumber },
          { $pull: { assignedBusinesses: businessIdString } }
        );
        console.log('   Removed from old number:', {
          oldNumber: business.twilioNumber,
          modifiedCount: removeResult.modifiedCount
        });
      }
    }

    // ✅ CASE 3: Add business to NEW number (only if not default)
    if (!isDefaultNumber) {
      // First, check if already in array
      const existingDoc = await TwilioNumber.findOne({ 
        number: twilioNumber,
        assignedBusinesses: businessIdString 
      });

      if (!existingDoc) {
        const addResult = await TwilioNumber.updateOne(
          { number: twilioNumber },
          { $addToSet: { assignedBusinesses: businessIdString } }
        );
        console.log('   Added to new number:', {
          newNumber: twilioNumber,
          modifiedCount: addResult.modifiedCount
        });
      } else {
        console.log('   Business already assigned to this number');
      }

      // ✅ Verify the update
      const verifyDoc = await TwilioNumber.findOne({ number: twilioNumber });
      console.log('   Verification - assignedBusinesses:', verifyDoc?.assignedBusinesses);
    }

    // ✅ CASE 4: Update business document
    business.twilioNumber = twilioNumber;
    business.twilioNumberActive = isActive !== undefined ? isActive : true;
    await business.save();

    console.log("✅ Twilio number assigned successfully:", {
      business: business.name,
      number: twilioNumber,
      isDefault: isDefaultNumber,
      active: business.twilioNumberActive
    });

    res.json({
      ok: true,
      message: `Twilio number assigned successfully${isDefaultNumber ? ' (Default System Number)' : ''}`,
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
   9. DELETE LOGO
--------------------------------------------------- */
exports.deleteLogo = async (req, res) => {
  try {
    const { id } = req.params;

    console.log("🗑️ Deleting logo for business:", id);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "Invalid business ID" });
    }

    const business = await Business.findById(id);
    
    if (!business) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }

    // Delete logo file if exists
    if (business.logo) {
      const logoPath = path.join(__dirname, `../${business.logo}`);
      if (fs.existsSync(logoPath)) {
        fs.unlinkSync(logoPath);
        console.log("✅ Logo file deleted:", logoPath);
      }
    }

    // Remove logo from database
    business.logo = null;
    await business.save();

    console.log("✅ Logo removed from business");

    res.json({ ok: true, message: "Logo removed successfully" });
  } catch (err) {
    console.error("❌ Failed to delete logo:", err);
    res.status(500).json({ ok: false, error: "Failed to delete logo" });
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
      from: e.fromNumber,
      to: e.toNumber,
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
   ✅ AUTO UNSUBSCRIBE/RESUBSCRIBE based on STOP/START messages
--------------------------------------------------- */
exports.handleInboundTwilio = async (req, res) => {
  try {
    const { From, To, Body, MessageSid, AccountSid } = req.body;

    console.log("\n" + "=".repeat(60));
    console.log("📨 INBOUND SMS RECEIVED");
    console.log("=".repeat(60));
    console.log("From:", From);
    console.log("To:", To);
    console.log("Body:", Body);

    // Normalize phone numbers
    const fromNumber = From?.startsWith("+") ? From : `+${From}`;
    const toNumber = To?.startsWith("+") ? To : `+${To}`;

    console.log("\n📞 Normalized Numbers:");
    console.log("  From:", fromNumber);
    console.log("  To:", toNumber);

    // Determine event type
    const bodyText = (Body || "").trim().toUpperCase();
    let eventType = "OTHER";
    if (bodyText.includes("STOP") || bodyText.includes("UNSUBSCRIBE")) {
      eventType = "STOP";
    } else if (bodyText.includes("START") || bodyText.includes("SUBSCRIBE")) {
      eventType = "START";
    } else if (bodyText.includes("HELP") || bodyText.includes("INFO")) {
      eventType = "HELP";
    }

    console.log("\n📋 Event Type:", eventType);

    // ============================================================
    // STEP 1: Try to find business from TwilioNumber
    // ============================================================
    let businessId = null;
    
    console.log("\n🔍 STEP 1: Looking for registered Twilio Number:", toNumber);
    const twilioNumber = await TwilioNumber.findOne({ 
      phoneNumber: toNumber,
      isActive: true 
    });

    if (twilioNumber?.businessId) {
      businessId = twilioNumber.businessId;
      console.log("  ✅ Found registered number! Business ID:", businessId);
    } else {
      console.log("  ❌ Twilio number not registered");
    }

    // ============================================================
    // STEP 2: If no business found, try to find from recent checkin
    // ============================================================
    let checkin = null;
    if (!businessId && fromNumber) {
      console.log("\n🔍 STEP 2: Looking for recent checkin:", fromNumber);
      
      checkin = await CheckinLog.findOne({ 
        phone: fromNumber 
      })
        .sort({ createdAt: -1 })
        .limit(1);
      
      if (!checkin) {
        checkin = await Checkin.findOne({ 
          phone: fromNumber 
        })
          .sort({ createdAt: -1 })
          .limit(1);
      }
      
      if (checkin?.businessId) {
        businessId = checkin.businessId;
        console.log("  ✅ Found from checkin! Business ID:", businessId);
      } else {
        console.log("  ❌ No checkin found");
      }
    }

    // ============================================================
    // STEP 3: If still no business, try to find ANY business using this Twilio number
    // ============================================================
    if (!businessId && toNumber) {
      console.log("\n🔍 STEP 3: Looking for business with twilioNumber:", toNumber);
      
      const business = await Business.findOne({ 
        twilioNumber: toNumber 
      });
      
      if (business) {
        businessId = business._id;
        console.log("  ✅ Found business! ID:", businessId, "Name:", business.name);
        console.log("  💡 Consider running registerTwilioNumbers.js to avoid this lookup");
      } else {
        console.log("  ❌ No business found with this Twilio number");
      }
    }

    console.log("\n🏢 FINAL Business ID:", businessId || "❌ NOT FOUND");

    // ============================================================
    // STEP 4: Find and update customer
    // ============================================================
    let customer = null;
    let customerUpdated = false;
    let updateMessage = "";

    if (fromNumber) {
      console.log("\n🔍 STEP 4: Looking for customer:", fromNumber);
      
      // Try to find customer with businessId (preferred)
      if (businessId) {
        customer = await Customer.findOne({
          phone: fromNumber,
          businessId: businessId
        });
        console.log(customer ? "  ✅ Found customer in business" : "  ❌ Customer not found in this business");
      }
      
      // FALLBACK: If no customer found and this is STOP/START, search across ALL businesses
      if (!customer && (eventType === "STOP" || eventType === "START")) {
        console.log("\n  💡 FALLBACK: Searching customer across ALL businesses...");
        
        customer = await Customer.findOne({
          phone: fromNumber
        });
        
        if (customer) {
          console.log("  ✅ Found customer in different business!");
          console.log("    - Customer Business ID:", customer.businessId);
          console.log("    - Message Received On:", toNumber);
          console.log("    - Will update anyway (cross-business STOP/START)");
          
          // Update businessId for logging purposes
          if (!businessId) {
            businessId = customer.businessId;
          }
        } else {
          console.log("  ❌ No customer found anywhere with phone:", fromNumber);
        }
      }

      // ============================================================
      // STEP 5: Update customer status
      // ============================================================
      if (customer) {
        console.log("\n👤 CUSTOMER FOUND:");
        console.log("  - ID:", customer._id);
        console.log("  - Phone:", customer.phone);
        console.log("  - Current Status:", customer.subscriberStatus);
        console.log("  - Points:", customer.points);
        console.log("  - Business ID:", customer.businessId);

        // Handle STOP - Set to UNSUBSCRIBED instead of blocked
        if (eventType === "STOP") {
          console.log("\n🚫 Processing STOP command...");
          
          if (customer.subscriberStatus !== "unsubscribed") {
            const oldStatus = customer.subscriberStatus;
            customer.subscriberStatus = "unsubscribed";
            customer.blockDate = new Date();
            customer.blockReason = "Customer sent STOP message";
            await customer.save();
            
            customerUpdated = true;
            updateMessage = `Status: ${oldStatus} → unsubscribed`;
            console.log("  ✅ Customer UNSUBSCRIBED!");
            console.log("    - Old Status:", oldStatus);
            console.log("    - New Status:", customer.subscriberStatus);
            console.log("    - Block Reason:", customer.blockReason);
          } else {
            console.log("  ⚠️ Already unsubscribed - no change");
            updateMessage = "Already unsubscribed";
          }
        }
        
        // Handle START - Reactivate from any inactive status
        else if (eventType === "START") {
          console.log("\n✅ Processing START command...");
          
          if (customer.subscriberStatus === "blocked" || 
              customer.subscriberStatus === "opted-out" || 
              customer.subscriberStatus === "unsubscribed") {
            const previousStatus = customer.subscriberStatus;
            const previousPoints = customer.points;
            
            customer.subscriberStatus = "active";
            customer.unblockDate = new Date();
            customer.points = 0;
            customer.blockReason = undefined;
            await customer.save();
            
            customerUpdated = true;
            updateMessage = `Status: ${previousStatus} → active, Points: ${previousPoints} → 0`;
            console.log("  ✅ Customer REACTIVATED!");
            console.log("    - Old Status:", previousStatus);
            console.log("    - New Status:", customer.subscriberStatus);
            console.log("    - Points Reset: Yes");
          } else {
            console.log("  ⚠️ Already active - no change");
            updateMessage = "Already active";
          }
        }
      } else {
        console.log("\n❌ CUSTOMER NOT FOUND - Cannot update status");
        console.log("  Possible reasons:");
        console.log("  1. Customer never checked in");
        console.log("  2. Phone number doesn't match database format");
        console.log("  3. Customer was deleted");
      }
    }

    // ============================================================
    // STEP 6: Log the inbound event
    // ============================================================
    const inbound = await InboundEvent.create({
      checkinId: checkin?._id || null,
      businessId: businessId || null,
      fromNumber,
      toNumber,
      body: Body,
      eventType: eventType,
      messageSid: MessageSid,
      accountSid: AccountSid,
      status: 'received',
      raw: req.body,
    });

    console.log("\n💾 Inbound Event Saved:");
    console.log("  - Event ID:", inbound._id);
    console.log("  - Event Type:", eventType);
    console.log("  - Customer Updated:", customerUpdated);
    if (updateMessage) {
      console.log("  - Update Details:", updateMessage);
    }

    // ============================================================
    // STEP 7: Send Twilio response
    // ============================================================
    const twiml = new twilio.twiml.MessagingResponse();

    if (eventType === "STOP") {
      twiml.message("You have been unsubscribed. Reply START to rejoin.");
      console.log("\n📤 Sending: STOP confirmation");
    } else if (eventType === "START") {
      twiml.message("Welcome back! You are now subscribed again. Your points have been reset.");
      console.log("\n📤 Sending: START confirmation");
    } else if (eventType === "HELP") {
      twiml.message("Reply START to subscribe or STOP to unsubscribe.");
      console.log("\n📤 Sending: HELP message");
    } else {
      console.log("\n📤 Sending: Empty response (no auto-reply)");
    }

    console.log("=".repeat(60));
    console.log("✅ WEBHOOK COMPLETE");
    console.log("=".repeat(60) + "\n");

    res.status(200).type('text/xml').send(twiml.toString());
    
  } catch (err) {
    console.error("\n" + "=".repeat(60));
    console.error("❌ WEBHOOK ERROR:");
    console.error("=".repeat(60));
    console.error("Error:", err.message);
    console.error("Stack:", err.stack);
    console.error("=".repeat(60) + "\n");
    
    res.status(500).type('text/xml').send("<Response></Response>");
  }
};
//Rewards


// controllers/adminController.js
// Add/Update this function to allow admins to set cooldown hours

/**
 * Update business reward settings including cooldown
 * PUT /admin/business/:id/reward-settings
 */

/**
 * Get business settings (for admin panel)
 * GET /admin/business/:id
 */
exports.getBusinessSettings = async (req, res) => {
  try {
    const { id } = req.params;

    const business = await Business.findById(id);
    if (!business) {
      return res.status(404).json({ 
        ok: false, 
        error: "Business not found" 
      });
    }

    // ✅ Check permissions
    if (req.user.role === 'admin' && req.user.businessId.toString() !== id) {
      return res.status(403).json({ 
        ok: false, 
        error: "Access denied" 
      });
    }

    res.json({
      ok: true,
      business: {
        id: business._id,
        name: business.name,
        slug: business.slug,
        rewardThreshold: business.rewardThreshold || 10,
        checkinCooldownHours: business.checkinCooldownHours || 24,
        rewardExpiryDays: 15, // Fixed
        maxActiveRewards: business.maxActiveRewards || 15,
        welcomeMessage: business.welcomeMessage,
        twilioNumber: business.twilioNumber,
        twilioNumberActive: business.twilioNumberActive,
        ageGate: business.ageGate
      }
    });
  } catch (err) {
    console.error("❌ Failed to fetch business settings:", err);
    res.status(500).json({ 
      ok: false, 
      error: "Server error" 
    });
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


/* ---------------------------------------------------
    CREATE REWARD - FIXED WITH DUPLICATE PREVENTION
--------------------------------------------------- */
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
      phone,
    } = req.body;

    // ✅ Ensure businessId is coming from logged-in admin/staff
    const businessId =
      req.user.role === "superadmin" || req.user.role === "master"
        ? req.body.businessId
        : req.user.businessId;

    if (!businessId || !name || !threshold || !code) {
      return res.status(400).json({
        ok: false,
        message: "businessId, name, threshold, and code are required.",
      });
    }

    // ✅ Check for duplicate reward code
    const existingCode = await Reward.findOne({ code: code.toUpperCase() });
    if (existingCode) {
      return res.status(400).json({
        ok: false,
        message: "Reward code already exists. Use a unique one.",
      });
    }

    // ✅ If phone is provided, check for existing unredeemed reward for this customer
    if (phone) {
      const existingReward = await Reward.findOne({
        phone,
        businessId,
        redeemed: false,
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: null },
          { expiresAt: { $gt: new Date() } }
        ]
      });

      if (existingReward) {
        console.log('⚠️ Customer already has an active reward:', existingReward.code);
        return res.status(400).json({
          ok: false,
          message: "Customer already has an active reward that hasn't been redeemed yet",
          existingReward: {
            code: existingReward.code,
            name: existingReward.name,
            expiresAt: existingReward.expiresAt
          }
        });
      }
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
      code: code.toUpperCase(),
      expiryDays,
      expiresAt,
      discountType: discountType || "none",
      discountValue: discountValue || 0,
      priority: priority || 1,
      phone: phone || null,
    });

    await reward.save();

    // ✅ Create reward history entry
    await RewardHistory.create({
      rewardId: reward._id,
      phone: phone || null,
      businessId,
      status: "Active",
      createdAt: new Date()
    });

    console.log(`✅ New reward created: ${reward.code}${phone ? ` for ${phone}` : ''}`);

    res.status(201).json({
      ok: true,
      message: "Reward created successfully.",
      data: reward,
    });
  } catch (err) {
    console.error("❌ Error creating reward:", err);
    res.status(500).json({ ok: false, error: "Server error", message: err.message });
  }
};
/* ---------------------------------------------------
    GET ALL REWARDS
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


//reddem ****************************************redeem

// exports.redeemReward = async (req, res) => {
//   try {
//     const { id } = req.params; // ✅ Changed from rewardId to id
    
//     console.log('🎁 Redeeming reward:', id); // ✅ Changed rewardId to id

//     if (!id) { // ✅ Changed rewardId to id
//       return res.status(400).json({ ok: false, error: "Reward ID is required" });
//     }

//     // Find the reward
//     const reward = await Reward.findById(id); // ✅ Changed rewardId to id
    
//     if (!reward) {
//       return res.status(404).json({ ok: false, error: "Reward not found" });
//     }

//     // Check if already redeemed
//     if (reward.redeemed) {
//       return res.status(400).json({ ok: false, error: "Reward already redeemed" });
//     }

//     // Check if expired
//     if (reward.expiresAt && new Date(reward.expiresAt) < new Date()) {
//       return res.status(400).json({ ok: false, error: "Reward has expired" });
//     }

//     // Check access permissions
//     if (req.user.role !== 'master' && req.user.role !== 'superadmin') {
//       if (reward.businessId.toString() !== req.user.businessId.toString()) {
//         return res.status(403).json({ ok: false, error: "Access denied" });
//       }
//     }

//     // ✅ Find the customer and reset their check-ins to zero
//     const customer = await Customer.findOne({ 
//       phone: reward.phone, 
//       businessId: reward.businessId 
//     });

//     if (customer) {
//       customer.totalCheckins = 0;
//       await customer.save();
//       console.log(`🔄 Customer check-ins reset to 0 for phone: ${reward.phone}`);
//     }

//     // Mark as redeemed
//     reward.redeemed = true;
//     reward.redeemedAt = new Date();
//     reward.redeemedBy = req.user.id;
    
//     await reward.save();

//     // Update reward history
//     await RewardHistory.updateOne(
//       { rewardId: reward._id },
//       { 
//         status: "Redeemed",
//         redeemedAt: new Date(),
//         redeemedBy: req.user.id
//       }
//     );

//     console.log(`✅ Reward redeemed: ${reward.code}`);

//     res.json({ 
//       ok: true, 
//       message: "Reward redeemed successfully", 
//       reward,
//       customer: customer ? {
//         phone: customer.phone,
//         totalCheckins: customer.totalCheckins
//       } : null
//     });

//   } catch (err) {
//     console.error('❌ Redeem Error:', err);
//     res.status(500).json({ ok: false, error: err.message });
//   }
// };


/* ---------------------------------------------------
    GET REWARD HISTORY
--------------------------------------------------- */
exports.getRewardHistory = async (req, res) => {
  try {
    let query = {};
    
    // Filter by business for non-master users
    if (req.user.role === 'admin' || req.user.role === 'staff') {
      query.businessId = req.user.businessId;
    }

    const histories = await RewardHistory.find(query)
      .populate("businessId", "name")
      .populate("rewardId", "name code expiresAt redeemed description threshold")
      .populate("checkinId", "createdAt")
      .sort({ createdAt: -1 })
      .lean();

    const formatted = histories.map((h) => {
      const reward = h.rewardId || {};
      const business = h.businessId || {};

      // Determine current status
      let status = h.status;
      if (reward.redeemed) {
        status = "Redeemed";
      } else if (reward.expiresAt && new Date(reward.expiresAt) < new Date()) {
        status = "Expired";
      } else if (!status) {
        status = "Active";
      }

      return {
        _id: h._id,
        business: { name: business.name || "—" },
        phone: h.phone || "—",
        name: reward.name || "—",
        code: reward.code || "—",
        issuedAt: h.createdAt || null,
        expiresAt: reward.expiresAt || null,
        status: status,
      };
    });

    res.json({ ok: true, list: formatted });
  } catch (err) {
    console.error("❌ Error fetching reward history:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
};

/* ---------------------------------------------------
    GET BUSINESS REWARDS OVERVIEW
--------------------------------------------------- */
exports.getBusinessRewardsOverview = async (req, res) => {
  try {
    const { id } = req.params; // businessId

    // Check permissions
    if (req.user.role === 'admin' && req.user.businessId.toString() !== id) {
      return res.status(403).json({ 
        ok: false, 
        error: "Access denied" 
      });
    }

    const business = await Business.findById(id);
    if (!business) {
      return res.status(404).json({ 
        ok: false, 
        error: "Business not found" 
      });
    }

    // 📊 Get total points + user-level data
    const pointsLedger = await PointsLedger.find({ businessId: business._id })
      .sort({ updatedAt: -1 })
      .select("phoneNumber points totalCheckins lastCheckinAt hasPendingReward");

    const totalPoints = pointsLedger.reduce((acc, l) => acc + (l.points || 0), 0);
    const totalUsers = pointsLedger.length;

    // 🎁 Active rewards (not redeemed and not expired)
    const activeRewards = await Reward.find({
      businessId: business._id,
      redeemed: false,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    }).sort({ createdAt: -1 });

    // 🎁 Count redeemed rewards
    const redeemedCount = await Reward.countDocuments({
      businessId: business._id,
      redeemed: true
    });

    // 🎁 Count expired rewards
    const expiredCount = await Reward.countDocuments({
      businessId: business._id,
      redeemed: false,
      expiresAt: { $lt: new Date() }
    });

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
      stats: {
        active: activeRewards.length,
        redeemed: redeemedCount,
        expired: expiredCount,
        total: activeRewards.length + redeemedCount + expiredCount
      }
    });
  } catch (err) {
    console.error("❌ Failed to fetch reward overview:", err);
    res.status(500).json({ 
      ok: false, 
      error: "Server error",
      message: err.message 
    });
  }
};


/* ---------------------------------------------------
    UPDATE REWARD SETTINGS
--------------------------------------------------- */
exports.updateRewardSettings = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      rewardThreshold,        // ✅ Check-ins needed for reward
      checkinCooldownHours,   // ✅ Hours between check-ins
      maxActiveRewards,
      welcomeMessage
    } = req.body;

    // Check permissions
    if (req.user.role === 'admin' && req.user.businessId.toString() !== id) {
      return res.status(403).json({ 
        ok: false, 
        error: "Access denied" 
      });
    }

    const business = await Business.findById(id);
    if (!business) {
      return res.status(404).json({ 
        ok: false, 
        error: "Business not found" 
      });
    }

    // ✅ Update global reward threshold
    if (rewardThreshold !== undefined) {
      if (rewardThreshold < 1 || rewardThreshold > 100) {
        return res.status(400).json({
          ok: false,
          error: "Reward threshold must be between 1 and 100 check-ins"
        });
      }
      business.rewardThreshold = rewardThreshold;
      console.log(`✅ Reward threshold updated to ${rewardThreshold} check-ins`);
    }

    // ✅ Update cooldown hours
    if (checkinCooldownHours !== undefined) {
      if (checkinCooldownHours < 0.5 || checkinCooldownHours > 168) {
        return res.status(400).json({
          ok: false,
          error: "Cooldown must be between 0.5 hours (30 min) and 168 hours (7 days)"
        });
      }
      business.checkinCooldownHours = checkinCooldownHours;
      console.log(`✅ Cooldown updated to ${checkinCooldownHours} hours`);
    }

    // ✅ Update other settings
    if (maxActiveRewards !== undefined) {
      business.maxActiveRewards = maxActiveRewards;
    }
    
    if (welcomeMessage !== undefined) {
      business.welcomeMessage = welcomeMessage;
    }

    await business.save();

    console.log(`✅ Program settings updated for ${business.name}`);

    res.json({ 
      ok: true, 
      business,
      message: "Program settings updated successfully"
    });
  } catch (err) {
    console.error("❌ Failed to update program settings:", err);
    res.status(500).json({ 
      ok: false, 
      error: "Server error",
      message: err.message
    });
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



