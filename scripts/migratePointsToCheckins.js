// scripts/migratePointsToCheckins.js
// Run this ONCE to migrate from points-based to checkin-based system
require('dotenv').config();
const mongoose = require('mongoose');
const Customer = require('../src/models/Customer');
const Business = require('../src/models/Business');

async function migratePointsToCheckins() {
  try {
    console.log('🔄 Starting migration: Points → Check-ins\n');

    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to database\n');

    // 1. Update all businesses with default settings
    console.log('📋 Step 1: Setting default business settings...');
    const businessUpdateResult = await Business.updateMany(
      { 
        $or: [
          { rewardThreshold: { $exists: false } },
          { checkinCooldownHours: { $exists: false } },
          { rewardExpiryDays: { $exists: false } }
        ]
      },
      {
        $set: {
          rewardThreshold: 10,           // Default: 10 check-ins for reward
          checkinCooldownHours: 24,      // Default: 24-hour cooldown
          rewardExpiryDays: 30,          // Default: 30-day expiration
          maxActiveRewards: 15
        }
      }
    );
    console.log(`✅ Updated ${businessUpdateResult.modifiedCount} businesses\n`);

    // 2. For existing customers: Keep their totalCheckins as-is
    //    Points field is now ignored/deprecated
    console.log('📋 Step 2: Verifying customer data...');
    const totalCustomers = await Customer.countDocuments();
    console.log(`   Found ${totalCustomers} total customers`);
    
    const customersWithCheckins = await Customer.countDocuments({ 
      totalCheckins: { $gt: 0 } 
    });
    console.log(`   ${customersWithCheckins} customers have check-in history`);

    // Optional: Remove points field from schema (or just ignore it)
    console.log('\n📋 Step 3: Cleaning up deprecated fields...');
    
    // Remove "points" field from all customers (optional)
    const cleanupResult = await Customer.updateMany(
      { points: { $exists: true } },
      { $unset: { points: "" } }
    );
    console.log(`✅ Removed "points" field from ${cleanupResult.modifiedCount} customers\n`);

    // 3. Show summary
    console.log('📊 Migration Summary:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ Businesses updated: ${businessUpdateResult.modifiedCount}`);
    console.log(`✅ Total customers: ${totalCustomers}`);
    console.log(`✅ Customers with check-ins: ${customersWithCheckins}`);
    console.log(`✅ Points field removed from: ${cleanupResult.modifiedCount} customers`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('✨ Migration completed successfully!');
    console.log('\n📝 Next steps:');
    console.log('   1. Update your frontend to show check-ins instead of points');
    console.log('   2. Update kiosk messages to show "X more check-ins" instead of points');
    console.log('   3. Allow admins to customize cooldown hours via settings panel');
    console.log('   4. Test check-in flow with various cooldown periods\n');

    await mongoose.disconnect();
    console.log('✅ Database disconnected');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migratePointsToCheckins()
  .then(() => {
    console.log('\n✅ Migration script completed');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ Migration script failed:', err);
    process.exit(1);
  });