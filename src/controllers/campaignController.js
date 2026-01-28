// ================================================================
// controllers/campaignController.js - WITH SCHEDULING SUPPORT
// ================================================================
const Campaign = require('../models/Campaign');
const CampaignDelivery = require('../models/CampaignDelivery');
const WinBackAutomation = require('../models/WinBackAutomation');
const Customer = require('../models/Customer');
const Business = require('../models/Business');
const TwilioNumber = require('../models/TwilioNumber');
const Reward = require('../models/Reward');
const twilio = require('twilio');
const cron = require('node-cron'); // ✅ NEW: For scheduling

// ✅ Configuration
const USE_TESTING_TIMEFRAME = false;
const TESTING_MINUTES = 2;
const PRODUCTION_DAYS = 30;

// ✅ Comprehensive list of Twilio error codes that mark subscriber as invalid
const INVALID_ERROR_CODES = [
  '30003', '30005', '30006', '21610', '21614', '21211',
  '30004', '30007', '21408', '21612', '63018'
];

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ✅ NEW: Store active scheduled jobs
const scheduledJobs = new Map();

/**
 * ✅ NEW: Initialize scheduler - checks every minute for campaigns to send
 */
function initializeCampaignScheduler() {
  console.log('🕐 Initializing campaign scheduler...');
  
  // Run every minute
  cron.schedule('* * * * *', async () => {
    try {
      await checkScheduledCampaigns();
    } catch (error) {
      console.error('❌ Scheduler error:', error);
    }
  });
  
  console.log('✅ Campaign scheduler initialized');
}

/**
 * ✅ NEW: Check for campaigns that need to be sent
 */
async function checkScheduledCampaigns() {
  try {
    const now = new Date();
    
    // Find scheduled campaigns that are due
    const dueCampaigns = await Campaign.find({
      status: 'scheduled',
      scheduledFor: { $lte: now }
    }).populate('businessId');

    if (dueCampaigns.length === 0) {
      return;
    }

    console.log(`\n🕐 === SCHEDULED CAMPAIGNS CHECK ===`);
    console.log(`   Time: ${now.toISOString()}`);
    console.log(`   Found ${dueCampaigns.length} campaign(s) ready to send`);

    for (const campaign of dueCampaigns) {
      console.log(`\n📤 Processing scheduled campaign: ${campaign.name}`);
      console.log(`   Scheduled for: ${campaign.scheduledFor.toISOString()}`);
      console.log(`   Business: ${campaign.businessId.name}`);

      try {
        // Update status to sending
        campaign.status = 'sending';
        campaign.startedAt = new Date();
        await campaign.save();

        // Get eligible customers
        const eligibleCustomers = await getAudienceCustomers(campaign);
        
        if (eligibleCustomers.length === 0) {
          console.log(`   ⚠️ No eligible recipients found`);
          campaign.status = 'completed';
          campaign.completedAt = new Date();
          campaign.stats.totalRecipients = 0;
          campaign.stats.pending = 0;
          await campaign.save();
          continue;
        }

        // Update campaign stats
        campaign.stats.totalRecipients = eligibleCustomers.length;
        campaign.stats.pending = eligibleCustomers.length;
        await campaign.save();

        console.log(`   ✅ Sending to ${eligibleCustomers.length} recipients`);

        // Process campaign asynchronously
        processCampaign(campaign._id).catch(err => {
          console.error(`   ❌ Processing error:`, err);
        });

      } catch (error) {
        console.error(`   ❌ Failed to send scheduled campaign:`, error);
        campaign.status = 'failed';
        campaign.completedAt = new Date();
        await campaign.save();
      }
    }

    console.log(`=================================\n`);

  } catch (error) {
    console.error('❌ Error checking scheduled campaigns:', error);
  }
}

/**
 * ✅ FIXED: Mark customer as invalid
 */
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
 * ✅ PRODUCTION READY: Get audience customers with configurable timeframe
 */
async function getAudienceCustomers(campaign) {
  console.log('\n🔍 === AUDIENCE FILTER DEBUG ===');
  console.log(`Filter Type: ${campaign.audienceFilter}`);
  console.log(`Business ID: ${campaign.businessId._id}`);
  console.log(`Mode: ${USE_TESTING_TIMEFRAME ? 'TESTING' : 'PRODUCTION'}`);

  // ✅ Base query using ACTUAL Customer model fields
  let query = {
    businessId: campaign.businessId._id,
    subscriberStatus: 'active',
    marketingConsent: true,
    deleted: { $ne: true },
    isInvalid: { $ne: true },
    phone: { $exists: true, $ne: null, $ne: '' }
  };

  console.log('📋 Base Query:', JSON.stringify(query, null, 2));

  // Count total customers before filtering
  const totalCustomers = await Customer.countDocuments({ 
    businessId: campaign.businessId._id,
    deleted: { $ne: true }
  });
  console.log(`📊 Total customers in business: ${totalCustomers}`);

  const activeWithConsent = await Customer.countDocuments({
    businessId: campaign.businessId._id,
    subscriberStatus: 'active',
    marketingConsent: true,
    deleted: { $ne: true }
  });
  console.log(`✅ Active with marketing consent: ${activeWithConsent}`);

  // Apply audience filter
  switch (campaign.audienceFilter) {
    case 'last_30_days':
      if (USE_TESTING_TIMEFRAME) {
        const testTimeAgo = new Date();
        testTimeAgo.setMinutes(testTimeAgo.getMinutes() - TESTING_MINUTES);
        query.lastCheckinAt = { $gte: testTimeAgo };
        console.log(`⏰ Filter: Active in last ${TESTING_MINUTES} minutes (TESTING MODE)`);
        console.log(`   Cutoff time: ${testTimeAgo.toISOString()}`);
      } else {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - PRODUCTION_DAYS);
        query.lastCheckinAt = { $gte: thirtyDaysAgo };
        console.log(`⏰ Filter: Active in last ${PRODUCTION_DAYS} days (PRODUCTION MODE)`);
        console.log(`   Cutoff time: ${thirtyDaysAgo.toISOString()}`);
      }
      
      const withCheckin = await Customer.countDocuments({
        businessId: campaign.businessId._id,
        lastCheckinAt: { $exists: true, $ne: null }
      });
      console.log(`   Customers with lastCheckinAt: ${withCheckin}`);
      break;

    case 'reward_earners':
      query.totalCheckins = { $gt: 0 };
      console.log(`🎁 Filter: Reward earners (totalCheckins > 0)`);
      
      const withCheckins = await Customer.countDocuments({
        businessId: campaign.businessId._id,
        totalCheckins: { $gt: 0 }
      });
      console.log(`   Customers with checkins > 0: ${withCheckins}`);
      
      const sampleWithCheckins = await Customer.find({
        businessId: campaign.businessId._id,
        totalCheckins: { $gt: 0 }
      }).limit(5).select('phone totalCheckins lastCheckinAt metadata').lean();
      console.log(`   Sample customers:`, sampleWithCheckins);
      break;

    case 'custom':
      console.log(`🎯 Filter: Custom criteria`);
      if (campaign.customCriteria.tags && campaign.customCriteria.tags.length) {
        query.tags = { $in: campaign.customCriteria.tags };
        console.log(`   Tags: ${campaign.customCriteria.tags.join(', ')}`);
      }
      if (campaign.customCriteria.minPoints !== undefined) {
        query.totalCheckins = { $gte: campaign.customCriteria.minPoints };
        console.log(`   Min checkins: ${campaign.customCriteria.minPoints}`);
      }
      if (campaign.customCriteria.maxPoints !== undefined) {
        query.totalCheckins = { ...query.totalCheckins, $lte: campaign.customCriteria.maxPoints };
        console.log(`   Max checkins: ${campaign.customCriteria.maxPoints}`);
      }
      if (campaign.customCriteria.lastCheckinDays !== undefined) {
        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - campaign.customCriteria.lastCheckinDays);
        query.lastCheckinAt = { $gte: daysAgo };
        console.log(`   Last checkin within: ${campaign.customCriteria.lastCheckinDays} days`);
      }
      break;

    case 'all':
    default:
      console.log(`📢 Filter: All active customers with marketing consent`);
      break;
  }

  console.log('\n🔎 Final Query:', JSON.stringify(query, null, 2));

  const customers = await Customer.find(query).lean();
  
  console.log(`\n📊 === FILTER RESULTS ===`);
  console.log(`   Matching customers: ${customers.length}`);
  
  if (customers.length > 0) {
    console.log(`\n📋 Sample customers (first 3):`);
    customers.slice(0, 3).forEach((c, i) => {
      console.log(`   ${i + 1}. ${c.metadata?.name || 'No name'}`);
      console.log(`      Phone: ${c.phone}`);
      console.log(`      Total Checkins: ${c.totalCheckins || 0}`);
      console.log(`      Last Checkin: ${c.lastCheckinAt || 'Never'}`);
      console.log(`      Marketing Consent: ${c.marketingConsent}`);
      console.log(`      Status: ${c.subscriberStatus}`);
    });
  } else {
    console.log(`\n⚠️ No customers found! Checking why...`);
    
    const noPhone = await Customer.countDocuments({
      businessId: campaign.businessId._id,
      deleted: { $ne: true },
      $or: [
        { phone: { $exists: false } },
        { phone: null },
        { phone: '' }
      ]
    });
    const blocked = await Customer.countDocuments({
      businessId: campaign.businessId._id,
      deleted: { $ne: true },
      subscriberStatus: 'blocked'
    });
    const invalid = await Customer.countDocuments({
      businessId: campaign.businessId._id,
      deleted: { $ne: true },
      isInvalid: true
    });
    const noConsent = await Customer.countDocuments({
      businessId: campaign.businessId._id,
      deleted: { $ne: true },
      marketingConsent: { $ne: true }
    });
    const notActive = await Customer.countDocuments({
      businessId: campaign.businessId._id,
      deleted: { $ne: true },
      subscriberStatus: { $ne: 'active' }
    });
    const deletedCount = await Customer.countDocuments({
      businessId: campaign.businessId._id,
      deleted: true
    });
    
    console.log(`   Reasons customers are excluded:`);
    console.log(`      No phone: ${noPhone}`);
    console.log(`      Blocked status: ${blocked}`);
    console.log(`      Invalid: ${invalid}`);
    console.log(`      No marketing consent: ${noConsent}`);
    console.log(`      Not active status: ${notActive}`);
    console.log(`      Deleted: ${deletedCount}`);
    
    const sampleCustomer = await Customer.findOne({
      businessId: campaign.businessId._id,
      deleted: { $ne: true }
    }).lean();
    
    if (sampleCustomer) {
      console.log(`\n📄 Sample customer data:`);
      console.log(JSON.stringify({
        phone: sampleCustomer.phone,
        subscriberStatus: sampleCustomer.subscriberStatus,
        marketingConsent: sampleCustomer.marketingConsent,
        totalCheckins: sampleCustomer.totalCheckins,
        lastCheckinAt: sampleCustomer.lastCheckinAt,
        isInvalid: sampleCustomer.isInvalid,
        deleted: sampleCustomer.deleted
      }, null, 2));
    }
  }

  console.log(`=========================\n`);

  return customers;
}

/**
 * ✅ FIXED: Get customer's available rewards
 */
async function getCustomerRewards(customerId, businessId) {
  try {
    console.log(`🔍 Looking for rewards for customer: ${customerId}`);
    
    let rewards = await Reward.find({
      customerId: customerId,
      businessId: businessId,
      redeemed: false,
      isActive: true,
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: new Date() } }
      ]
    }).sort({ createdAt: -1 }).lean();

    if (rewards.length > 0) {
      console.log(`   ✅ Found ${rewards.length} reward(s) by customerId`);
      return rewards[0];
    }

    const customer = await Customer.findById(customerId).select('phone').lean();
    if (customer && customer.phone) {
      rewards = await Reward.find({
        phone: customer.phone,
        businessId: businessId,
        redeemed: false,
        isActive: true,
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: { $gt: new Date() } }
        ]
      }).sort({ createdAt: -1 }).lean();

      if (rewards.length > 0) {
        console.log(`   ✅ Found ${rewards.length} reward(s) by phone`);
        return rewards[0];
      }
    }

    console.log(`   ℹ️ No rewards found for customer ${customerId}`);
    return null;
  } catch (error) {
    console.error('❌ Error fetching customer rewards:', error);
    return null;
  }
}

/**
 * ✅ IMPROVED: CREATE CAMPAIGN with scheduling support
 */
exports.createCampaign = async (req, res) => {
  try {
    const {
      name,
      type,
      message,
      mediaUrl,
      audienceFilter,
      customCriteria,
      scheduledFor,
      timezone,
      winBackSettings
    } = req.body;

    const userRole = req.user.role;
    const userBusinessId = req.user.businessId;

    let businessId = req.body.businessId;
    
    if (userRole === 'admin' && !businessId) {
      businessId = userBusinessId;
    }

    if (!businessId) {
      return res.status(400).json({
        ok: false,
        error: 'Business ID is required'
      });
    }

    if (userRole === 'admin' && businessId !== userBusinessId) {
      return res.status(403).json({
        ok: false,
        error: 'Access denied - cannot create campaigns for other businesses'
      });
    }

    const business = await Business.findById(businessId);
    if (!business) {
      return res.status(404).json({
        ok: false,
        error: 'Business not found'
      });
    }

    if (!name || !message) {
      return res.status(400).json({
        ok: false,
        error: 'Name and message are required'
      });
    }

    if (message.length > 1600) {
      return res.status(400).json({
        ok: false,
        error: 'Message exceeds 1600 character limit'
      });
    }

    // ✅ NEW: Validate scheduled date
    let scheduleDate = null;
    let campaignStatus = 'draft';

    if (scheduledFor) {
      scheduleDate = new Date(scheduledFor);
      const now = new Date();

      // ✅ Check if scheduled time is in the past
      if (scheduleDate <= now) {
        return res.status(400).json({
          ok: false,
          error: 'Scheduled time must be in the future',
          scheduledFor: scheduleDate.toISOString(),
          currentTime: now.toISOString()
        });
      }

      // ✅ Check if scheduled time is too far in the future (optional - 90 days max)
      const maxScheduleDays = 90;
      const maxScheduleDate = new Date(now.getTime() + (maxScheduleDays * 24 * 60 * 60 * 1000));
      if (scheduleDate > maxScheduleDate) {
        return res.status(400).json({
          ok: false,
          error: `Cannot schedule more than ${maxScheduleDays} days in advance`,
          scheduledFor: scheduleDate.toISOString(),
          maxDate: maxScheduleDate.toISOString()
        });
      }

      campaignStatus = 'scheduled';
      console.log(`📅 Campaign scheduled for: ${scheduleDate.toISOString()}`);
      console.log(`   Time until send: ${Math.round((scheduleDate - now) / 60000)} minutes`);
    }

    const campaign = await Campaign.create({
      businessId,
      createdBy: req.user.id,
      name,
      type: type || 'sms',
      message,
      mediaUrl: type === 'mms' ? mediaUrl : null,
      audienceFilter: audienceFilter || 'all',
      customCriteria: customCriteria || {},
      scheduledFor: scheduleDate,
      timezone: timezone || business.timezone || 'America/New_York',
      status: campaignStatus,
      winBackSettings: type === 'win-back' ? winBackSettings : undefined
    });

    console.log('✅ Campaign created:', campaign._id);
    console.log(`   Business: ${business.name}`);
    console.log(`   Filter: ${audienceFilter}`);
    console.log(`   Status: ${campaignStatus}`);
    if (scheduleDate) {
      console.log(`   Scheduled for: ${scheduleDate.toISOString()}`);
    }

    res.json({
      ok: true,
      campaign,
      message: scheduleDate 
        ? `Campaign scheduled for ${scheduleDate.toLocaleString()}`
        : 'Campaign created as draft'
    });

  } catch (error) {
    console.error('❌ Create Campaign Error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to create campaign',
      message: error.message
    });
  }
};

/**
 * ✅ NEW: UPDATE SCHEDULED CAMPAIGN
 */
exports.updateScheduledCampaign = async (req, res) => {
  try {
    const { id } = req.params;
    const { scheduledFor, name, message, audienceFilter, customCriteria } = req.body;
    const userRole = req.user.role;
    const userBusinessId = req.user.businessId;

    const campaign = await Campaign.findById(id);
    if (!campaign) {
      return res.status(404).json({
        ok: false,
        error: 'Campaign not found'
      });
    }

    if (userRole === 'admin' && campaign.businessId.toString() !== userBusinessId) {
      return res.status(403).json({
        ok: false,
        error: 'Access denied'
      });
    }

    // Can only update draft or scheduled campaigns
    if (!['draft', 'scheduled'].includes(campaign.status)) {
      return res.status(400).json({
        ok: false,
        error: `Cannot update campaign with status: ${campaign.status}`
      });
    }

    // Update fields
    if (name) campaign.name = name;
    if (message) {
      if (message.length > 1600) {
        return res.status(400).json({
          ok: false,
          error: 'Message exceeds 1600 character limit'
        });
      }
      campaign.message = message;
    }
    if (audienceFilter) campaign.audienceFilter = audienceFilter;
    if (customCriteria) campaign.customCriteria = customCriteria;

    // Update schedule
    if (scheduledFor !== undefined) {
      if (scheduledFor === null) {
        // Remove schedule
        campaign.scheduledFor = null;
        campaign.status = 'draft';
      } else {
        const scheduleDate = new Date(scheduledFor);
        const now = new Date();

        if (scheduleDate <= now) {
          return res.status(400).json({
            ok: false,
            error: 'Scheduled time must be in the future'
          });
        }

        campaign.scheduledFor = scheduleDate;
        campaign.status = 'scheduled';
      }
    }

    await campaign.save();

    console.log(`✅ Campaign updated: ${campaign._id}`);
    if (campaign.scheduledFor) {
      console.log(`   New schedule: ${campaign.scheduledFor.toISOString()}`);
    }

    res.json({
      ok: true,
      campaign,
      message: 'Campaign updated successfully'
    });

  } catch (error) {
    console.error('❌ Update Campaign Error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to update campaign',
      message: error.message
    });
  }
};

/**
 * ✅ NEW: CANCEL SCHEDULED CAMPAIGN
 */
exports.cancelScheduledCampaign = async (req, res) => {
  try {
    const { id } = req.params;
    const userRole = req.user.role;
    const userBusinessId = req.user.businessId;

    const campaign = await Campaign.findById(id);
    if (!campaign) {
      return res.status(404).json({
        ok: false,
        error: 'Campaign not found'
      });
    }

    if (userRole === 'admin' && campaign.businessId.toString() !== userBusinessId) {
      return res.status(403).json({
        ok: false,
        error: 'Access denied'
      });
    }

    if (campaign.status !== 'scheduled') {
      return res.status(400).json({
        ok: false,
        error: 'Can only cancel scheduled campaigns'
      });
    }

    campaign.status = 'cancelled';
    campaign.completedAt = new Date();
    await campaign.save();

    console.log(`❌ Campaign cancelled: ${campaign._id}`);

    res.json({
      ok: true,
      message: 'Campaign cancelled successfully',
      campaign
    });

  } catch (error) {
    console.error('❌ Cancel Campaign Error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to cancel campaign',
      message: error.message
    });
  }
};

/**
 * GET ALL CAMPAIGNS
 */
exports.getCampaigns = async (req, res) => {
  try {
    const userRole = req.user.role;
    const userBusinessId = req.user.businessId;
    const { status, type, limit = 50 } = req.query;

    let query = {};

    if (userRole === 'admin') {
      query.businessId = userBusinessId;
    } else if (req.query.businessId) {
      query.businessId = req.query.businessId;
    }

    if (status) {
      query.status = status;
    }

    if (type) {
      query.type = type;
    }

    const campaigns = await Campaign.find(query)
      .populate('businessId', 'name slug')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    res.json({
      ok: true,
      campaigns
    });

  } catch (error) {
    console.error('❌ Get Campaigns Error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch campaigns',
      message: error.message
    });
  }
};

/**
 * GET CAMPAIGN DETAILS
 */
exports.getCampaignDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const userRole = req.user.role;
    const userBusinessId = req.user.businessId;

    const campaign = await Campaign.findById(id)
      .populate('businessId', 'name slug timezone')
      .lean();

    if (!campaign) {
      return res.status(404).json({
        ok: false,
        error: 'Campaign not found'
      });
    }

    if (userRole === 'admin' && campaign.businessId._id.toString() !== userBusinessId) {
      return res.status(403).json({
        ok: false,
        error: 'Access denied'
      });
    }

    const deliveries = await CampaignDelivery.find({ campaignId: id })
      .populate('customerId', 'phone metadata')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json({
      ok: true,
      campaign,
      deliveries
    });

  } catch (error) {
    console.error('❌ Get Campaign Details Error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch campaign details',
      message: error.message
    });
  }
};

/**
 * ✅ SEND CAMPAIGN - Supports immediate and scheduled sending
 */
exports.sendCampaign = async (req, res) => {
  try {
    console.log('\n🚀 === SEND CAMPAIGN REQUEST ===');
    const { id } = req.params;
    const userRole = req.user.role;
    const userBusinessId = req.user.businessId;

    const campaign = await Campaign.findById(id).populate('businessId');
    if (!campaign) {
      return res.status(404).json({
        ok: false,
        error: 'Campaign not found'
      });
    }

    console.log(`✅ Campaign: ${campaign.name}`);
    console.log(`   Business: ${campaign.businessId.name}`);
    console.log(`   Filter: ${campaign.audienceFilter}`);
    console.log(`   Status: ${campaign.status}`);

    if (userRole === 'admin' && campaign.businessId._id.toString() !== userBusinessId) {
      return res.status(403).json({
        ok: false,
        error: 'Access denied'
      });
    }

    if (['completed', 'sending', 'cancelled'].includes(campaign.status)) {
      return res.status(400).json({
        ok: false,
        error: `Campaign is already ${campaign.status}`
      });
    }

    // ✅ Check Twilio number
    console.log('\n📞 Checking Twilio number...');
    const businessIdString = campaign.businessId._id.toString();

    let twilioPhoneNumber = null;

    const twilioNumber = await TwilioNumber.findOne({
      assignedBusinesses: businessIdString,
      isActive: true
    });

    if (twilioNumber) {
      twilioPhoneNumber = twilioNumber.number;
      console.log(`✅ Found DB Twilio number: ${twilioPhoneNumber}`);
    } else {
      const businessDoc = await Business.findById(businessIdString).select('twilioNumber twilioNumberActive');
      
      if (businessDoc?.twilioNumber && businessDoc.twilioNumberActive) {
        twilioPhoneNumber = businessDoc.twilioNumber;
        console.log(`✅ Using business's assigned number: ${twilioPhoneNumber}`);
      }
    }

    if (!twilioPhoneNumber) {
      console.log('❌ No active Twilio number found!');
      return res.status(400).json({
        ok: false,
        error: 'No active Twilio number assigned to this business.'
      });
    }

    console.log(`✅ Will use Twilio number: ${twilioPhoneNumber}`);

    // ✅ Check eligible customers
    const eligibleCustomers = await getAudienceCustomers(campaign);
    
    if (eligibleCustomers.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'No eligible recipients found. Check console logs for details.'
      });
    }

    console.log(`✅ Found ${eligibleCustomers.length} eligible recipients`);

    // Update campaign
    campaign.stats.totalRecipients = eligibleCustomers.length;
    campaign.stats.pending = eligibleCustomers.length;
    campaign.status = 'sending';
    campaign.startedAt = new Date();
    await campaign.save();

    // Process asynchronously
    processCampaign(campaign._id).catch(err => {
      console.error('❌ Campaign processing error:', err);
    });

    res.json({
      ok: true,
      message: `Campaign is being sent to ${eligibleCustomers.length} recipients`,
      campaignId: campaign._id,
      recipientCount: eligibleCustomers.length
    });

  } catch (error) {
    console.error('❌ Send Campaign Error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to send campaign',
      message: error.message
    });
  }
};

/**
 * ✅ PROCESS CAMPAIGN
 */
async function processCampaign(campaignId) {
  try {
    const campaign = await Campaign.findById(campaignId).populate('businessId');
    if (!campaign) {
      console.error('❌ Campaign not found:', campaignId);
      return;
    }

    console.log(`\n🚀 === PROCESSING CAMPAIGN ===`);
    console.log(`   Campaign: ${campaign.name}`);
    console.log(`   Business: ${campaign.businessId.name}`);
    console.log(`   Recipients: ${campaign.stats.totalRecipients}`);

    // ✅ Get Twilio number
    const businessIdString = campaign.businessId._id.toString();
    let twilioPhoneNumber = null;

    const twilioNumber = await TwilioNumber.findOne({
      assignedBusinesses: businessIdString,
      isActive: true
    });

    if (twilioNumber) {
      twilioPhoneNumber = twilioNumber.number;
      console.log(`   Using DB Twilio number: ${twilioPhoneNumber}`);
    } else {
      const businessDoc = await Business.findById(businessIdString).select('twilioNumber twilioNumberActive');
      if (businessDoc?.twilioNumber && businessDoc.twilioNumberActive) {
        twilioPhoneNumber = businessDoc.twilioNumber;
        console.log(`   Using business Twilio number: ${twilioPhoneNumber}`);
      }
    }

    if (!twilioPhoneNumber) {
      throw new Error(`No active Twilio number found for business ${campaign.businessId.name}`);
    }

    // Get customers
    const customers = await getAudienceCustomers(campaign);
    
    if (customers.length === 0) {
      console.log('⚠️ No eligible recipients');
      campaign.status = 'completed';
      campaign.completedAt = new Date();
      campaign.stats.totalRecipients = 0;
      campaign.stats.pending = 0;
      await campaign.save();
      return;
    }

    console.log(`\n📤 Sending to ${customers.length} customers...`);

    // Send messages
    for (const customer of customers) {
      try {
        await sendCampaignMessage(campaign, customer, twilioPhoneNumber);
        await new Promise(resolve => setTimeout(resolve, 100)); // Rate limit
      } catch (error) {
        console.error(`   ❌ Failed to send to ${customer.phone}:`, error.message);
      }
    }

    // Complete
    campaign.status = 'completed';
    campaign.completedAt = new Date();
    await campaign.save();

    console.log(`\n✅ === CAMPAIGN COMPLETED ===`);
    console.log(`   Sent: ${campaign.stats.sent}`);
    console.log(`   Delivered: ${campaign.stats.delivered}`);
    console.log(`   Failed: ${campaign.stats.failed}`);
    console.log(`============================\n`);

  } catch (error) {
    console.error('\n❌ Campaign processing failed:', error.message);
    await Campaign.findByIdAndUpdate(campaignId, {
      status: 'failed',
      completedAt: new Date()
    });
  }
}

/**
 * ✅ SEND MESSAGE with personalization
 */
async function sendCampaignMessage(campaign, customer, fromNumber) {
  try {
    const reward = await getCustomerRewards(customer._id, campaign.businessId);

    const customerName = customer.metadata?.name || '';
    let personalizedMessage = campaign.message
      .replace(/\{firstName\}/g, customerName.split(' ')[0] || '')
      .replace(/\{lastName\}/g, customerName.split(' ')[1] || '')
      .replace(/\{name\}/g, customerName)
      .replace(/\{rewardCode\}/g, reward ? reward.code : '')
      .replace(/\{rewardName\}/g, reward ? reward.name : '')
      .replace(/\{rewardDescription\}/g, reward ? reward.description : '');

    console.log(`   📤 ${customerName || customer.phone}${reward ? ' 🎁' : ''}`);

    const delivery = await CampaignDelivery.create({
      campaignId: campaign._id,
      businessId: campaign.businessId,
      customerId: customer._id,
      phone: customer.phone,
      message: personalizedMessage,
      mediaUrl: campaign.mediaUrl,
      status: 'queued'
    });

    const messageParams = {
      to: customer.phone,
      from: fromNumber,
      body: personalizedMessage
    };

    if (campaign.mediaUrl) {
      messageParams.mediaUrl = [campaign.mediaUrl];
    }

    const twilioMessage = await twilioClient.messages.create(messageParams);

    delivery.messageSid = twilioMessage.sid;
    delivery.status = 'sent';
    delivery.sentAt = new Date();
    await delivery.save();

    campaign.stats.sent += 1;
    campaign.stats.pending -= 1;
    await campaign.save();

  } catch (error) {
    const errorCode = error.code?.toString();
    const isInvalid = INVALID_ERROR_CODES.includes(errorCode);

    await CampaignDelivery.findOneAndUpdate(
      { campaignId: campaign._id, customerId: customer._id },
      {
        status: isInvalid ? 'invalid' : 'failed',
        errorCode: errorCode,
        errorMessage: error.message,
        failedAt: new Date()
      }
    );

    if (isInvalid) {
      await markCustomerInvalid(customer._id, errorCode, error.message);
      campaign.stats.invalid += 1;
    } else {
      campaign.stats.failed += 1;
    }

    campaign.stats.pending -= 1;
    await campaign.save();

    campaign.errors.push({
      customerId: customer._id,
      phone: customer.phone,
      errorCode: errorCode,
      errorMessage: error.message,
      timestamp: new Date()
    });
    await campaign.save();
    
    throw error;
  }
}

/**
 * HANDLE TWILIO DELIVERY STATUS WEBHOOK
 */
exports.handleDeliveryStatus = async (req, res) => {
  try {
    const { MessageSid, MessageStatus, ErrorCode } = req.body;

    console.log('📨 Delivery status:', { MessageSid, MessageStatus, ErrorCode });

    const delivery = await CampaignDelivery.findOne({ messageSid: MessageSid });
    
    if (!delivery) {
      console.warn('Delivery record not found for:', MessageSid);
      return res.status(200).send('OK');
    }

    const statusMap = {
      'queued': 'queued',
      'sent': 'sent',
      'delivered': 'delivered',
      'failed': 'failed',
      'undelivered': 'undelivered'
    };

    delivery.status = statusMap[MessageStatus] || MessageStatus;

    if (MessageStatus === 'delivered') {
      delivery.deliveredAt = new Date();
      await Campaign.findByIdAndUpdate(delivery.campaignId, {
        $inc: { 'stats.delivered': 1 }
      });
    }
    if (MessageStatus === 'failed' || MessageStatus === 'undelivered') {
      delivery.failedAt = new Date();
      delivery.errorCode = ErrorCode;
      
      if (INVALID_ERROR_CODES.includes(ErrorCode)) {
        delivery.status = 'invalid';
        await markCustomerInvalid(
          delivery.customerId,
          ErrorCode,
          `Delivery failed with error ${ErrorCode}`
        );
        await Campaign.findByIdAndUpdate(delivery.campaignId, {
          $inc: { 'stats.invalid': 1 }
        });
      } else {
        await Campaign.findByIdAndUpdate(delivery.campaignId, {
          $inc: { 'stats.failed': 1 }
        });
      }
    }

    await delivery.save();
    res.status(200).send('OK');

  } catch (error) {
    console.error('❌ Delivery status webhook error:', error);
    res.status(500).send('Error');
  }
};

/**
 * DELETE CAMPAIGN
 */
exports.deleteCampaign = async (req, res) => {
  try {
    const { id } = req.params;
    const userRole = req.user.role;
    const userBusinessId = req.user.businessId;

    const campaign = await Campaign.findById(id);
    if (!campaign) {
      return res.status(404).json({
        ok: false,
        error: 'Campaign not found'
      });
    }

    if (userRole === 'admin' && campaign.businessId.toString() !== userBusinessId) {
      return res.status(403).json({
        ok: false,
        error: 'Access denied'
      });
    }

    if (campaign.status === 'sending') {
      return res.status(400).json({
        ok: false,
        error: 'Cannot delete campaign while sending'
      });
    }

    await Campaign.findByIdAndDelete(id);
    await CampaignDelivery.deleteMany({ campaignId: id });

    res.json({
      ok: true,
      message: 'Campaign deleted'
    });

  } catch (error) {
    console.error('❌ Delete Campaign Error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to delete campaign',
      message: error.message
    });
  }
};

// ✅ Export the scheduler initialization function
module.exports = {
  ...exports,
  initializeCampaignScheduler
};