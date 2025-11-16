// scripts/migrateCustomerFields.js
// Run this ONCE to fix existing customer data

const mongoose = require('mongoose');
const Customer = require('../src/models/Customer');

async function migrateCustomers() {
  try {
    console.log('🔄 Starting customer data migration...\n');

    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/your-db-name');
    console.log('✅ Connected to database\n');

    // Get all customers
    const customers = await Customer.find({});
    console.log(`📊 Found ${customers.length} customers to migrate\n`);

    let updated = 0;
    let skipped = 0;

    for (const customer of customers) {
      let needsUpdate = false;
      const updates = {};

      // 1. Fix subscriptionStatus based on subscriberStatus
      if (!customer.subscriptionStatus || customer.subscriptionStatus === undefined) {
        const statusMap = {
          'active': 'subscribed',
          'invalid': 'invalid',
          'blocked': 'blocked',
          'opted-out': 'unsubscribed',
          'unsubscribed': 'unsubscribed'
        };
        updates.subscriptionStatus = statusMap[customer.subscriberStatus] || 'subscribed';
        needsUpdate = true;
      }

      // 2. Sync lastCheckin and lastCheckinAt
      if (customer.lastCheckinAt && !customer.lastCheckin) {
        updates.lastCheckin = customer.lastCheckinAt;
        needsUpdate = true;
      } else if (customer.lastCheckin && !customer.lastCheckinAt) {
        updates.lastCheckinAt = customer.lastCheckin;
        needsUpdate = true;
      }

      // 3. Set default marketingConsent if undefined
      if (customer.marketingConsent === undefined) {
        // If they have consentGiven=true, assume marketing consent
        updates.marketingConsent = customer.consentGiven === true;
        if (updates.marketingConsent && !customer.marketingConsentDate) {
          updates.marketingConsentDate = customer.consentTimestamp || customer.createdAt;
        }
        needsUpdate = true;
      }

      // 4. Set isBlocked default
      if (customer.isBlocked === undefined) {
        updates.isBlocked = customer.subscriberStatus === 'blocked';
        needsUpdate = true;
      }

      // 5. Set isInvalid default
      if (customer.isInvalid === undefined) {
        updates.isInvalid = customer.subscriberStatus === 'invalid';
        needsUpdate = true;
      }

      // Apply updates if needed
      if (needsUpdate) {
        await Customer.findByIdAndUpdate(customer._id, updates);
        updated++;
        
        if (updated % 10 === 0) {
          console.log(`   Progress: ${updated}/${customers.length} updated`);
        }
      } else {
        skipped++;
      }
    }

    console.log('\n✅ Migration completed!');
    console.log(`   Updated: ${updated}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Total: ${customers.length}\n`);

    // Show statistics
    const stats = await Customer.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          subscribed: {
            $sum: { $cond: [{ $eq: ['$subscriptionStatus', 'subscribed'] }, 1, 0] }
          },
          withMarketingConsent: {
            $sum: { $cond: ['$marketingConsent', 1, 0] }
          },
          notBlocked: {
            $sum: { $cond: [{ $ne: ['$isBlocked', true] }, 1, 0] }
          },
          notInvalid: {
            $sum: { $cond: [{ $ne: ['$isInvalid', true] }, 1, 0] }
          },
          withPhone: {
            $sum: { $cond: [{ $and: [{ $ne: ['$phone', null] }, { $ne: ['$phone', ''] }] }, 1, 0] }
          }
        }
      }
    ]);

    if (stats.length > 0) {
      console.log('📊 Database Statistics:');
      console.log(`   Total customers: ${stats[0].total}`);
      console.log(`   Subscribed: ${stats[0].subscribed}`);
      console.log(`   With marketing consent: ${stats[0].withMarketingConsent}`);
      console.log(`   Not blocked: ${stats[0].notBlocked}`);
      console.log(`   Not invalid: ${stats[0].notInvalid}`);
      console.log(`   With phone: ${stats[0].withPhone}\n`);
    }

    await mongoose.connection.close();
    console.log('✅ Database connection closed');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  migrateCustomers()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = migrateCustomers;