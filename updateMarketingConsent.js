// updateMarketingConsent.js
const mongoose = require('mongoose');
require('dotenv').config();
const Customer = require('./src/models/Customer');

async function updateMarketingConsent() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Update all active customers to have marketing consent
    const result = await Customer.updateMany(
      {
        subscriberStatus: 'active',
        deleted: { $ne: true }
      },
      {
        $set: {
          marketingConsent: true,
          marketingConsentDate: new Date()
        }
      }
    );

    console.log(`✅ Updated ${result.modifiedCount} customers`);
    console.log(`   Marketing consent: true`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

updateMarketingConsent();