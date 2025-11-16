// scripts/fixCustomers.js
// Quick script to enable campaign eligibility for customers

const mongoose = require('mongoose');
const Customer = require('../src/models/Customer');

async function fixCustomers(businessId) {
  try {
    console.log('🔧 FIXING CUSTOMERS FOR CAMPAIGNS\n');

    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to database\n');

    // Find all customers for this business
    const query = businessId 
      ? { businessId: businessId }
      : {}; // If no businessId, update all

    const customers = await Customer.find(query);
    console.log(`📊 Found ${customers.length} customers\n`);

    let updated = 0;

    for (const customer of customers) {
      const updates = {};

      // 1. Fix subscriptionStatus
      if (!customer.subscriptionStatus) {
        updates.subscriptionStatus = 'subscribed';
      }

      // 2. Enable marketing consent (if they have general consent)
      if (customer.consentGiven && !customer.marketingConsent) {
        updates.marketingConsent = true;
        updates.marketingConsentDate = customer.consentTimestamp || new Date();
      }

      // 3. Ensure lastCheckin is set if they have lastCheckinAt
      if (customer.lastCheckinAt && !customer.lastCheckin) {
        updates.lastCheckin = customer.lastCheckinAt;
      }

      // 4. Set defaults for blocking/invalid flags
      if (customer.isBlocked === undefined) {
        updates.isBlocked = false;
      }
      if (customer.isInvalid === undefined) {
        updates.isInvalid = false;
      }

      // Apply updates
      if (Object.keys(updates).length > 0) {
        await Customer.findByIdAndUpdate(customer._id, updates);
        updated++;
        console.log(`✅ Updated ${customer.phone}`);
      }
    }

    console.log(`\n✅ Updated ${updated} customers\n`);

    // Show results
    const eligible = await Customer.countDocuments({
      ...(businessId ? { businessId } : {}),
      subscriptionStatus: 'subscribed',
      marketingConsent: true,
      isBlocked: { $ne: true },
      isInvalid: { $ne: true },
      phone: { $exists: true, $ne: null, $ne: '' }
    });

    console.log('📊 Campaign Eligibility Results:');
    console.log(`   Total eligible: ${eligible}`);

    await mongoose.connection.close();
    console.log('\n✅ Done!');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Usage
if (require.main === module) {
  const businessId = process.argv[2];
  
  console.log('⚠️  This will update customer records to enable campaigns.');
  console.log('   Press Ctrl+C to cancel, or wait 3 seconds...\n');

  setTimeout(() => {
    fixCustomers(businessId)
      .then(() => process.exit(0))
      .catch(err => {
        console.error(err);
        process.exit(1);
      });
  }, 3000);
}

module.exports = fixCustomers;