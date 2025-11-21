/**
 * Script to sync TwilioNumber.assignedBusinesses with actual Business assignments
 * Run this to fix mismatches between collections
 * FIXED: Now properly handles DEFAULT_TWILIO_NUMBER assignments
 */

const mongoose = require('mongoose');
require('dotenv').config();
const Business = require('./src/models/Business');
const TwilioNumber = require('./src/models/TwilioNumber');

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

    // Create a map of what SHOULD be assigned (INCLUDING default number)
    const correctAssignments = new Map();
    
    for (const business of businesses) {
      const number = business.twilioNumber;
      
      // REMOVED: No longer skipping default number!
      // Now we include ALL numbers, including the default one

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
      const isDefault = number === defaultNumber ? ' [DEFAULT]' : '';
      console.log(`   ${number}${isDefault}:`);
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

      const isDefault = twilioNum.number === defaultNumber;

      // Check if arrays match
      const currentSet = new Set(currentIds);
      const expectedSet = new Set(expectedIds);
      
      const needsUpdate = 
        currentSet.size !== expectedSet.size ||
        ![...currentSet].every(id => expectedSet.has(id));

      if (needsUpdate) {
        const defaultLabel = isDefault ? ' [DEFAULT]' : '';
        console.log(`❌ MISMATCH: ${twilioNum.number}${defaultLabel} (${twilioNum.friendlyName})`);
        console.log(`   Current: [${currentIds.join(', ') || 'none'}]`);
        console.log(`   Expected: [${expectedIds.join(', ') || 'none'}]`);
        
        // Fix it
        twilioNum.assignedBusinesses = expectedIds;
        await twilioNum.save();
        
        console.log(`   ✅ FIXED: Updated to [${expectedIds.join(', ') || 'none'}]`);
        fixedCount++;
      } else {
        const defaultLabel = isDefault ? ' [DEFAULT]' : '';
        console.log(`✅ OK: ${twilioNum.number}${defaultLabel} (${twilioNum.friendlyName})`);
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
      if (number && !twilioNumbersSet.has(number)) {
        missingNumbers.add(number);
        const isDefault = number === defaultNumber ? ' [DEFAULT NUMBER!]' : '';
        console.log(`⚠️  WARNING: ${business.name} uses ${number}${isDefault} which doesn't exist in TwilioNumber collection!`);
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
    if (defaultNumber) {
      const defaultBusinesses = correctAssignments.get(defaultNumber) || [];
      console.log(`Businesses using default number: ${defaultBusinesses.length}`);
    }
    console.log('='.repeat(60) + '\n');

    if (fixedCount > 0) {
      console.log('✅ Sync completed successfully!');
    } else {
      console.log('✅ All Twilio numbers were already in sync!');
    }

    if (missingNumbers.size > 0) {
      console.log('\n⚠️  Action required: Some businesses reference Twilio numbers that don\'t exist.');
      console.log('   You may need to add these numbers to the TwilioNumber collection.');
      
      if (missingNumbers.has(defaultNumber)) {
        console.log('\n🚨 CRITICAL: The DEFAULT_TWILIO_NUMBER is missing from TwilioNumber collection!');
        console.log(`   Please add ${defaultNumber} to the TwilioNumber collection.`);
      }
    }

  } catch (error) {
    console.error('❌ Error during sync:', error);
    throw error;
  }
}

// If running as a script
if (require.main === module) {
  // Connect to MongoDB
  mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
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