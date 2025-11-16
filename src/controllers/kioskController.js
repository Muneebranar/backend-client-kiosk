// ✅ OPTIMIZED Check-in Controller with Better Messaging
// Key improvements:
// 1. Parallel database queries for faster response
// 2. Better SMS messages showing specific reward names
// 3. Fixed 15-day expiration enforced
// 4. Cleaner, more responsive flow

const Business = require("../models/Business");
const Customer = require("../models/Customer");
const CheckinLog = require("../models/CheckinLog");
const InboundEvent = require("../models/InboundEvent");
const Reward = require("../models/Reward");
const RewardHistory = require("../models/rewardHistory");
const { sendComplianceSms, client } = require("../services/twilioService");
const twilio = require("twilio");

// ✅ Normalize phone number helper
const normalizePhone = (num) => {
  if (!num) return num;
  const digits = num.toString().replace(/\D/g, "");
  if (num.trim().startsWith("+")) return `+${digits}`;
  return `+${digits}`;
};

/**
 * 📲 POST /api/kiosk/checkin
 * ✅ OPTIMIZED: Faster check-in with better messaging
 */
/**
 * 📲 POST /api/kiosk/checkin
 * ✅ FIXED: Uses reward template threshold from database
 */
exports.checkin = async (req, res) => {
  try {
    const { phone, businessSlug, dateOfBirth } = req.body;

    // ✅ Validation
    if (!phone || !businessSlug) {
      return res.status(400).json({ ok: false, error: "phone and businessSlug required" });
    }

    let normalizedPhone = phone.trim().replace(/\D/g, "");
    if (!normalizedPhone.startsWith("1")) normalizedPhone = "1" + normalizedPhone;
    normalizedPhone = "+" + normalizedPhone;

    console.log("📥 Check-in request:", { phone: normalizedPhone, businessSlug });

    // ✅ OPTIMIZATION: Parallel queries for business and customer
    const [business, customer] = await Promise.all([
      Business.findOne({ slug: businessSlug }),
      Customer.findOne({ phone: normalizedPhone, businessId: null })
    ]);

    if (!business) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }

    // Now fetch customer with correct businessId
    let existingCustomer = await Customer.findOne({
      phone: normalizedPhone,
      businessId: business._id
    });

    // ✅ Age gate check
    if (business.ageGate?.enabled && dateOfBirth) {
      const birthDate = new Date(dateOfBirth);
      const age = Math.floor((Date.now() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
      if (age < (business.ageGate.minAge || 18)) {
        return res.status(403).json({
          ok: false,
          error: `You must be ${business.ageGate.minAge || 18}+ to check in`,
        });
      }
    }

    // ✅ Check Twilio setup
    if (!business.twilioNumberActive) {
      return res.status(503).json({ ok: false, error: "SMS service unavailable" });
    }

    const fromNumber = business.twilioNumber || process.env.DEFAULT_TWILIO_NUMBER;
    if (!fromNumber) {
      return res.status(500).json({ ok: false, error: "SMS not configured" });
    }

    // ✅ Status checks
    if (existingCustomer?.subscriberStatus === 'blocked') {
      return res.status(403).json({
        ok: false,
        error: "Your account is blocked. Contact the business for help.",
        blocked: true
      });
    }

    if (existingCustomer?.subscriberStatus === 'unsubscribed') {
      return res.status(403).json({
        ok: false,
        error: "You're unsubscribed. Reply START to resubscribe first.",
        unsubscribed: true
      });
    }

    const isFirstCheckin = !existingCustomer;

    // ✅ FIXED: Fetch reward template EARLY to get the actual threshold
    const rewardTemplate = await Reward.findOne({
      businessId: business._id,
      phone: { $exists: false },
      isActive: true,
    }).sort({ priority: 1 });

    // ✅ Use the reward template's threshold from database
    const rewardThreshold = rewardTemplate?.threshold || business.rewardThreshold || 10;
    const cooldownHours = business.checkinCooldownHours || 24;

    console.log(`🎯 Reward threshold set to: ${rewardThreshold} (from ${rewardTemplate ? 'reward template' : 'business setting'})`);

    // ✅ COOLDOWN CHECK
    let isInCooldown = false;
    let timeRemaining = null;

    if (existingCustomer?.lastCheckinAt) {
      const lastCheckin = new Date(existingCustomer.lastCheckinAt);
      const now = new Date();
      const hoursSinceLast = (now - lastCheckin) / (1000 * 60 * 60);
      isInCooldown = hoursSinceLast < cooldownHours;
      
      if (isInCooldown) {
        const nextAvailable = new Date(lastCheckin.getTime() + (cooldownHours * 60 * 60 * 1000));
        const msRemaining = nextAvailable - now;
        
        const hoursRemaining = Math.floor(msRemaining / (1000 * 60 * 60));
        const minutesRemaining = Math.ceil((msRemaining % (1000 * 60 * 60)) / (1000 * 60));
        
        timeRemaining = {
          hours: hoursRemaining,
          minutes: minutesRemaining,
          nextAvailable: nextAvailable.toISOString(),
          message: hoursRemaining > 0 
            ? `Please wait ${hoursRemaining}h ${minutesRemaining}m before your next check-in`
            : `Please wait ${minutesRemaining} minutes before your next check-in`
        };
      }
    }

    // ✅ Return early if in cooldown
    if (isInCooldown) {
      console.log(`⏳ Cooldown active:`, timeRemaining);
      
      // Log attempt without creating checkin
      await CheckinLog.create({
        businessId: business._id,
        customerId: existingCustomer._id,
        phone: normalizedPhone,
        countryCode: "+1",
        status: "cooldown",
        pointsAwarded: 0,
        metadata: {
          cooldown: true,
          timeRemaining: timeRemaining,
          checkinCounted: false
        }
      });

      const checkinsRemaining = rewardThreshold - (existingCustomer.totalCheckins % rewardThreshold);

      return res.json({
        ok: false,
        cooldown: true,
        timeRemaining: timeRemaining,
        totalCheckins: existingCustomer.totalCheckins,
        rewardThreshold: rewardThreshold,
        checkinsUntilReward: checkinsRemaining === 0 ? rewardThreshold : checkinsRemaining,
        message: timeRemaining.message
      });
    }

    // ✅ CREATE OR UPDATE CUSTOMER
    let customerDoc;
    if (existingCustomer) {
      existingCustomer.totalCheckins += 1;
      existingCustomer.lastCheckinAt = new Date();
      
      if (dateOfBirth && !existingCustomer.ageVerified) {
        existingCustomer.ageVerified = true;
        existingCustomer.ageVerifiedAt = new Date();
      }
      
      customerDoc = await existingCustomer.save();
      console.log(`✅ Check-in counted. Total: ${customerDoc.totalCheckins}`);
    } else {
      customerDoc = await Customer.create({
        phone: normalizedPhone,
        countryCode: "+1",
        businessId: business._id,
        subscriberStatus: "active",
        totalCheckins: 1,
        firstCheckinAt: new Date(),
        lastCheckinAt: new Date(),
        consentGiven: true,
        consentTimestamp: new Date(),
        ageVerified: !!dateOfBirth,
        ageVerifiedAt: dateOfBirth ? new Date() : undefined,
      });
      console.log("✅ New customer created");
    }

    // ✅ CREATE CHECKIN LOG
    const checkinLog = await CheckinLog.create({
      businessId: business._id,
      customerId: customerDoc._id,
      phone: normalizedPhone,
      countryCode: "+1",
      status: "kiosk",
      pointsAwarded: 0,
      metadata: {
        cooldown: false,
        checkinCounted: true,
        totalCheckinsAfter: customerDoc.totalCheckins,
        rewardThreshold: rewardThreshold // ✅ Log the threshold used
      }
    });

    // ✅ Calculate progress using the actual threshold
    const checkinsRemaining = rewardThreshold - (customerDoc.totalCheckins % rewardThreshold);
    const nextRewardAt = checkinsRemaining === 0 ? rewardThreshold : checkinsRemaining;
    
    // ✅ Check if threshold reached (using actual threshold from reward template)
    const shouldIssueReward = customerDoc.totalCheckins > 0 && customerDoc.totalCheckins % rewardThreshold === 0;

    console.log(`🔍 Reward check: checkins=${customerDoc.totalCheckins}, threshold=${rewardThreshold}, shouldIssue=${shouldIssueReward}`);

    let newReward = null;
    let smsPromises = [];

    // ✅ SEND WELCOME SMS (first-time only) - non-blocking
    if (isFirstCheckin) {
      smsPromises.push(
        sendComplianceSms(business, normalizedPhone, fromNumber)
          .then(() => {
            const welcomeMsg = business.welcomeMessage || 
              `Welcome to ${business.name}! Thanks for checking in.`;
            return client.messages.create({
              to: normalizedPhone,
              from: fromNumber,
              body: welcomeMsg,
            });
          })
          .catch(err => console.error("❌ Welcome SMS failed:", err.message))
      );
    }

    // ✅ ISSUE REWARD IF THRESHOLD REACHED
    if (shouldIssueReward) {
      console.log(`🎉 Reward threshold reached! ${customerDoc.totalCheckins} check-ins`);
      
      if (rewardTemplate) {
        // Generate code
        const rewardCode = `RW-${Math.random().toString(36).substr(2, 8).toUpperCase()}`;
        
        // ✅ FIXED: Always 15 days expiration
        const expiresAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);

        // Create reward instance
        const rewardInstance = await Reward.create({
          businessId: business._id,
          phone: normalizedPhone,
          name: rewardTemplate.name,
          description: rewardTemplate.description,
          threshold: rewardTemplate.threshold,
          code: rewardCode,
          expiresAt: expiresAt,
          expiryDays: 15, // Always 15 days
          redeemed: false,
          priority: rewardTemplate.priority,
          isActive: true,
          discountType: rewardTemplate.discountType || 'none',
          discountValue: rewardTemplate.discountValue || 0,
        });

        // Log in history
        await RewardHistory.create({
          businessId: business._id,
          customerId: customerDoc._id,
          rewardId: rewardInstance._id,
          checkinId: checkinLog._id,
          phone: normalizedPhone,
          status: "Active",
        });

        newReward = {
          _id: rewardInstance._id,
          name: rewardTemplate.name,
          code: rewardCode,
          description: rewardTemplate.description,
          expiresAt: expiresAt,
          discountType: rewardInstance.discountType,
          discountValue: rewardInstance.discountValue,
        };

        // ✅ IMPROVED: Send reward SMS with specific details - non-blocking
        smsPromises.push(
          (async () => {
            try {
              const expiryDate = expiresAt.toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric', 
                year: 'numeric' 
              });

              let rewardMsg = '';
              
              if (rewardTemplate.discountType === 'fixed') {
                rewardMsg = `🎉 Congratulations! Show this text and receive $${rewardTemplate.discountValue} OFF any food purchase! Use code ${rewardCode}. Expires ${expiryDate}.`;
              } else if (rewardTemplate.discountType === 'percentage') {
                rewardMsg = `🎉 Congratulations! Show this text and receive ${rewardTemplate.discountValue}% OFF any food purchase! Use code ${rewardCode}. Expires ${expiryDate}.`;
              } else {
                rewardMsg = `🎉 Congratulations! Show this text and receive your ${rewardTemplate.name}! Use code ${rewardCode}. Expires ${expiryDate}.`;
              }

              await client.messages.create({
                to: normalizedPhone,
                from: fromNumber,
                body: rewardMsg,
              });

              console.log("📱 Reward SMS sent");
            } catch (err) {
              console.error("❌ Reward SMS failed:", err.message);
            }
          })()
        );
      } else {
        console.warn("⚠️ No reward template found, cannot issue reward");
      }
    } else {
      // ✅ IMPROVED: Send progress SMS mentioning the specific reward they're earning towards
      if (rewardTemplate && !isFirstCheckin) {
        smsPromises.push(
          (async () => {
            try {
              let progressMsg = '';
              
              if (nextRewardAt === 1) {
                if (rewardTemplate.discountType === 'fixed') {
                  progressMsg = `Thanks for checking in! Only 1 more check-in to receive $${rewardTemplate.discountValue} OFF any food purchase!`;
                } else if (rewardTemplate.discountType === 'percentage') {
                  progressMsg = `Thanks for checking in! Only 1 more check-in to receive ${rewardTemplate.discountValue}% OFF any food purchase!`;
                } else {
                  progressMsg = `Thanks for checking in! Only 1 more check-in to receive your ${rewardTemplate.name}!`;
                }
              } else {
                if (rewardTemplate.discountType === 'fixed') {
                  progressMsg = `Thanks for checking in! Only ${nextRewardAt} more check-ins to receive $${rewardTemplate.discountValue} OFF any food purchase!`;
                } else if (rewardTemplate.discountType === 'percentage') {
                  progressMsg = `Thanks for checking in! Only ${nextRewardAt} more check-ins to receive ${rewardTemplate.discountValue}% OFF any food purchase!`;
                } else {
                  progressMsg = `Thanks for checking in! Only ${nextRewardAt} more check-ins to receive your ${rewardTemplate.name}!`;
                }
              }

              await client.messages.create({
                to: normalizedPhone,
                from: fromNumber,
                body: progressMsg,
              });

              console.log("📱 Progress SMS sent");
            } catch (err) {
              console.error("❌ Progress SMS failed:", err.message);
            }
          })()
        );
      }
    }

    // ✅ OPTIMIZATION: Don't wait for SMS to complete - respond immediately
    Promise.all(smsPromises).catch(err => console.error("SMS batch error:", err));

    // ✅ SUCCESS RESPONSE - returned immediately without waiting for SMS
    const response = {
      ok: true,
      phone: normalizedPhone,
      business: business.name,
      totalCheckins: customerDoc.totalCheckins,
      checkinCounted: true,
      isNewCustomer: isFirstCheckin,
      subscriberStatus: customerDoc.subscriberStatus,
      rewardThreshold: rewardThreshold,
      checkinsUntilReward: nextRewardAt,
      newReward: newReward,
      message: nextRewardAt === 1
        ? `Thanks for checking in! Only 1 more check-in to earn your reward!`
        : `Thanks for checking in! Only ${nextRewardAt} more check-ins to earn your reward!`,
      cooldownHours: cooldownHours,
      nextCheckinAvailable: new Date(Date.now() + (cooldownHours * 60 * 60 * 1000)).toISOString()
    };

    console.log("✅ Check-in complete:", { 
      checkins: customerDoc.totalCheckins, 
      nextReward: nextRewardAt,
      rewardIssued: !!newReward,
      thresholdUsed: rewardThreshold
    });

    res.json(response);

  } catch (err) {
    console.error("💥 Check-in error:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
};

/**
 * 💬 POST /api/twilio/webhook
 * Handles incoming STOP / START / HELP / OTHER messages from Twilio.
 */
exports.twilioWebhook = async (req, res) => {
  try {
    const { From, Body, MessageSid, To } = req.body;
    const incomingFrom = normalizePhone(From);
    console.log("📩 Incoming Twilio message:", req.body);

    if (!From) {
      console.warn("⚠️ Webhook missing 'From' number, ignoring.");
      return res.type("text/xml").send("<Response></Response>");
    }

    const incoming = Body ? Body.trim().toUpperCase() : "";
    let eventType = "OTHER";
    if (incoming.includes("STOP")) eventType = "STOP";
    else if (incoming.includes("START")) eventType = "START";
    else if (incoming.includes("HELP")) eventType = "HELP";

    // Find customer
    const customer = await Customer.findOne({ phone: incomingFrom }).sort({ createdAt: -1 });

    // Log inbound event
    const inbound = await InboundEvent.create({
      fromNumber: incomingFrom,
      body: Body,
      eventType,
      customerId: customer?._id || null,
      raw: req.body,
    });

    console.log("✅ InboundEvent saved:", inbound._id, "Type:", eventType);

    // Update subscription status
    if (customer) {
      if (eventType === "STOP") {
        customer.subscriberStatus = "unsubscribed";
      } else if (eventType === "START") {
        customer.subscriberStatus = "active";
      }
      await customer.save();
    }

    // Respond to Twilio
    const twiml = new twilio.twiml.MessagingResponse();

    if (eventType === "STOP") {
      twiml.message("You have been unsubscribed. Reply START to rejoin.");
    } else if (eventType === "START") {
      twiml.message("You are now subscribed again. Thank you!");
    } else if (eventType === "HELP") {
      twiml.message("Reply START to subscribe again or STOP to unsubscribe.");
    } else {
      twiml.message("Thanks for your message! We'll get back to you soon.");
    }

    res.type("text/xml").send(twiml.toString());
  } catch (err) {
    console.error("💥 Webhook error:", err);
    res.status(500).send("<Response></Response>");
  }
};

/**
 * 🏪 GET /api/kiosk/:slug
 * Returns business details by slug for kiosk display.
 */
exports.getKioskBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    console.log(`🟢 Kiosk request for slug: ${slug}`);

    const business = await Business.findOne({ slug });
    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    // Fetch current active rewards for display
    const activeRewards = await Reward.find({
      businessId: business._id,
      redeemed: false,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    }).sort({ createdAt: -1 });

    res.json({
      ok: true,
      business,
      activeRewards,
      message: `Loaded kiosk for ${business.name}`,
    });
  } catch (err) {
    console.error("❌ Failed to load kiosk:", err);
    res.status(500).json({ error: "server error" });
  }
};

/**
 * Block a customer
 * POST /admin/block-customer
 */
exports.blockCustomer = async (req, res) => {
  try {
    const { customerId, reason = "Blocked by admin" } = req.body;
    
    if (!customerId) return res.status(400).json({ ok: false, error: "customerId is required" });

    const customer = await Customer.findById(customerId);
    if (!customer) return res.status(404).json({ ok: false, error: "Customer not found" });

    if (req.user.role === "staff") return res.status(403).json({ ok: false, error: "Staff cannot block customers" });
    if (req.user.role !== "master" && customer.businessId.toString() !== req.user.businessId.toString()) {
      return res.status(403).json({ ok: false, error: "Access denied" });
    }

    customer.subscriberStatus = "blocked";
    customer.blockDate = new Date();
    customer.blockReason = reason;
    
    await customer.save();

    console.log(`🚫 Customer blocked: ${customer.phone}, Reason: ${reason}`);

    res.json({ 
      ok: true, 
      message: "Customer blocked successfully", 
      customer 
    });
  } catch (err) {
    console.error("Block Customer Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
};

/**
 * Block a customer by ID (soft delete)
 * POST /customers/:id/block
 */
exports.blockCustomerById = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason = "Blocked by admin" } = req.body;

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ ok: false, error: "Customer not found" });
    }

    // Access control
    if (req.user.role === "staff") {
      return res.status(403).json({ ok: false, error: "Staff cannot block customers" });
    }

    if (req.user.role !== "master" && customer.businessId.toString() !== req.user.businessId.toString()) {
      return res.status(403).json({ ok: false, error: "Access denied" });
    }

    customer.subscriberStatus = "blocked";
    customer.blockDate = new Date();
    customer.blockReason = reason;
    
    await customer.save();

    console.log(`🚫 Customer blocked: ${customer.phone}, Reason: ${reason}`);

    res.json({ ok: true, message: "Customer blocked successfully", customer });
  } catch (err) {
    console.error("Block Customer Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
};

/**
 * Unblock a customer by ID
 * POST /customers/:id/unblock
 */
exports.unblockCustomerById = async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ ok: false, error: "Customer not found" });
    }

    // Access control
    if (req.user.role === "staff") {
      return res.status(403).json({ ok: false, error: "Staff cannot unblock customers" });
    }

    if (req.user.role !== "master" && customer.businessId.toString() !== req.user.businessId.toString()) {
      return res.status(403).json({ ok: false, error: "Access denied" });
    }

    customer.subscriberStatus = "active";
    customer.unblockDate = new Date();
    
    await customer.save();

    console.log(`🔓 Customer unblocked: ${customer.phone}`);

    res.json({ 
      ok: true, 
      message: "Customer unblocked successfully", 
      customer 
    });
  } catch (err) {
    console.error("Unblock Customer Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
};

/**
 * Unblock customer by ID (body)
 * POST /admin/unblock-customer
 * Body: { customerId: "..." }
 */
exports.unblockCustomer = async (req, res) => {
  try {
    const { customerId } = req.body;
    if (!customerId) return res.status(400).json({ ok: false, error: "customerId is required" });

    const customer = await Customer.findById(customerId);
    if (!customer) return res.status(404).json({ ok: false, error: "Customer not found" });

    if (req.user.role === "staff") return res.status(403).json({ ok: false, error: "Staff cannot unblock customers" });
    if (req.user.role !== "master" && customer.businessId.toString() !== req.user.businessId.toString()) {
      return res.status(403).json({ ok: false, error: "Access denied" });
    }

    customer.subscriberStatus = "active";
    customer.unblockDate = new Date();
    
    await customer.save();

    console.log(`🔓 Customer unblocked: ${customer.phone}`);

    res.json({ 
      ok: true, 
      message: "Customer unblocked successfully", 
      customer 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
};

/**
 * Redeem a reward
 * PUT /admin/rewards/:rewardId/redeem
 */
exports.redeemReward = async (req, res) => {
  try {
    const { rewardId } = req.params;

    console.log('🎁 Redeeming reward:', rewardId);

    if (!rewardId) {
      return res.status(400).json({ ok: false, error: "Reward ID is required" });
    }

    // Find the reward
    const reward = await Reward.findById(rewardId);
    
    if (!reward) {
      return res.status(404).json({ ok: false, error: "Reward not found" });
    }

    // Check if already redeemed
    if (reward.redeemed) {
      return res.status(400).json({ ok: false, error: "Reward already redeemed" });
    }

    // Check if expired
    if (reward.expiresAt && new Date(reward.expiresAt) < new Date()) {
      return res.status(400).json({ ok: false, error: "Reward has expired" });
    }

    // Check access permissions
    if (req.user.role !== 'master' && req.user.role !== 'superadmin') {
      if (reward.businessId.toString() !== req.user.businessId.toString()) {
        return res.status(403).json({ ok: false, error: "Access denied" });
      }
    }

    // ✅ Find the customer and reset their check-ins to zero
    const customer = await Customer.findOne({ 
      phone: reward.phone, 
      businessId: reward.businessId 
    });

    if (customer) {
      customer.totalCheckins = 0;
      await customer.save();
      console.log(`🔄 Customer check-ins reset to 0 for phone: ${reward.phone}`);
    }

    // Mark as redeemed
    reward.redeemed = true;
    reward.redeemedAt = new Date();
    reward.redeemedBy = req.user.id;
    
    await reward.save();

    // Update reward history
    await RewardHistory.updateOne(
      { rewardId: reward._id },
      { 
        status: "Redeemed",
        redeemedAt: new Date(),
        redeemedBy: req.user.id
      }
    );

    console.log(`✅ Reward redeemed: ${reward.code}`);

    res.json({ 
      ok: true, 
      message: "Reward redeemed successfully", 
      reward,
      customer: customer ? {
        phone: customer.phone,
        totalCheckins: customer.totalCheckins
      } : null
    });

  } catch (err) {
    console.error('❌ Redeem Error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
};