// scripts/testCampaignSetup.js
// Test script to verify campaign prerequisites

const mongoose = require('mongoose');
const Customer = require('../src/models/Customer');
const TwilioNumber = require('../src/models/TwilioNumber');
const Business = require('../src/models/Business');

async function testCampaignSetup(businessId) {
  try {
    console.log('🧪 TESTING CAMPAIGN SETUP\n');
    console.log('=' .repeat(60));

    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to database\n');

    // TEST 1: Business exists
    console.log('TEST 1: Checking business...');
    const business = await Business.findById(businessId);
    if (!business) {
      console.error('❌ FAIL: Business not found');
      return;
    }
    console.log(`✅ PASS: Business "${business.name}" found\n`);

    // TEST 2: Twilio number assigned
    console.log('TEST 2: Checking Twilio number...');
    const twilioNumber = await TwilioNumber.findOne({
      businessId: businessId,
      isActive: true
    });
    
    if (!twilioNumber) {
      console.error('❌ FAIL: No active Twilio number assigned');
      console.log('\n📋 How to fix:');
      console.log('   1. Go to Admin Panel > Twilio Numbers');
      console.log('   2. Click "Add Twilio Number"');
      console.log('   3. Enter phone number and select business');
      console.log('   4. Make sure "Active" is checked\n');
      
      // Show existing numbers
      const allNumbers = await TwilioNumber.find({});
      if (allNumbers.length > 0) {
        console.log('Existing Twilio numbers:');
        allNumbers.forEach(n => {
          console.log(`   ${n.phoneNumber} - Business: ${n.businessId} - Active: ${n.isActive}`);
        });
      } else {
        console.log('⚠️ No Twilio numbers in database at all!');
      }
      return;
    }
    console.log(`✅ PASS: Twilio number ${twilioNumber.phoneNumber} is active\n`);

    // TEST 3: Check customers
    console.log('TEST 3: Checking customers...');
    const totalCustomers = await Customer.countDocuments({ businessId });
    console.log(`   Total customers: ${totalCustomers}`);

    if (totalCustomers === 0) {
      console.error('❌ FAIL: No customers found for this business');
      return;
    }

    // TEST 4: Check eligible customers for campaigns
    console.log('\nTEST 4: Checking campaign-eligible customers...');
    
    const eligibleQuery = {
      businessId: businessId,
      subscriptionStatus: 'subscribed',
      marketingConsent: true,
      isBlocked: { $ne: true },
      isInvalid: { $ne: true },
      phone: { $exists: true, $ne: null, $ne: '' }
    };

    const eligible = await Customer.countDocuments(eligibleQuery);
    console.log(`   Eligible for campaigns: ${eligible}`);

    if (eligible === 0) {
      console.error('❌ FAIL: No eligible customers found');
      
      // Debug breakdown
      const breakdown = {
        total: totalCustomers,
        subscribed: await Customer.countDocuments({ 
          businessId, 
          subscriptionStatus: 'subscribed' 
        }),
        withMarketingConsent: await Customer.countDocuments({ 
          businessId, 
          marketingConsent: true 
        }),
        notBlocked: await Customer.countDocuments({ 
          businessId, 
          isBlocked: { $ne: true } 
        }),
        notInvalid: await Customer.countDocuments({ 
          businessId, 
          isInvalid: { $ne: true } 
        }),
        withPhone: await Customer.countDocuments({ 
          businessId, 
          phone: { $exists: true, $ne: null, $ne: '' } 
        })
      };

      console.log('\n📊 Customer Breakdown:');
      console.log(`   Total: ${breakdown.total}`);
      console.log(`   Subscribed: ${breakdown.subscribed}`);
      console.log(`   With marketing consent: ${breakdown.withMarketingConsent}`);
      console.log(`   Not blocked: ${breakdown.notBlocked}`);
      console.log(`   Not invalid: ${breakdown.notInvalid}`);
      console.log(`   With phone: ${breakdown.withPhone}`);

      // Show a sample customer
      const sampleCustomer = await Customer.findOne({ businessId })
        .select('phone subscriptionStatus marketingConsent isBlocked isInvalid')
        .lean();
      
      if (sampleCustomer) {
        console.log('\n📝 Sample customer:');
        console.log(JSON.stringify(sampleCustomer, null, 2));
      }

      console.log('\n📋 How to fix:');
      console.log('   Run this command to update customers:');
      console.log('   node scripts/fixCustomers.js ' + businessId);
      return;
    }

    console.log(`✅ PASS: ${eligible} customers eligible for campaigns\n`);

    // TEST 5: Sample customers
    console.log('TEST 5: Sample eligible customers...');
    const samples = await Customer.find(eligibleQuery)
      .limit(3)
      .select('phone firstName lastName points lastCheckin marketingConsent')
      .lean();

    samples.forEach((c, i) => {
      console.log(`\n   Customer ${i + 1}:`);
      console.log(`      Phone: ${c.phone}`);
      console.log(`      Name: ${c.firstName || 'N/A'} ${c.lastName || ''}`);
      console.log(`      Points: ${c.points || 0}`);
      console.log(`      Last check-in: ${c.lastCheckin || 'Never'}`);
      console.log(`      Marketing consent: ${c.marketingConsent ? 'Yes ✅' : 'No ❌'}`);
    });

    console.log('\n' + '='.repeat(60));
    console.log('✅ ALL TESTS PASSED! Campaign system is ready.\n');

    await mongoose.connection.close();

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Usage
if (require.main === module) {
  const businessId = process.argv[2];
  
  if (!businessId) {
    console.error('Usage: node testCampaignSetup.js <businessId>');
    process.exit(1);
  }

  testCampaignSetup(businessId)
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = testCampaignSetup;