// rewardController.js - COMPLETE FIXED VERSION

const Reward = require('../models/Reward');
const Customer = require('../models/Customer');
const RewardHistory = require('../models/rewardHistory');
const Business = require('../models/Business');

/* ---------------------------------------------------
    REDEEM REWARD - FIXED VERSION
--------------------------------------------------- */
exports.redeemReward = async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('🎁 Redeeming reward:', id);

    if (!id) {
      return res.status(400).json({ ok: false, error: "Reward ID is required" });
    }

    // Find the reward
    const reward = await Reward.findById(id);
    
    if (!reward) {
      return res.status(404).json({ ok: false, error: "Reward not found" });
    }

    // Check if already redeemed
    if (reward.redeemed) {
      return res.status(400).json({ ok: false, error: "Reward already redeemed" });
    }

    // Check if expired
    if (reward.expiresAt && new Date(reward.expiresAt) < new Date()) {
      return res.status(400).json({ ok: false, error: "Reward has expired" });
    }

    // Check access permissions
    if (req.user.role !== 'master' && req.user.role !== 'superadmin') {
      if (reward.businessId.toString() !== req.user.businessId.toString()) {
        return res.status(403).json({ ok: false, error: "Access denied" });
      }
    }

    // Find the customer and reset their check-ins to zero
    const customer = await Customer.findOne({ 
      phone: reward.phone, 
      businessId: reward.businessId 
    });

    if (customer) {
      customer.totalCheckins = 0;
      await customer.save();
      console.log(`🔄 Customer check-ins reset to 0 for phone: ${reward.phone}`);
    }

    // Mark as redeemed
    reward.redeemed = true;
    reward.redeemedAt = new Date();
    reward.redeemedBy = req.user.id;
    
    await reward.save();

    // Update reward history
    await RewardHistory.updateOne(
      { rewardId: reward._id },
      { 
        status: "Redeemed",
        redeemedAt: new Date(),
        redeemedBy: req.user.id
      }
    );

    console.log(`✅ Reward redeemed: ${reward.code}`);

    res.json({ 
      ok: true, 
      message: "Reward redeemed successfully", 
      reward,
      customer: customer ? {
        phone: customer.phone,
        totalCheckins: customer.totalCheckins
      } : null
    });

  } catch (err) {
    console.error('❌ Redeem Error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
};

/* ---------------------------------------------------
    CREATE REWARD - FIXED TO PREVENT DUPLICATES
--------------------------------------------------- */
exports.createReward = async (req, res) => {
  try {
    const { phone, businessId, name, description, threshold } = req.body;

    // Validate required fields
    if (!phone || !businessId || !name) {
      return res.status(400).json({ 
        ok: false, 
        error: "Phone, businessId, and name are required" 
      });
    }

    // ✅ CHECK FOR EXISTING UNREDEEMED REWARD
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
        error: "Customer already has an active reward that hasn't been redeemed yet",
        existingReward: {
          code: existingReward.code,
          name: existingReward.name,
          expiresAt: existingReward.expiresAt
        }
      });
    }

    // Generate unique reward code
    const code = `RW-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

    // Calculate expiration (default 30 days)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // Create new reward
    const reward = new Reward({
      phone,
      businessId,
      name,
      description: description || name,
      code,
      threshold: threshold || 5,
      expiresAt,
      redeemed: false
    });

    await reward.save();

    // Create reward history entry
    await RewardHistory.create({
      rewardId: reward._id,
      phone,
      businessId,
      status: "Active",
      createdAt: new Date()
    });

    console.log(`✅ New reward created: ${code} for ${phone}`);

    res.status(201).json({
      ok: true,
      reward,
      message: "Reward created successfully"
    });

  } catch (err) {
    console.error('❌ Create Reward Error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
};

/* ---------------------------------------------------
    GET REWARD HISTORY - FIXED
--------------------------------------------------- */
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
        status: status
      };
    });

    res.json({ ok: true, list: formatted });
  } catch (err) {
    console.error("❌ Error fetching reward history:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
};

/* ---------------------------------------------------
    GET CUSTOMER BY REWARD CODE - FIXED
--------------------------------------------------- */
exports.getCustomerByRewardCode = async (req, res) => {
  try {
    const { code } = req.params;
    
    console.log('🎫 Looking up reward code:', code);

    if (!code || code.length < 4) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid reward code'
      });
    }

    const userRole = req.user.role;
    const userBusinessId = req.user.businessId;

    // Find reward
    const reward = await Reward.findOne({ 
      code: code.toUpperCase()
    }).lean();

    if (!reward) {
      return res.status(404).json({
        ok: false,
        error: 'Reward not found'
      });
    }

    // Check if already redeemed
    if (reward.redeemed) {
      return res.status(400).json({
        ok: false,
        error: 'This reward has already been redeemed',
        redeemedAt: reward.redeemedAt
      });
    }

    // Check if expired
    if (reward.expiresAt && new Date(reward.expiresAt) < new Date()) {
      return res.status(400).json({
        ok: false,
        error: 'This reward has expired',
        expiresAt: reward.expiresAt
      });
    }

    // Check business access
    if (userRole === 'admin') {
      if (!userBusinessId) {
        return res.status(403).json({
          ok: false,
          error: 'No business assigned to your account'
        });
      }
      if (reward.businessId.toString() !== userBusinessId.toString()) {
        return res.status(403).json({
          ok: false,
          error: 'Access denied'
        });
      }
    }

    // Find customer
    const Customer = require('../models/Customer');
    const customer = await Customer.findOne({
      phone: reward.phone,
      businessId: reward.businessId,
      deleted: { $ne: true }
    })
    .populate('businessId', 'name slug rewardSettings')
    .lean();

    if (!customer) {
      return res.status(404).json({
        ok: false,
        error: 'Customer not found'
      });
    }

    res.json({
      ok: true,
      customer,
      reward
    });

  } catch (error) {
    console.error('❌ Get Customer By Code Error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to find customer',
      message: error.message
    });
  }
};

/* ---------------------------------------------------
    GET CUSTOMER BY REWARD CODE - FIXED
--------------------------------------------------- */
exports.getCustomerByRewardCode = async (req, res) => {
  try {
    const { code } = req.params;
    
    console.log('🎫 Looking up reward code:', code);

    if (!code || code.length < 4) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid reward code'
      });
    }

    const userRole = req.user.role;
    const userBusinessId = req.user.businessId;

    // Find reward
    const reward = await Reward.findOne({ 
      code: code.toUpperCase()
    }).lean();

    if (!reward) {
      return res.status(404).json({
        ok: false,
        error: 'Reward not found'
      });
    }

    // Check if already redeemed
    if (reward.redeemed) {
      return res.status(400).json({
        ok: false,
        error: 'This reward has already been redeemed',
        redeemedAt: reward.redeemedAt
      });
    }

    // Check if expired
    if (reward.expiresAt && new Date(reward.expiresAt) < new Date()) {
      return res.status(400).json({
        ok: false,
        error: 'This reward has expired',
        expiresAt: reward.expiresAt
      });
    }

    // Check business access
    if (userRole === 'admin') {
      if (!userBusinessId) {
        return res.status(403).json({
          ok: false,
          error: 'No business assigned to your account'
        });
      }
      if (reward.businessId.toString() !== userBusinessId.toString()) {
        return res.status(403).json({
          ok: false,
          error: 'Access denied'
        });
      }
    }

    // Find customer
    const customer = await Customer.findOne({
      phone: reward.phone,
      businessId: reward.businessId,
      deleted: { $ne: true }
    })
    .populate('businessId', 'name slug rewardSettings')
    .lean();

    if (!customer) {
      return res.status(404).json({
        ok: false,
        error: 'Customer not found'
      });
    }

    res.json({
      ok: true,
      customer,
      reward
    });

  } catch (error) {
    console.error('❌ Get Customer By Code Error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to find customer',
      message: error.message
    });
  }
};

/* ---------------------------------------------------
    GET BUSINESS REWARDS
--------------------------------------------------- */
exports.getBusinessRewards = async (req, res) => {
  try {
    const { id } = req.params; // businessId
    
    // Check permissions
    if (req.user.role === 'admin' && req.user.businessId.toString() !== id) {
      return res.status(403).json({ ok: false, error: 'Access denied' });
    }

    const rewards = await Reward.find({ businessId: id })
      .sort({ priority: 1, threshold: 1 })
      .lean();

    res.json({ ok: true, rewards });
  } catch (error) {
    console.error('❌ Get Business Rewards Error:', error);
    res.status(500).json({ ok: false, error: 'Failed to fetch rewards' });
  }
};

/* ---------------------------------------------------
    ADD BUSINESS REWARD
--------------------------------------------------- */
exports.addBusinessReward = async (req, res) => {
  try {
    const { id } = req.params; // businessId
    const { name, description, threshold, code, expiryDays, discountType, discountValue, priority } = req.body;

    // Check permissions
    if (req.user.role === 'admin' && req.user.businessId.toString() !== id) {
      return res.status(403).json({ ok: false, error: 'Access denied' });
    }

    // Validate required fields
    if (!name || !threshold || !code) {
      return res.status(400).json({
        ok: false,
        error: 'Name, threshold, and code are required'
      });
    }

    // Check for duplicate code
    const existingCode = await Reward.findOne({ code: code.toUpperCase() });
    if (existingCode) {
      return res.status(400).json({
        ok: false,
        error: 'Reward code already exists. Please use a unique code.'
      });
    }

    // Calculate expiry date
    let expiresAt = null;
    if (expiryDays && Number(expiryDays) > 0) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + Number(expiryDays));
    }

    const reward = new Reward({
      businessId: id,
      name,
      description: description || '',
      threshold,
      code: code.toUpperCase(),
      expiryDays,
      expiresAt,
      discountType: discountType || 'none',
      discountValue: discountValue || 0,
      priority: priority || 1
    });

    await reward.save();

    res.status(201).json({
      ok: true,
      message: 'Reward created successfully',
      reward
    });
  } catch (error) {
    console.error('❌ Add Business Reward Error:', error);
    res.status(500).json({ ok: false, error: 'Failed to create reward' });
  }
};

/* ---------------------------------------------------
    UPDATE BUSINESS REWARD
--------------------------------------------------- */
exports.updateBusinessReward = async (req, res) => {
  try {
    const { id, rewardId } = req.params;
    const updates = req.body;

    // Check permissions
    if (req.user.role === 'admin' && req.user.businessId.toString() !== id) {
      return res.status(403).json({ ok: false, error: 'Access denied' });
    }

    const reward = await Reward.findOne({ _id: rewardId, businessId: id });
    
    if (!reward) {
      return res.status(404).json({ ok: false, error: 'Reward not found' });
    }

    // Update fields
    Object.keys(updates).forEach(key => {
      if (key !== '_id' && key !== 'businessId') {
        reward[key] = updates[key];
      }
    });

    await reward.save();

    res.json({
      ok: true,
      message: 'Reward updated successfully',
      reward
    });
  } catch (error) {
    console.error('❌ Update Business Reward Error:', error);
    res.status(500).json({ ok: false, error: 'Failed to update reward' });
  }
};

/* ---------------------------------------------------
    DELETE BUSINESS REWARD
--------------------------------------------------- */
exports.deleteBusinessReward = async (req, res) => {
  try {
    const { id, rewardId } = req.params;

    // Check permissions
    if (req.user.role === 'admin' && req.user.businessId.toString() !== id) {
      return res.status(403).json({ ok: false, error: 'Access denied' });
    }

    const reward = await Reward.findOneAndDelete({ _id: rewardId, businessId: id });
    
    if (!reward) {
      return res.status(404).json({ ok: false, error: 'Reward not found' });
    }

    res.json({
      ok: true,
      message: 'Reward deleted successfully'
    });
  } catch (error) {
    console.error('❌ Delete Business Reward Error:', error);
    res.status(500).json({ ok: false, error: 'Failed to delete reward' });
  }
};

module.exports = exports;