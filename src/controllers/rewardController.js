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
      priority = 1,
      discountType = 'none',
      discountValue = 0 
    } = req.body;

    const business = await Business.findById(id);
    if (!business)
      return res.status(404).json({ ok: false, error: "Business not found" });

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
      description: `Reward for ${business.name}`,
      code: `RW-${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
      expiryDays,
      expiresAt,
      priority,
      isActive: req.body.isActive !== undefined ? req.body.isActive : true,
      discountType,
      discountValue,
    });

    res.json({ ok: true, reward: newReward });
  } catch (err) {
    console.error("Error adding reward:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ✅ UPDATE BUSINESS REWARD
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
    if (!reward)
      return res.status(404).json({ ok: false, error: "Reward not found" });

    // Update fields
    if (name) reward.name = name;
    if (threshold) reward.threshold = threshold;
    if (description !== undefined) reward.description = description;
    if (priority !== undefined) reward.priority = priority;
    if (isActive !== undefined) reward.isActive = isActive;
    
    // ✅ Update discount fields
    if (discountType !== undefined) reward.discountType = discountType;
    if (discountValue !== undefined) reward.discountValue = discountValue;

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

    const reward = await Reward.findById(rewardId);
    if (!reward)
      return res.status(404).json({ ok: false, error: "Reward not found" });

    if (reward.redeemed) {
      return res.json({ ok: false, message: "Reward already redeemed." });
    }

    reward.redeemed = true;
    reward.redeemedAt = new Date();
    await reward.save();

    res.json({ ok: true, message: "Reward redeemed successfully", reward });
  } catch (err) {
    console.error("❌ Error redeeming reward:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
};
// rewardController.js
exports.getRewards = async (req, res) => {
  try {
    const now = new Date();

    const rewards = await Reward.find({
      redeemed: false,
      $or: [
        { expiresAt: null },
        { expiresAt: { $gt: now } } // only show non-expired rewards
      ]
    })
      .populate("businessId", "name")
      .sort({ createdAt: -1 });

    res.json({ ok: true, list: rewards });
  } catch (err) {
    console.error("Error fetching active rewards:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
};
// ✅ EDIT BUSINESS REWARD
exports.updateBusinessReward = async (req, res) => {
  try {
    const { rewardId } = req.params;
    const { name, threshold, expirationDays, description } = req.body;

    // Find reward
    const reward = await Reward.findById(rewardId);
    if (!reward)
      return res.status(404).json({ ok: false, error: "Reward not found" });

    // Update fields
    if (name) reward.name = name;
    if (threshold) reward.threshold = threshold;
    if (description) reward.description = description;

    // Handle new expiration
    if (expirationDays !== undefined) {
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

