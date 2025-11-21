// scripts/fixTwilioAssignments.js
// Run this ONCE to fix all existing TwilioNumber assignments

const mongoose = require('mongoose');
const Business = require('../models/Business');
const TwilioNumber = require('../models/TwilioNumber');
require('dotenv').config();

async function fixTwilioAssignments() {
  try {
    console.log('🔧 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to database');

    console.log('\n📊 Current State:');
    
    // Check current state
    const businesses = await Business.find({ 
      twilioNumber: { $exists: true, $ne: null, $ne: '' } 
    }).select('_id name twilioNumber');
    
    const twilioNumbers = await TwilioNumber.find();
    const defaultNumber = process.env.DEFAULT_TWILIO_NUMBER;

    console.log(`   Businesses with Twilio numbers: ${businesses.length}`);
    console.log(`   TwilioNumber documents: ${twilioNumbers.length}`);
    console.log(`   Default Twilio number: ${defaultNumber}`);

    // Show which businesses use which numbers
    console.log('\n📱 Current Business → Number mapping:');
    businesses.forEach(b => {
      const isDefault = b.twilioNumber === defaultNumber;
      console.log(`   ${b.name}: ${b.twilioNumber}${isDefault ? ' (DEFAULT)' : ''}`);
    });

    // Show current assignedBusinesses arrays
    console.log('\n📞 Current TwilioNumber assignedBusinesses arrays:');
    twilioNumbers.forEach(tn => {
      console.log(`   ${tn.number}: [${tn.assignedBusinesses.join(', ')}] (${tn.assignedBusinesses.length} assigned)`);
    });

    // Build correct assignments
    console.log('\n🔄 Building correct assignments...');
    const numberToBusinesses = new Map();

    businesses.forEach(business => {
      const number = business.twilioNumber;
      
      // Skip default number (not tracked in DB)
      if (number === defaultNumber) {
        console.log(`   ⏭️  ${business.name} uses default number (skipping)`);
        return;
      }

      if (!numberToBusinesses.has(number)) {
        numberToBusinesses.set(number, []);
      }
      numberToBusinesses.get(number).push(business._id.toString());
      console.log(`   ✅ ${business.name} → ${number}`);
    });

    // Update each TwilioNumber
    console.log('\n✏️  Updating TwilioNumber documents...');
    let updatedCount = 0;

    for (const twilioNumber of twilioNumbers) {
      const expectedBusinessIds = numberToBusinesses.get(twilioNumber.number) || [];
      const currentBusinessIds = twilioNumber.assignedBusinesses || [];

      console.log(`\n   Processing: ${twilioNumber.number}`);
      console.log(`      Current: [${currentBusinessIds.join(', ')}]`);
      console.log(`      Expected: [${expectedBusinessIds.join(', ')}]`);

      // Check if update needed
      const expectedSorted = [...expectedBusinessIds].sort();
      const currentSorted = [...currentBusinessIds].sort();
      const needsUpdate = JSON.stringify(expectedSorted) !== JSON.stringify(currentSorted);

      if (needsUpdate) {
        twilioNumber.assignedBusinesses = expectedBusinessIds;
        await twilioNumber.save();
        console.log(`      ✅ UPDATED`);
        updatedCount++;
      } else {
        console.log(`      ✓ Already correct`);
      }
    }

    // Final verification
    console.log('\n\n✅ Migration Complete!');
    console.log(`   Total TwilioNumbers: ${twilioNumbers.length}`);
    console.log(`   Updated: ${updatedCount}`);
    console.log(`   No changes needed: ${twilioNumbers.length - updatedCount}`);

    // Show final state
    console.log('\n📊 Final State:');
    const updatedNumbers = await TwilioNumber.find();
    updatedNumbers.forEach(tn => {
      console.log(`   ${tn.number}: [${tn.assignedBusinesses.join(', ')}] (${tn.assignedBusinesses.length} businesses)`);
    });

    console.log('\n🎉 All done! TwilioNumber assignments are now in sync.\n');

    await mongoose.connection.close();
    process.exit(0);

  } catch (err) {
    console.error('\n❌ Migration failed:', err);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the migration
console.log('🚀 Starting TwilioNumber Assignment Fix...\n');
fixTwilioAssignments();