const AdminUser = require("../models/AdminUser");
const Business = require("../models/Business");
const Checkin = require("../models/Checkin");
const Reward = require("../models/Reward");
const InboundEvent = require("../models/InboundEvent");
const TwilioNumber = require("../models/TwilioNumber");
const PointsLedger = require("../models/PointsLedger");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mongoose = require('mongoose');
const fs = require("fs");
const path = require("path"); // ✅ <--- this was missing
const RewardHistory = require("../models/rewardHistory");


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
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "email and password required" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const admin = await AdminUser.create({ email, password: hashed, name });
    res.json({ ok: true, id: admin._id });
  } catch (err) {
    console.error("❌ Failed to create admin:", err);
    res.status(500).json({ error: "server error" });
  }
};

/* ---------------------------------------------------
   3. ADMIN LOGIN → RETURNS JWT TOKEN
--------------------------------------------------- */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = await AdminUser.findOne({ email });
    if (!admin) return res.status(401).json({ error: "Invalid credentials" });

    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      { sub: admin._id, email: admin.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ ok: true, token });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ error: "server error" });
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
    const { name, slug, twilioNumber, rewardPoints, branding } = req.body;

    // ✅ Check if business exists
    const business = await Business.findById(id);
    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    // 🟢 Only validate name/slug if they are being updated
    if ((name && !slug) || (!name && slug)) {
      return res.status(400).json({ error: "Both name and slug required if changing name or slug" });
    }

    // ✅ Validate Twilio number if provided
    let selectedTwilio = null;
    if (twilioNumber) {
      selectedTwilio = await TwilioNumber.findOne({ number: twilioNumber });
      if (!selectedTwilio)
        return res.status(400).json({ error: "Invalid Twilio number" });
    }

    // ✅ Update only provided fields
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
    const list = await Business.find().sort({ createdAt: -1 });    
    res.json({ ok: true, list });
  } catch (err) {
    console.error("❌ Failed to fetch businesses:", err);
    res.status(500).json({ error: "server error" });
  }
};



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
    const items = await InboundEvent.find()
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

    // 🔹 Normalize numbers
    const fromNumber = From ? From.replace("+", "") : null;
    const toNumber = To?.replace("+", "") || "Unknown";

    // 🔹 Find latest check-in for this phone
    const checkin = await Checkin.findOne({
      phone: fromNumber ? `+${fromNumber}` : null,
    })
      .sort({ createdAt: -1 })
      .populate("businessId"); // ✅ fetch business info

    // 🔹 Save inbound message with both IDs
    const inbound = await InboundEvent.create({
      checkinId: checkin?._id || null,
      businessId: checkin?.businessId?._id || null, // ✅ ADD THIS LINE
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
    const list = await Reward.find({})
      .populate("businessId", "name slug")
      .sort({ createdAt: -1 });

    res.json({ ok: true, list });
  } catch (err) {
    console.error("❌ Error fetching rewards:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
};






//
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