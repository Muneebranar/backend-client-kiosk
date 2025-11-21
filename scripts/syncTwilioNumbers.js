/**
 * Script to sync TwilioNumber.assignedBusinesses with actual Business assignments
 * Place this file in your PROJECT ROOT (same level as package.json)
 * Run with: node syncTwilioNumbers.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const Business = require('./models/Business');
const TwilioNumber = require('./models/TwilioNumber');

async function syncTwilioNumberAssignments() {
  try {
    console.log('🔍 Starting Twilio number assignment sync...\n');

    // Get all businesses with Twilio numbers
    const businesses = await Business.find({ 
      twilioNumber: { $exists: true, $ne: null, $ne: '' }
    }).select('_id name twilioNumber twilioNumberActive');

    console.log(`📊 Found ${businesses.length} businesses with Twilio numbers assigned\n`);

    // Get all Twilio numbers from database
    const twilioNumbers = await TwilioNumber.find();
    console.log(`📞 Found ${twilioNumbers.length} Twilio numbers in database\n`);

    // Get default number from environment
    const defaultNumber = process.env.DEFAULT_TWILIO_NUMBER;
    if (defaultNumber) {
      console.log(`🔧 Default Twilio number from env: ${defaultNumber}\n`);
    }

    // Create a map of what SHOULD be assigned
    const correctAssignments = new Map();
    
    for (const business of businesses) {
      const number = business.twilioNumber;
      
      // Skip default number (it's not in database)
      if (number === defaultNumber) {
        console.log(`   ⏭️  Skipping ${business.name} - uses default number`);
        continue;
      }

      if (!correctAssignments.has(number)) {
        correctAssignments.set(number, []);
      }
      correctAssignments.get(number).push({
        id: business._id.toString(),
        name: business.name,
        active: business.twilioNumberActive
      });
    }

    console.log('\n📋 Expected assignments:');
    correctAssignments.forEach((businesses, number) => {
      console.log(`   ${number}:`);
      businesses.forEach(b => {
        console.log(`      - ${b.name} (${b.id}) [${b.active ? 'active' : 'inactive'}]`);
      });
    });

    // Now check and fix each Twilio number
    console.log('\n🔧 Syncing Twilio numbers...\n');
    
    let fixedCount = 0;
    
    for (const twilioNum of twilioNumbers) {
      const expectedBusinesses = correctAssignments.get(twilioNum.number) || [];
      const expectedIds = expectedBusinesses.map(b => b.id);
      const currentIds = twilioNum.assignedBusinesses || [];

      // Check if arrays match
      const currentSet = new Set(currentIds);
      const expectedSet = new Set(expectedIds);
      
      const needsUpdate = 
        currentSet.size !== expectedSet.size ||
        ![...currentSet].every(id => expectedSet.has(id));

      if (needsUpdate) {
        console.log(`❌ MISMATCH: ${twilioNum.number} (${twilioNum.friendlyName})`);
        console.log(`   Current: [${currentIds.join(', ')}]`);
        console.log(`   Expected: [${expectedIds.join(', ')}]`);
        
        // Fix it
        twilioNum.assignedBusinesses = expectedIds;
        await twilioNum.save();
        
        console.log(`   ✅ FIXED: Updated to [${expectedIds.join(', ')}]`);
        fixedCount++;
      } else {
        console.log(`✅ OK: ${twilioNum.number} (${twilioNum.friendlyName})`);
        if (expectedIds.length > 0) {
          expectedBusinesses.forEach(b => {
            console.log(`      - ${b.name}`);
          });
        } else {
          console.log(`      (no assignments)`);
        }
      }
      console.log('');
    }

    // Check for numbers in Business collection that don't exist in TwilioNumber
    console.log('\n🔍 Checking for missing Twilio numbers...\n');
    
    const twilioNumbersSet = new Set(twilioNumbers.map(tn => tn.number));
    const missingNumbers = new Set();
    
    for (const business of businesses) {
      const number = business.twilioNumber;
      if (number && number !== defaultNumber && !twilioNumbersSet.has(number)) {
        missingNumbers.add(number);
        console.log(`⚠️  WARNING: ${business.name} uses ${number} which doesn't exist in TwilioNumber collection!`);
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SYNC SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Twilio numbers in database: ${twilioNumbers.length}`);
    console.log(`Total businesses with numbers: ${businesses.length}`);
    console.log(`Numbers fixed: ${fixedCount}`);
    console.log(`Missing numbers: ${missingNumbers.size}`);
    console.log('='.repeat(60) + '\n');

    if (fixedCount > 0) {
      console.log('✅ Sync completed successfully!');
    } else {
      console.log('✅ All Twilio numbers were already in sync!');
    }

    if (missingNumbers.size > 0) {
      console.log('\n⚠️  Action required: Some businesses reference Twilio numbers that don\'t exist.');
      console.log('   You may need to add these numbers to the TwilioNumber collection.');
    }

  } catch (error) {
    console.error('❌ Error during sync:', error);
    throw error;
  }
}

// If running as a script
if (require.main === module) {
  // Connect to MongoDB
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  
  if (!mongoUri) {
    console.error('❌ No MongoDB connection string found in environment variables!');
    console.error('   Please set MONGODB_URI or MONGO_URI in your .env file');
    process.exit(1);
  }

  console.log('🔌 Connecting to MongoDB...');
  
  mongoose.connect(mongoUri)
    .then(() => {
      console.log('✅ Connected to MongoDB\n');
      return syncTwilioNumberAssignments();
    })
    .then(() => {
      console.log('\n✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

// Export for use as a module
module.exports = { syncTwilioNumberAssignments };