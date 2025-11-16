// controllers/winBackController.js - FIXED VERSION
const WinBackAutomation = require('../models/WinBackAutomation');
const Customer = require('../models/Customer');
const Business = require('../models/Business');
const TwilioNumber = require('../models/TwilioNumber');
const Campaign = require('../models/Campaign');
const CampaignDelivery = require('../models/CampaignDelivery');
const twilio = require('twilio');

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const INVALID_ERROR_CODES = [
  '30003', '30005', '30006', '21610', '21614', '21211',
  '30004', '30007', '21408', '21612', '63018'
];

async function markCustomerInvalid(customerId, errorCode, errorMessage) {
  try {
    await Customer.findByIdAndUpdate(customerId, {
      isInvalid: true,
      subscriberStatus: 'invalid',
      invalidReason: `Twilio error ${errorCode}: ${errorMessage}`,
      invalidatedAt: new Date(),
      marketingConsent: false
    });
    console.log(`⚠️ Customer ${customerId} marked as INVALID (error ${errorCode})`);
  } catch (error) {
    console.error(`❌ Failed to mark customer as invalid:`, error);
  }
}

/**
 * ✅ FIXED: Proper access control with better logging
 */
function checkBusinessAccess(req, businessId) {
  const { role, businessId: userBusinessId, id: userId } = req.user;
  
  console.log('🔐 Access Check:', {
    role,
    userBusinessId,
    userId,
    requestedBusinessId: businessId
  });

  // Master role can access any business
  if (role === 'master') {
    console.log('✅ Master access granted');
    return true;
  }

  // Admin role can only access their own business
  if (role === 'admin') {
    // Convert to strings for comparison (handles ObjectId vs String)
    const userBizId = userBusinessId?.toString();
    const reqBizId = businessId.toString();
    
    if (userBizId === reqBizId) {
      console.log('✅ Admin access granted (own business)');
      return true;
    }
    
    console.log('❌ Admin access denied (different business)');
    return false;
  }

  console.log('❌ Access denied (invalid role)');
  return false;
}

/**
 * Get win-back settings for a business
 */
exports.getWinBackSettings = async (req, res) => {
  try {
    const { businessId } = req.params;

    // Check access
    if (!checkBusinessAccess(req, businessId)) {
      return res.status(403).json({
        ok: false,
        error: 'Access denied - you can only manage your own business'
      });
    }

    let settings = await WinBackAutomation.findOne({ businessId });

    if (!settings) {
      const business = await Business.findById(businessId);
      if (!business) {
        return res.status(404).json({
          ok: false,
          error: 'Business not found'
        });
      }

      // Create default settings
      settings = await WinBackAutomation.create({
        businessId,
        enabled: false,
        daysInactive: 30,
        message: `Hey {firstName}! We miss you at ${business.name}! Come visit us soon and earn rewards on your next check-in. Reply STOP to opt out.`,
        frequency: 'once',
        sendTime: '10:00',
        timezone: business.timezone || 'America/New_York'
      });
    }

    res.json({
      ok: true,
      settings
    });

  } catch (error) {
    console.error('❌ Get Win-Back Settings Error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch settings',
      message: error.message
    });
  }
};

/**
 * Update win-back settings
 */
exports.updateWinBackSettings = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { enabled, daysInactive, message, frequency, sendTime, timezone } = req.body;
    
    // Check access
    if (!checkBusinessAccess(req, businessId)) {
      return res.status(403).json({
        ok: false,
        error: 'Access denied - you can only manage your own business'
      });
    }

    // Validation
    if (daysInactive !== undefined && (daysInactive < 7 || daysInactive > 365)) {
      return res.status(400).json({
        ok: false,
        error: 'Days inactive must be between 7 and 365'
      });
    }

    if (message && message.length > 1600) {
      return res.status(400).json({
        ok: false,
        error: 'Message exceeds 1600 character limit'
      });
    }

    if (message && message.length < 10) {
      return res.status(400).json({
        ok: false,
        error: 'Message must be at least 10 characters'
      });
    }

    // Build updates object
    const updates = {};
    if (enabled !== undefined) updates.enabled = enabled;
    if (daysInactive !== undefined) updates.daysInactive = daysInactive;
    if (message !== undefined) updates.message = message;
    if (frequency !== undefined) updates.frequency = frequency;
    if (sendTime !== undefined) updates.sendTime = sendTime;
    if (timezone !== undefined) updates.timezone = timezone;

    const settings = await WinBackAutomation.findOneAndUpdate(
      { businessId },
      { $set: updates },
      { new: true, upsert: true }
    );

    res.json({
      ok: true,
      settings
    });

  } catch (error) {
    console.error('❌ Update Win-Back Settings Error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to update settings',
      message: error.message
    });
  }
};

/**
 * Get inactive customers for win-back
 */
async function getInactiveCustomers(businessId, daysInactive) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysInactive);

  const customers = await Customer.find({
    businessId,
    subscriberStatus: 'active',
    marketingConsent: true,
    isInvalid: { $ne: true },
    deleted: { $ne: true },
    phone: { $exists: true, $ne: null, $ne: '' },
    $or: [
      { lastCheckinAt: { $lt: cutoffDate } },
      { lastCheckinAt: { $exists: false } },
      { lastCheckinAt: null }
    ]
  }).lean();

  console.log(`🔍 Win-back eligible customers: ${customers.length}
    - Status: active
    - Marketing consent: yes
    - Not invalid or deleted
    - Inactive for ${daysInactive}+ days
  `);

  return customers;
}

/**
 * Preview win-back audience
 */
exports.previewWinBackAudience = async (req, res) => {
  try {
    const { businessId } = req.params;

    // Check access
    if (!checkBusinessAccess(req, businessId)) {
      return res.status(403).json({
        ok: false,
        error: 'Access denied'
      });
    }

    const settings = await WinBackAutomation.findOne({ businessId });
    if (!settings) {
      return res.status(404).json({
        ok: false,
        error: 'Win-back settings not found. Please configure settings first.'
      });
    }

    const customers = await getInactiveCustomers(businessId, settings.daysInactive);

    // Format customer data for preview
    const previewCustomers = customers.slice(0, 10).map(c => ({
      firstName: c.metadata?.name?.split(' ')[0] || 'Customer',
      lastName: c.metadata?.name?.split(' ').slice(1).join(' ') || '',
      phone: c.phone,
      lastCheckin: c.lastCheckinAt,
      totalCheckins: c.totalCheckins || 0
    }));

    res.json({
      ok: true,
      count: customers.length,
      customers: previewCustomers,
      message: settings.message
    });

  } catch (error) {
    console.error('❌ Preview Win-Back Audience Error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to preview audience',
      message: error.message
    });
  }
};

/**
 * ✅ FIXED: Trigger win-back campaign
 */
// ============================================
// FIX 1: Update triggerWinBack() - Around line 290
// ============================================

exports.triggerWinBack = async (req, res) => {
  try {
    const { businessId } = req.params;

    console.log('📤 Win-back trigger request:', {
      businessId,
      user: req.user
    });

    // Check access
    if (!checkBusinessAccess(req, businessId)) {
      return res.status(403).json({
        ok: false,
        error: 'Access denied - you can only trigger campaigns for your own business'
      });
    }

    // Get settings
    const settings = await WinBackAutomation.findOne({ businessId });
    if (!settings) {
      return res.status(400).json({
        ok: false,
        error: 'Win-back settings not found. Please configure settings first.'
      });
    }

    if (!settings.enabled) {
      return res.status(400).json({
        ok: false,
        error: 'Win-back automation is not enabled. Please enable it in settings.'
      });
    }

    if (!settings.message || settings.message.length < 10) {
      return res.status(400).json({
        ok: false,
        error: 'Please set a valid message before sending (minimum 10 characters)'
      });
    }

    // 🔍 DEBUG: Check Twilio numbers
    console.log('🔍 DEBUG: Looking for Twilio number with businessId:', businessId);
    console.log('🔍 DEBUG: businessId type:', typeof businessId);

    const allNumbers = await TwilioNumber.find({}).lean();
    console.log('🔍 DEBUG: All Twilio numbers in DB:', JSON.stringify(allNumbers, null, 2));

    const activeNumbers = await TwilioNumber.find({ isActive: true }).lean();
    console.log('🔍 DEBUG: Active Twilio numbers:', JSON.stringify(activeNumbers, null, 2));

    // ✅ FIXED: Use assignedBusinesses instead of businessId
    const twilioNumber = await TwilioNumber.findOne({
      assignedBusinesses: businessId.toString(), // Convert to string for matching
      isActive: true
    });

    console.log('🔍 DEBUG: Found Twilio number:', twilioNumber);

    if (!twilioNumber) {
      return res.status(400).json({
        ok: false,
        error: 'No active Twilio number assigned to this business. Please contact support.'
      });
    }

    // Check for eligible customers
    const eligibleCount = await Customer.countDocuments({
      businessId,
      subscriberStatus: 'active',
      marketingConsent: true,
      isInvalid: { $ne: true },
      deleted: { $ne: true },
      phone: { $exists: true, $ne: null, $ne: '' }
    });

    if (eligibleCount === 0) {
      return res.status(400).json({
        ok: false,
        error: 'No eligible customers found. Make sure customers have marketing consent and are active.'
      });
    }

    console.log('✅ All checks passed, starting win-back campaign');

    // Start processing in background
    processWinBack(businessId).catch(err => {
      console.error('❌ Win-back processing error:', err);
    });

    res.json({
      ok: true,
      message: 'Win-back campaign started successfully',
      eligibleCustomers: eligibleCount
    });

  } catch (error) {
    console.error('❌ Trigger Win-Back Error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to trigger win-back',
      message: error.message
    });
  }
};

// ============================================
// FIX 2: Update processWinBack() - Around line 420
// ============================================

async function processWinBack(businessId) {
  try {
    console.log('🔄 Processing win-back for business:', businessId);

    const settings = await WinBackAutomation.findOne({ businessId });
    if (!settings || !settings.enabled) {
      console.log('⚠️ Win-back not enabled, aborting');
      return;
    }

    // ✅ FIXED: Use assignedBusinesses instead of businessId
    const twilioNumber = await TwilioNumber.findOne({
      assignedBusinesses: businessId.toString(), // Convert to string for matching
      isActive: true
    });

    if (!twilioNumber) {
      throw new Error('No active Twilio number found');
    }

    console.log('📞 Using Twilio number:', twilioNumber.number);

    const customers = await getInactiveCustomers(businessId, settings.daysInactive);
    
    console.log(`📊 Found ${customers.length} inactive customers`);

    if (customers.length === 0) {
      console.log('⚠️ No eligible customers for win-back');
      return;
    }

    // Rest of the function remains the same...
    const campaign = await Campaign.create({
      businessId,
      createdBy: 'system',
      name: `Win-Back Automation - ${new Date().toLocaleDateString()}`,
      type: 'win-back',
      message: settings.message,
      audienceFilter: 'custom',
      status: 'sending',
      startedAt: new Date(),
      stats: {
        totalRecipients: customers.length,
        pending: customers.length
      }
    });

    let sent = 0;
    let delivered = 0;
    let failed = 0;
    let invalid = 0;

    for (const customer of customers) {
      try {
        const customerName = customer.metadata?.name || '';
        const nameParts = customerName.split(' ');
        const firstName = nameParts[0] || 'Customer';
        const lastName = nameParts.slice(1).join(' ') || '';

        const personalizedMessage = settings.message
          .replace(/\{firstName\}/g, firstName)
          .replace(/\{lastName\}/g, lastName)
          .replace(/\{name\}/g, customerName || 'Customer');

        // ⚠️ IMPORTANT: Make sure twilioNumber.number exists (not phoneNumber)
        const twilioMessage = await twilioClient.messages.create({
          to: customer.phone,
          from: twilioNumber.number, // Changed from phoneNumber to number
          body: personalizedMessage
        });

        await CampaignDelivery.create({
          campaignId: campaign._id,
          businessId,
          customerId: customer._id,
          phone: customer.phone,
          message: personalizedMessage,
          messageSid: twilioMessage.sid,
          status: 'sent',
          sentAt: new Date()
        });

        sent++;
        console.log(`✅ Sent win-back to ${customer.phone}`);
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`❌ Failed to send to ${customer.phone}:`, error);
        
        const errorCode = error.code?.toString();
        const isInvalid = INVALID_ERROR_CODES.includes(errorCode);

        await CampaignDelivery.create({
          campaignId: campaign._id,
          businessId,
          customerId: customer._id,
          phone: customer.phone,
          message: settings.message,
          status: isInvalid ? 'invalid' : 'failed',
          errorCode: errorCode,
          errorMessage: error.message,
          failedAt: new Date()
        });

        if (isInvalid) {
          await markCustomerInvalid(customer._id, errorCode, error.message);
          invalid++;
        } else {
          failed++;
        }
      }
    }

    campaign.status = 'completed';
    campaign.completedAt = new Date();
    campaign.stats.sent = sent;
    campaign.stats.failed = failed;
    campaign.stats.invalid = invalid;
    campaign.stats.pending = 0;
    await campaign.save();

    settings.lastRunAt = new Date();
    settings.stats.totalSent += sent;
    settings.stats.totalFailed += (failed + invalid);
    await settings.save();

    console.log(`✅ Win-back completed: Sent: ${sent}, Failed: ${failed}, Invalid: ${invalid}`);

  } catch (error) {
    console.error('❌ Win-back processing failed:', error);
  }
}
/**
 * Process win-back campaign (background job)
 */
/**
 * Process win-back campaign (background job)
 */
async function processWinBack(businessId) {
  try {
    console.log('🔄 Processing win-back for business:', businessId);

    const settings = await WinBackAutomation.findOne({ businessId });
    if (!settings || !settings.enabled) {
      console.log('⚠️ Win-back not enabled, aborting');
      return;
    }

    // ✅ FIXED: Use assignedBusinesses instead of businessId
    const twilioNumber = await TwilioNumber.findOne({
      assignedBusinesses: businessId.toString(),
      isActive: true
    });

    console.log('📞 Found Twilio number in processWinBack:', twilioNumber?.number);

    if (!twilioNumber) {
      throw new Error('No active Twilio number found');
    }

    const customers = await getInactiveCustomers(businessId, settings.daysInactive);
    
    console.log(`📊 Found ${customers.length} inactive customers`);

    if (customers.length === 0) {
      console.log('⚠️ No eligible customers for win-back');
      return;
    }

    const campaign = await Campaign.create({
      businessId,
      createdBy: 'system',
      name: `Win-Back Automation - ${new Date().toLocaleDateString()}`,
      type: 'win-back',
      message: settings.message,
      audienceFilter: 'custom',
      status: 'sending',
      startedAt: new Date(),
      stats: {
        totalRecipients: customers.length,
        pending: customers.length
      }
    });

    let sent = 0;
    let delivered = 0;
    let failed = 0;
    let invalid = 0;

    for (const customer of customers) {
      try {
        // Get customer name parts
        const customerName = customer.metadata?.name || '';
        const nameParts = customerName.split(' ');
        const firstName = nameParts[0] || 'Customer';
        const lastName = nameParts.slice(1).join(' ') || '';

        // Personalize message
        const personalizedMessage = settings.message
          .replace(/\{firstName\}/g, firstName)
          .replace(/\{lastName\}/g, lastName)
          .replace(/\{name\}/g, customerName || 'Customer');

        // Send via Twilio - use twilioNumber.number (not phoneNumber)
        const twilioMessage = await twilioClient.messages.create({
          to: customer.phone,
          from: twilioNumber.number,
          body: personalizedMessage
        });

        // Record delivery
        await CampaignDelivery.create({
          campaignId: campaign._id,
          businessId,
          customerId: customer._id,
          phone: customer.phone,
          message: personalizedMessage,
          messageSid: twilioMessage.sid,
          status: 'sent',
          sentAt: new Date()
        });

        sent++;
        console.log(`✅ Sent win-back to ${customer.phone}`);

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`❌ Failed to send to ${customer.phone}:`, error);
        
        const errorCode = error.code?.toString();
        const isInvalid = INVALID_ERROR_CODES.includes(errorCode);

        await CampaignDelivery.create({
          campaignId: campaign._id,
          businessId,
          customerId: customer._id,
          phone: customer.phone,
          message: settings.message,
          status: isInvalid ? 'invalid' : 'failed',
          errorCode: errorCode,
          errorMessage: error.message,
          failedAt: new Date()
        });

        if (isInvalid) {
          await markCustomerInvalid(customer._id, errorCode, error.message);
          invalid++;
        } else {
          failed++;
        }
      }
    }

    // Update campaign
    campaign.status = 'completed';
    campaign.completedAt = new Date();
    campaign.stats.sent = sent;
    campaign.stats.failed = failed;
    campaign.stats.invalid = invalid;
    campaign.stats.pending = 0;
    await campaign.save();

    // Update settings stats
    settings.lastRunAt = new Date();
    settings.stats.totalSent += sent;
    settings.stats.totalFailed += (failed + invalid);
    await settings.save();

    console.log(`✅ Win-back completed:
      - Sent: ${sent}
      - Failed: ${failed}
      - Invalid: ${invalid}
      - Total: ${sent + failed + invalid}
    `);

  } catch (error) {
    console.error('❌ Win-back processing failed:', error);
  }
}



// Add this debug code to getInactiveCustomers() function
// Replace the entire function with this:

async function getInactiveCustomers(businessId, daysInactive) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysInactive);

  console.log('🔍 DEBUG: Searching for inactive customers with criteria:');
  console.log('  - Business ID:', businessId);
  console.log('  - Days inactive:', daysInactive);
  console.log('  - Cutoff date:', cutoffDate);

  // Check total customers for this business
  const totalCustomers = await Customer.countDocuments({ businessId });
  console.log('📊 Total customers for business:', totalCustomers);

  // Check each criterion separately
  const withPhone = await Customer.countDocuments({
    businessId,
    phone: { $exists: true, $ne: null, $ne: '' }
  });
  console.log('📊 Customers with phone:', withPhone);

  const activeStatus = await Customer.countDocuments({
    businessId,
    subscriberStatus: 'active'
  });
  console.log('📊 Customers with active status:', activeStatus);

  const withConsent = await Customer.countDocuments({
    businessId,
    marketingConsent: true
  });
  console.log('📊 Customers with marketing consent:', withConsent);

  const notInvalid = await Customer.countDocuments({
    businessId,
    isInvalid: { $ne: true }
  });
  console.log('📊 Customers not invalid:', notInvalid);

  const notDeleted = await Customer.countDocuments({
    businessId,
    deleted: { $ne: true }
  });
  console.log('📊 Customers not deleted:', notDeleted);

  const inactive = await Customer.countDocuments({
    businessId,
    $or: [
      { lastCheckinAt: { $lt: cutoffDate } },
      { lastCheckinAt: { $exists: false } },
      { lastCheckinAt: null }
    ]
  });
  console.log('📊 Customers inactive for ' + daysInactive + '+ days:', inactive);

  // Now check combined criteria step by step
  const step1 = await Customer.countDocuments({
    businessId,
    subscriberStatus: 'active',
    marketingConsent: true
  });
  console.log('📊 Active + Marketing Consent:', step1);

  const step2 = await Customer.countDocuments({
    businessId,
    subscriberStatus: 'active',
    marketingConsent: true,
    isInvalid: { $ne: true },
    deleted: { $ne: true }
  });
  console.log('📊 + Not Invalid/Deleted:', step2);

  const step3 = await Customer.countDocuments({
    businessId,
    subscriberStatus: 'active',
    marketingConsent: true,
    isInvalid: { $ne: true },
    deleted: { $ne: true },
    phone: { $exists: true, $ne: null, $ne: '' }
  });
  console.log('📊 + Has Phone:', step3);

  // Final query
  const customers = await Customer.find({
    businessId,
    subscriberStatus: 'active',
    marketingConsent: true,
    isInvalid: { $ne: true },
    deleted: { $ne: true },
    phone: { $exists: true, $ne: null, $ne: '' },
    $or: [
      { lastCheckinAt: { $lt: cutoffDate } },
      { lastCheckinAt: { $exists: false } },
      { lastCheckinAt: null }
    ]
  }).lean();

  console.log(`🔍 Win-back eligible customers: ${customers.length}
    - Status: active
    - Marketing consent: yes
    - Not invalid or deleted
    - Inactive for ${daysInactive}+ days
  `);

  // Show sample customer data if any exist
  if (customers.length > 0) {
    console.log('📋 Sample customer:', {
      phone: customers[0].phone,
      subscriberStatus: customers[0].subscriberStatus,
      marketingConsent: customers[0].marketingConsent,
      lastCheckinAt: customers[0].lastCheckinAt,
      isInvalid: customers[0].isInvalid,
      deleted: customers[0].deleted
    });
  } else {
    // Show a sample customer to see what's wrong
    const anySample = await Customer.findOne({ businessId }).lean();
    if (anySample) {
      console.log('📋 Sample customer from business (not eligible):', {
        phone: anySample.phone,
        subscriberStatus: anySample.subscriberStatus,
        marketingConsent: anySample.marketingConsent,
        lastCheckinAt: anySample.lastCheckinAt,
        isInvalid: anySample.isInvalid,
        deleted: anySample.deleted
      });
    }
  }

  return customers;
}
/**
 * Get win-back statistics
 */
exports.getWinBackStats = async (req, res) => {
  try {
    const { businessId } = req.params;

    // Check access
    if (!checkBusinessAccess(req, businessId)) {
      return res.status(403).json({
        ok: false,
        error: 'Access denied'
      });
    }

    const settings = await WinBackAutomation.findOne({ businessId });
    
    const eligibleCount = settings 
      ? (await getInactiveCustomers(businessId, settings.daysInactive)).length
      : 0;

    const recentCampaigns = await Campaign.find({
      businessId,
      type: 'win-back'
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    res.json({
      ok: true,
      stats: settings?.stats || { totalSent: 0, totalDelivered: 0, totalFailed: 0 },
      eligibleCustomers: eligibleCount,
      lastRunAt: settings?.lastRunAt,
      recentCampaigns
    });

  } catch (error) {
    console.error('❌ Get Win-Back Stats Error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch stats',
      message: error.message
    });
  }
};

module.exports = exports;