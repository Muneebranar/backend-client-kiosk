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

    const reward = await Reward.findById(id);
    
    if (!reward) {
      return res.status(404).json({ ok: false, error: "Reward not found" });
    }

    if (reward.redeemed) {
      return res.status(400).json({ ok: false, error: "Reward already redeemed" });
    }

    if (reward.expiresAt && new Date(reward.expiresAt) < new Date()) {
      return res.status(400).json({ ok: false, error: "Reward has expired" });
    }

    if (req.user.role !== 'master' && req.user.role !== 'superadmin') {
      if (reward.businessId.toString() !== req.user.businessId.toString()) {
        return res.status(403).json({ ok: false, error: "Access denied" });
      }
    }

    // Reset customer check-ins if this is an issued reward (has phone)
    if (reward.phone) {
      const customer = await Customer.findOne({ 
        phone: reward.phone, 
        businessId: reward.businessId 
      });

      if (customer) {
        customer.totalCheckins = 0;
        await customer.save();
        console.log(`🔄 Customer check-ins reset to 0 for: ${reward.phone}`);
      }
    }

    reward.redeemed = true;
    reward.redeemedAt = new Date();
    reward.redeemedBy = req.user.id;
    
    await reward.save();

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
      reward
    });

  } catch (err) {
    console.error('❌ Redeem Error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
};


/* ---------------------------------------------------
    CREATE REWARD (Issue to customer) - FIXED
--------------------------------------------------- */
exports.createReward = async (req, res) => {
  try {
    const { phone, businessId, name, description, threshold } = req.body;

    if (!phone || !businessId || !name) {
      return res.status(400).json({ 
        ok: false, 
        error: "Phone, businessId, and name are required" 
      });
    }

    // Check for existing unredeemed reward
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

    const code = `RW-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // ✅ Create ISSUED reward (with phone)
    const reward = new Reward({
      phone,  // This makes it an issued reward
      businessId,
      name,
      description: description || name,
      code,
      threshold: threshold || 5,
      expiresAt,
      redeemed: false
    });

    await reward.save();

    await RewardHistory.create({
      rewardId: reward._id,
      phone,
      businessId,
      status: "Active",
      createdAt: new Date()
    });

    console.log(`✅ New reward issued: ${code} for ${phone}`);

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
    GET REWARD HISTORY
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
    GET CUSTOMER BY REWARD CODE
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

    const reward = await Reward.findOne({ 
      code: code.toUpperCase()
    }).lean();

    if (!reward) {
      return res.status(404).json({
        ok: false,
        error: 'Reward not found'
      });
    }

    if (reward.redeemed) {
      return res.status(400).json({
        ok: false,
        error: 'This reward has already been redeemed',
        redeemedAt: reward.redeemedAt
      });
    }

    if (reward.expiresAt && new Date(reward.expiresAt) < new Date()) {
      return res.status(400).json({
        ok: false,
        error: 'This reward has expired',
        expiresAt: reward.expiresAt
      });
    }

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


exports.debugBusinessRewards = async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('🐛 DEBUG: Checking rewards for business:', id);

    // Get ALL rewards for this business
    const allRewards = await Reward.find({ businessId: id }).lean();
    
    // Separate templates from issued rewards
    const templates = allRewards.filter(r => !r.phone || r.phone === '');
    const issuedRewards = allRewards.filter(r => r.phone && r.phone !== '');

    console.log('📊 Debug Results:');
    console.log(`  - Total rewards: ${allRewards.length}`);
    console.log(`  - Templates (no phone): ${templates.length}`);
    console.log(`  - Issued (with phone): ${issuedRewards.length}`);

    if (templates.length > 0) {
      console.log('📋 Template details:');
      templates.forEach(t => {
        console.log(`   - ${t.code}: ${t.name} (phone: ${t.phone || 'undefined'})`);
      });
    }

    if (issuedRewards.length > 0) {
      console.log('🎫 Issued reward details:');
      issuedRewards.forEach(r => {
        console.log(`   - ${r.code}: ${r.name} for ${r.phone}`);
      });
    }

    res.json({
      ok: true,
      businessId: id,
      summary: {
        total: allRewards.length,
        templates: templates.length,
        issued: issuedRewards.length
      },
      templates,
      issuedRewards,
      allRewards
    });
  } catch (error) {
    console.error('❌ Debug Error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
};


/* ---------------------------------------------------
    🔧 FIX - Convert issued rewards to templates
--------------------------------------------------- */
exports.fixRewardsToTemplates = async (req, res) => {
  try {
    const { id } = req.params;

    console.log('🔧 Converting issued rewards to templates for business:', id);

    // Find all rewards with phone field for this business
    const result = await Reward.updateMany(
      { 
        businessId: id,
        phone: { $exists: true, $ne: '' }
      },
      { 
        $unset: { phone: "" }  // Remove phone field
      }
    );

    console.log(`✅ Converted ${result.modifiedCount} rewards to templates`);

    res.json({
      ok: true,
      message: `Successfully converted ${result.modifiedCount} rewards to templates`,
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    console.error('❌ Fix Rewards Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Failed to fix rewards',
      details: error.message 
    });
  }
};


exports.getBusinessRewards = async (req, res) => {
  try {
    const { id } = req.params; // businessId
    
    console.log('📋 Fetching reward templates for business:', id);
    
    // Check permissions
    if (req.user.role === 'admin' && req.user.businessId.toString() !== id) {
      return res.status(403).json({ ok: false, error: 'Access denied' });
    }

    // ✅ Fetch TEMPLATES ONLY (no phone field or empty phone)
    const rewards = await Reward.find({ 
      businessId: id,
      $or: [
        { phone: { $exists: false } },
        { phone: null },
        { phone: '' }
      ]
    })
    .sort({ priority: 1, threshold: 1 })
    .lean();

    console.log(`✅ Found ${rewards.length} reward templates`);

    res.json({ ok: true, rewards });
  } catch (error) {
    console.error('❌ Get Business Rewards Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Failed to fetch rewards',
      details: error.message 
    });
  }
};

/* ---------------------------------------------------
    ADD BUSINESS REWARD - FIXED VERSION
--------------------------------------------------- */
exports.addBusinessReward = async (req, res) => {
  try {
    const { id } = req.params; // businessId
    const { name, description, threshold, code, expiryDays, discountType, discountValue, priority, isActive } = req.body;

    console.log('📝 Creating business reward template:', { 
      businessId: id, 
      name, 
      threshold, 
      code,
      isActive 
    });

    // Check permissions
    if (req.user.role === 'admin' && req.user.businessId.toString() !== id) {
      return res.status(403).json({ ok: false, error: 'Access denied' });
    }

    // Validate required fields
    if (!name || !threshold) {
      return res.status(400).json({
        ok: false,
        error: 'Name and threshold are required'
      });
    }

    // Generate code if not provided
    const rewardCode = code 
      ? code.toUpperCase().trim()
      : `RW-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

    console.log('🔍 Checking for duplicate code:', rewardCode);

    // Check for duplicate code (templates only)
    const existingCode = await Reward.findOne({ 
      code: rewardCode,
      businessId: id,
      $or: [
        { phone: { $exists: false } },
        { phone: null },
        { phone: '' }
      ]
    });
    
    if (existingCode) {
      console.log('⚠️ Duplicate code found:', rewardCode);
      return res.status(400).json({
        ok: false,
        error: 'A reward template with this code already exists for your business.'
      });
    }

    // ✅ Create reward TEMPLATE (explicitly NO phone field)
    const rewardData = {
      businessId: id,
      name: name.trim(),
      description: description?.trim() || '',
      threshold: Number(threshold),
      code: rewardCode,
      expiryDays: expiryDays ? Number(expiryDays) : 0,
      discountType: discountType || 'none',
      discountValue: discountValue ? Number(discountValue) : 0,
      priority: priority ? Number(priority) : 1,
      isActive: typeof isActive === 'boolean' ? isActive : true,
      redeemed: false
      // ✅ CRITICAL: DO NOT include phone field at all
    };

    const reward = new Reward(rewardData);
    await reward.save();

    console.log('✅ Reward template created successfully:', {
      code: reward.code,
      name: reward.name,
      hasPhone: !!reward.phone,
      _id: reward._id
    });

    res.status(201).json({
      ok: true,
      message: 'Reward template created successfully',
      reward
    });
  } catch (error) {
    console.error('❌ Add Business Reward Error:', error);
    
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Reward code must be unique'
      });
    }

    res.status(500).json({ 
      ok: false, 
      error: 'Failed to create reward template',
      details: error.message 
    });
  }
};


/* ---------------------------------------------------
    UPDATE BUSINESS REWARD
--------------------------------------------------- */
exports.updateBusinessReward = async (req, res) => {
  try {
    const { id, rewardId } = req.params;
    const updates = req.body;

    console.log('📝 Updating reward template:', rewardId);

    // Check permissions
    if (req.user.role === 'admin' && req.user.businessId.toString() !== id) {
      return res.status(403).json({ ok: false, error: 'Access denied' });
    }

    // Find template only (no phone field)
    const reward = await Reward.findOne({ 
      _id: rewardId, 
      businessId: id,
      $or: [
        { phone: { $exists: false } },
        { phone: null },
        { phone: '' }
      ]
    });
    
    if (!reward) {
      return res.status(404).json({ ok: false, error: 'Reward template not found' });
    }

    // Update allowed fields
    const allowedFields = [
      'name', 'description', 'threshold', 'code', 
      'expiryDays', 'discountType', 'discountValue', 
      'priority', 'isActive'
    ];

    allowedFields.forEach(key => {
      if (updates[key] !== undefined) {
        if (key === 'code' && updates[key]) {
          reward[key] = updates[key].toUpperCase().trim();
        } else if (['threshold', 'expiryDays', 'discountValue', 'priority'].includes(key)) {
          reward[key] = Number(updates[key]);
        } else {
          reward[key] = updates[key];
        }
      }
    });

    // Ensure phone field stays undefined
    if (reward.phone !== undefined) {
      reward.phone = undefined;
    }

    await reward.save();

    console.log('✅ Reward template updated:', reward.code);

    res.json({
      ok: true,
      message: 'Reward template updated successfully',
      reward
    });
  } catch (error) {
    console.error('❌ Update Business Reward Error:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Reward code must be unique'
      });
    }

    res.status(500).json({ 
      ok: false, 
      error: 'Failed to update reward template',
      details: error.message 
    });
  }
};
/* ---------------------------------------------------
    DELETE BUSINESS REWARD
--------------------------------------------------- */
exports.deleteBusinessReward = async (req, res) => {
  try {
    const { id, rewardId } = req.params;

    console.log('🗑️ Deleting reward template:', rewardId);

    // Check permissions
    if (req.user.role === 'admin' && req.user.businessId.toString() !== id) {
      return res.status(403).json({ ok: false, error: 'Access denied' });
    }

    // Delete template only (no phone field)
    const reward = await Reward.findOneAndDelete({ 
      _id: rewardId, 
      businessId: id,
      $or: [
        { phone: { $exists: false } },
        { phone: null },
        { phone: '' }
      ]
    });
    
    if (!reward) {
      return res.status(404).json({ ok: false, error: 'Reward template not found' });
    }

    console.log('✅ Reward template deleted:', reward.code);

    res.json({
      ok: true,
      message: 'Reward template deleted successfully'
    });
  } catch (error) {
    console.error('❌ Delete Business Reward Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Failed to delete reward template',
      details: error.message 
    });
  }
};

module.exports = exports;