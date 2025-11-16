require('dotenv').config();
const mongoose = require('mongoose');

async function migrate() {
  await mongoose.connect(process.env.MONGO_URI);
  
  const Customer = require('../models/Customer');
  
  // Set marketingConsent to match consentGiven for existing customers
  await Customer.updateMany(
    { marketingConsent: { $exists: false } },
    { 
      $set: { 
        marketingConsent: true, // Assume existing subscribed customers consented to marketing
        marketingConsentDate: new Date()
      } 
    }
  );
  
  // Set isInvalid default
  await Customer.updateMany(
    { isInvalid: { $exists: false } },
    { $set: { isInvalid: false } }
  );
  
  // Set lastCheckin from most recent checkin
  const CheckinLog = require('../models/CheckinLog');
  const customers = await Customer.find({});
  
  for (const customer of customers) {
    const lastCheckin = await CheckinLog.findOne({ 
      customerId: customer._id 
    })
      .sort({ timestamp: -1 })
      .limit(1);
    
    if (lastCheckin) {
      customer.lastCheckin = lastCheckin.timestamp;
      await customer.save();
    }
  }
  
  console.log('✅ Migration complete');
  await mongoose.connection.close();
  process.exit(0);
}

migrate().catch(console.error);