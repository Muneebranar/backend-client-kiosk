// cron/expireRewards.js
const mongoose = require("mongoose");
const cron = require("node-cron");

const RewardStatus = require("../models/rewardHistory");
const Reward = require("../models/Reward");
const Business = require("../models/Business");

// Run every night at 12:00 AM
cron.schedule("0 0 * * *", async () => {
  console.log("⏰ Running daily reward expiry check...");
  try {
    const statuses = await RewardStatus.find({ status: { $ne: "Expired" } });

    for (const s of statuses) {
      const reward = await Reward.findById(s.rewardId);
      if (!reward) continue;

      const business = await Business.findById(reward.businessId);
      if (!business) continue;

      const expiryDays = business.rewardExpiryDays || 7;
      const expiryDate = new Date(reward.createdAt);
      expiryDate.setDate(expiryDate.getDate() + expiryDays);

      if (new Date() > expiryDate) {
        s.status = "Expired";
        await s.save();
        console.log(`💀 Reward ${reward.code} expired for business ${business.name}`);
      }
    }

    console.log("✅ Reward expiry check completed.");
  } catch (err) {
    console.error("❌ Error running expiry check:", err);
  }
});
