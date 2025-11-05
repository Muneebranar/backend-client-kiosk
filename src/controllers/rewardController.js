const Reward = require("../models/Reward");
const Business = require("../models/Business");

// ✅ GET ALL REWARDS FOR A BUSINESS
exports.getBusinessRewards = async (req, res) => {
  try {
    const { id } = req.params;
    const list = await Reward.find({ businessId: id })
      .sort({ priority: 1, createdAt: -1 })
      .populate("businessId", "name slug");
    res.json({ ok: true, list });
  } catch (err) {
    console.error("❌ Error fetching business rewards:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
};

// ✅ ADD NEW REWARD TO BUSINESS
exports.addBusinessReward = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      name, 
      threshold, 
      expirationDays, 
      description,
      priority = 1,
      isActive = true,
      discountType = 'none',
      discountValue = 0 
    } = req.body;

    // Validate required fields
    if (!name || !threshold) {
      return res.status(400).json({ 
        ok: false, 
        error: "Name and threshold are required" 
      });
    }

    // Validate discount values
    if (discountType === 'percentage' && (discountValue < 0 || discountValue > 100)) {
      return res.status(400).json({ 
        ok: false, 
        error: "Percentage discount must be between 0 and 100" 
      });
    }

    if (discountType === 'fixed' && discountValue < 0) {
      return res.status(400).json({ 
        ok: false, 
        error: "Fixed discount must be a positive value" 
      });
    }

    const business = await Business.findById(id);
    if (!business) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }

    // Check reward limit (only count templates, not customer rewards)
    const rewardCount = await Reward.countDocuments({ 
      businessId: id, 
      phone: { $exists: false } 
    });
    
    if (rewardCount >= 15) {
      return res.status(400).json({
        ok: false,
        error: "Maximum 15 active rewards allowed per business.",
      });
    }

    // ✅ Determine expiryDays — use given or business default
    const expiryDays = expirationDays || business.rewardExpiryDays || null;

    // ✅ Auto-calculate expiresAt from expiryDays
    const expiresAt = expiryDays
      ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000)
      : null;

    const newReward = await Reward.create({
      businessId: id,
      name,
      threshold,
      description: description || `Reward for ${business.name}`,
      code: `RW-${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
      expiryDays,
      expiresAt,
      priority,
      isActive,
      discountType,
      discountValue,
    });

    res.json({ ok: true, reward: newReward });
  } catch (err) {
    console.error("❌ Error adding reward:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
};

// ✅ UPDATE BUSINESS REWARD (FIXED - REMOVED DUPLICATE)
exports.updateBusinessReward = async (req, res) => {
  try {
    const { rewardId } = req.params;
    const { 
      name, 
      threshold, 
      expirationDays, 
      description,
      priority,
      isActive,
      discountType,
      discountValue 
    } = req.body;

    const reward = await Reward.findById(rewardId);
    if (!reward) {
      return res.status(404).json({ ok: false, error: "Reward not found" });
    }

    // Validate discount values if provided
    if (discountType === 'percentage' && discountValue !== undefined) {
      if (discountValue < 0 || discountValue > 100) {
        return res.status(400).json({ 
          ok: false, 
          error: "Percentage discount must be between 0 and 100" 
        });
      }
    }

    if (discountType === 'fixed' && discountValue !== undefined && discountValue < 0) {
      return res.status(400).json({ 
        ok: false, 
        error: "Fixed discount must be a positive value" 
      });
    }

    // Update fields only if provided
    if (name !== undefined) reward.name = name;
    if (threshold !== undefined) reward.threshold = threshold;
    if (description !== undefined) reward.description = description;
    if (priority !== undefined) reward.priority = priority;
    if (isActive !== undefined) reward.isActive = isActive;
    
    // ✅ Update discount fields
    if (discountType !== undefined) {
      reward.discountType = discountType;
      // Reset discount value if switching to 'none'
      if (discountType === 'none') {
        reward.discountValue = 0;
      }
    }
    
    if (discountValue !== undefined && discountType !== 'none') {
      reward.discountValue = discountValue;
    }

    // Handle expiration
    if (expirationDays !== undefined) {
      reward.expiryDays = expirationDays;
      reward.expiresAt = expirationDays
        ? new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000)
        : null;
    }

    await reward.save();

    res.json({ ok: true, message: "Reward updated successfully", reward });
  } catch (err) {
    console.error("❌ Error updating reward:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
};

// ✅ DELETE REWARD
exports.deleteBusinessReward = async (req, res) => {
  try {
    const { rewardId } = req.params;
    
    const reward = await Reward.findById(rewardId);
    if (!reward) {
      return res.status(404).json({ ok: false, error: "Reward not found" });
    }

    await Reward.findByIdAndDelete(rewardId);
    res.json({ ok: true, message: "Reward deleted successfully" });
  } catch (err) {
    console.error("❌ Error deleting reward:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
};

// ✅ REDEEM REWARD
exports.redeemReward = async (req, res) => {
  try {
    const { rewardId } = req.params;

    const reward = await Reward.findById(rewardId).populate("businessId", "name");
    if (!reward) {
      return res.status(404).json({ ok: false, error: "Reward not found" });
    }

    // Check if already redeemed
    if (reward.redeemed) {
      return res.status(400).json({ 
        ok: false, 
        message: "Reward already redeemed." 
      });
    }

    // Check if expired
    if (reward.expiresAt && new Date() > reward.expiresAt) {
      return res.status(400).json({ 
        ok: false, 
        message: "Reward has expired." 
      });
    }

    reward.redeemed = true;
    reward.redeemedAt = new Date();
    await reward.save();

    res.json({ 
      ok: true, 
      message: "Reward redeemed successfully", 
      reward,
      discount: reward.discountType !== 'none' ? {
        type: reward.discountType,
        value: reward.discountValue
      } : null
    });
  } catch (err) {
    console.error("❌ Error redeeming reward:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
};

// ✅ GET ACTIVE REWARDS (for customer view)
exports.getRewards = async (req, res) => {
  try {
    const now = new Date();

    const rewards = await Reward.find({
      redeemed: false,
      isActive: true, // Only show active rewards
      $or: [
        { expiresAt: null },
        { expiresAt: { $gt: now } } // only show non-expired rewards
      ]
    })
      .populate("businessId", "name")
      .sort({ priority: 1, createdAt: -1 });

    res.json({ ok: true, list: rewards });
  } catch (err) {
    console.error("❌ Error fetching active rewards:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
};

// ✅ GET REWARD STATISTICS FOR A BUSINESS
exports.getRewardStats = async (req, res) => {
  try {
    const { id } = req.params;

    const totalRewards = await Reward.countDocuments({ businessId: id });
    const redeemedCount = await Reward.countDocuments({ 
      businessId: id, 
      redeemed: true 
    });
    const activeCount = await Reward.countDocuments({ 
      businessId: id, 
      redeemed: false,
      isActive: true,
      $or: [
        { expiresAt: null },
        { expiresAt: { $gt: new Date() } }
      ]
    });

    res.json({ 
      ok: true, 
      stats: {
        total: totalRewards,
        redeemed: redeemedCount,
        active: activeCount,
        redemptionRate: totalRewards > 0 ? (redeemedCount / totalRewards * 100).toFixed(2) : 0
      }
    });
  } catch (err) {
    console.error("❌ Error fetching reward stats:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
};
