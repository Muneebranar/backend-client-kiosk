// scripts/registerTwilioNumbers.js
// Run this script ONCE to sync your Business.twilioNumber → TwilioNumber collection
// Usage: node scripts/registerTwilioNumbers.js

const mongoose = require('mongoose');
require('dotenv').config();

// Define schemas inline
const twilioNumberSchema = new mongoose.Schema({
  number: { type: String, required: true, unique: true },
  friendlyName: String,
  isActive: { type: Boolean, default: true },
  assignedBusinesses: [{ type: String }],
  capabilities: {
    voice: { type: Boolean, default: true },
    sms: { type: Boolean, default: true },
    mms: { type: Boolean, default: false }
  }
}, { timestamps: true });

const TwilioNumber = mongoose.models.TwilioNumber || mongoose.model('TwilioNumber', twilioNumberSchema);
const Business = mongoose.models.Business || mongoose.model('Business', new mongoose.Schema({}, { strict: false }));

async function registerTwilioNumbers() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get all businesses that have Twilio numbers
    const businesses = await Business.find({ 
      twilioNumber: { $exists: true, $ne: null, $ne: '' } 
    }).select('_id name twilioNumber twilioNumberActive');
    
    console.log(`📋 Found ${businesses.length} businesses with Twilio numbers\n`);

    if (businesses.length === 0) {
      console.log('⚠️ No businesses with Twilio numbers found!');
      console.log('💡 Make sure your businesses have twilioNumber field set\n');
      process.exit(0);
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const business of businesses) {
      const phoneNumber = business.twilioNumber.trim();
      
      // Normalize phone number
      const normalizedNumber = phoneNumber.startsWith('+') 
        ? phoneNumber 
        : `+${phoneNumber}`;

      try {
        // Check if Twilio number already exists
        let twilioNumberDoc = await TwilioNumber.findOne({
          number: normalizedNumber
        });

        const businessIdStr = business._id.toString();

        if (twilioNumberDoc) {
          // Check if this business is already assigned
          if (twilioNumberDoc.assignedBusinesses.includes(businessIdStr)) {
            console.log(`⏭️  Already linked: ${normalizedNumber} → ${business.name}`);
            skipped++;
          } else {
            // Add business to assignedBusinesses array
            twilioNumberDoc.assignedBusinesses.push(businessIdStr);
            await twilioNumberDoc.save();
            console.log(`🔗 Linked existing: ${normalizedNumber} → ${business.name}`);
            updated++;
          }
        } else {
          // Create new TwilioNumber record
          twilioNumberDoc = await TwilioNumber.create({
            number: normalizedNumber,
            friendlyName: `${business.name} SMS Number`,
            isActive: business.twilioNumberActive !== false,
            assignedBusinesses: [businessIdStr],
            capabilities: {
              voice: false,
              sms: true,
              mms: false
            }
          });
          console.log(`✅ Created: ${normalizedNumber} → ${business.name}`);
          created++;
        }
      } catch (err) {
        if (err.code === 11000) {
          // Duplicate key error - number exists but query didn't find it
          console.log(`⚠️  Duplicate number (race condition): ${normalizedNumber}`);
          skipped++;
        } else {
          console.error(`❌ Error processing ${phoneNumber} for ${business.name}:`, err.message);
          errors++;
        }
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 REGISTRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Newly Created: ${created}`);
    console.log(`🔗 Updated (linked): ${updated}`);
    console.log(`⏭️  Already Linked: ${skipped}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📊 Total Processed: ${businesses.length}`);
    console.log('='.repeat(60) + '\n');

    if (created > 0 || updated > 0) {
      console.log('🎉 Success! Your Twilio numbers are now registered.');
      console.log('💡 Webhook will now find businesses instantly!\n');
    }

    // Show final state
    console.log('📋 Current TwilioNumber Records:\n');
    const allNumbers = await TwilioNumber.find({}).lean();
    for (const num of allNumbers) {
      console.log(`  ${num.number}:`);
      console.log(`    - Active: ${num.isActive}`);
      console.log(`    - Businesses: ${num.assignedBusinesses.length}`);
      console.log(`    - IDs: [${num.assignedBusinesses.join(', ')}]\n`);
    }

    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Fatal Error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

// Run the script
registerTwilioNumbers();