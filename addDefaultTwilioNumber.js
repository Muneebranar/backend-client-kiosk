// addDefaultTwilioNumber.js
const mongoose = require('mongoose');
require('dotenv').config();
const TwilioNumber = require('./src/models/TwilioNumber');

async function addDefaultNumber() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB\n');
    
    const defaultNumber = process.env.DEFAULT_TWILIO_NUMBER;
    
    if (!defaultNumber) {
      console.error('❌ DEFAULT_TWILIO_NUMBER not found in environment variables!');
      process.exit(1);
    }
    
    console.log(`🔍 Checking for default number: ${defaultNumber}\n`);
    
    const exists = await TwilioNumber.findOne({ number: defaultNumber });
    
    if (!exists) {
      const newNumber = await TwilioNumber.create({
        number: defaultNumber,
        friendlyName: 'Default Twilio Number',
        assignedBusinesses: []
      });
      console.log('✅ Added default number to TwilioNumber collection');
      console.log(`   Number: ${newNumber.number}`);
      console.log(`   Friendly Name: ${newNumber.friendlyName}`);
      console.log(`   Assigned Businesses: []`);
    } else {
      console.log('✅ Default number already exists in TwilioNumber collection');
      console.log(`   Number: ${exists.number}`);
      console.log(`   Friendly Name: ${exists.friendlyName}`);
      console.log(`   Assigned Businesses: [${exists.assignedBusinesses.join(', ')}]`);
    }
    
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

addDefaultNumber();