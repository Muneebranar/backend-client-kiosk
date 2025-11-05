// scripts/fix-missing-customerid.js
// Run this ONCE to fix existing CheckinLog and RewardHistory records

const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const CheckinLog = require('../models/CheckinLog');
const RewardHistory = require('../models/RewardHistory');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/your-database-name';

async function fixMissingCustomerIds() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // ========== FIX CHECKINLOGS ==========
    console.log('\n📋 Fixing CheckinLog records...');
    
    const checkinlogsWithoutCustomerId = await CheckinLog.find({
      $or: [
        { customerId: { $exists: false } },
        { customerId: null }
      ]
    });

    console.log(`Found ${checkinlogsWithoutCustomerId.length} checkin logs without customerId`);

    let checkinsFixed = 0;
    let checkinsSkipped = 0;

    for (const checkin of checkinlogsWithoutCustomerId) {
      try {
        // Find customer by phone and businessId
        const customer = await Customer.findOne({
          phone: checkin.phone,
          businessId: checkin.businessId
        });

        if (customer) {
          checkin.customerId = customer._id;
          await checkin.save();
          checkinsFixed++;
          console.log(`✅ Fixed checkin ${checkin._id} (${checkin.phone}) -> customer ${customer._id}`);
        } else {
          checkinsSkipped++;
          console.log(`⚠️ No customer found for checkin ${checkin._id} (${checkin.phone})`);
        }
      } catch (err) {
        console.error(`❌ Error fixing checkin ${checkin._id}:`, err.message);
        checkinsSkipped++;
      }
    }

    console.log(`\n📊 CheckinLog Results:`);
    console.log(`   ✅ Fixed: ${checkinsFixed}`);
    console.log(`   ⚠️ Skipped: ${checkinsSkipped}`);

    // ========== FIX REWARD HISTORY ==========
    console.log('\n🎁 Fixing RewardHistory records...');
    
    const rewardsWithoutCustomerId = await RewardHistory.find({
      $or: [
        { customerId: { $exists: false } },
        { customerId: null }
      ]
    });

    console.log(`Found ${rewardsWithoutCustomerId.length} rewards without customerId`);

    let rewardsFixed = 0;
    let rewardsSkipped = 0;

    for (const reward of rewardsWithoutCustomerId) {
      try {
        // Try to find customer by phone
        let customer = null;
        
        if (reward.phone) {
          customer = await Customer.findOne({
            phone: reward.phone,
            businessId: reward.businessId
          });
        }

        // If not found by phone, try by linked checkin
        if (!customer && reward.checkinId) {
          const checkin = await CheckinLog.findById(reward.checkinId);
          if (checkin && checkin.customerId) {
            customer = await Customer.findById(checkin.customerId);
          }
        }

        if (customer) {
          reward.customerId = customer._id;
          await reward.save();
          rewardsFixed++;
          console.log(`✅ Fixed reward ${reward._id} (${reward.phone}) -> customer ${customer._id}`);
        } else {
          rewardsSkipped++;
          console.log(`⚠️ No customer found for reward ${reward._id} (${reward.phone})`);
        }
      } catch (err) {
        console.error(`❌ Error fixing reward ${reward._id}:`, err.message);
        rewardsSkipped++;
      }
    }

    console.log(`\n📊 RewardHistory Results:`);
    console.log(`   ✅ Fixed: ${rewardsFixed}`);
    console.log(`   ⚠️ Skipped: ${rewardsSkipped}`);

    // ========== VERIFY FIXES ==========
    console.log('\n🔍 Verifying fixes...');
    
    const remainingCheckinsMissing = await CheckinLog.countDocuments({
      $or: [
        { customerId: { $exists: false } },
        { customerId: null }
      ]
    });

    const remainingRewardsMissing = await RewardHistory.countDocuments({
      $or: [
        { customerId: { $exists: false } },
        { customerId: null }
      ]
    });

    console.log(`   CheckinLogs still missing customerId: ${remainingCheckinsMissing}`);
    console.log(`   RewardHistory still missing customerId: ${remainingRewardsMissing}`);

    // ========== SUMMARY ==========
    console.log('\n' + '='.repeat(60));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`CheckinLogs: ${checkinsFixed} fixed, ${checkinsSkipped} skipped`);
    console.log(`Rewards:     ${rewardsFixed} fixed, ${rewardsSkipped} skipped`);
    console.log(`Total Fixed: ${checkinsFixed + rewardsFixed}`);
    console.log('='.repeat(60));

    if (remainingCheckinsMissing === 0 && remainingRewardsMissing === 0) {
      console.log('\n✅ All records fixed successfully!');
    } else {
      console.log('\n⚠️ Some records could not be fixed (no matching customers)');
    }
    
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
    process.exit(0);
  }
}

// Run the migration
fixMissingCustomerIds();