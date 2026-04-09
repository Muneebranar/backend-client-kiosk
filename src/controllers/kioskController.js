// // controllers/kioskController.js
// // ✅ UPDATED: Enhanced Twilio webhook with keyword auto-reply system

// const Business = require("../models/Business");
// const Customer = require("../models/Customer");
// const CheckinLog = require("../models/CheckinLog");
// const InboundEvent = require("../models/InboundEvent");
// const Reward = require("../models/Reward");
// const RewardHistory = require("../models/rewardHistory");
// const { sendComplianceSms, client } = require("../services/twilioService");
// const twilio = require("twilio");

// // ✅ Normalize phone number helper
// const normalizePhone = (num) => {
//   if (!num) return num;
//   const digits = num.toString().replace(/\D/g, "");
//   if (num.trim().startsWith("+")) return `+${digits}`;
//   return `+${digits}`;
// };

// /**
//  * ✅ NEW: Helper function to check if message is a compliance keyword
//  */
// const isComplianceKeyword = (message) => {
//   const msg = message.trim().toUpperCase();
//   return msg.includes("STOP") || msg.includes("START") || msg.includes("HELP");
// };

// /**
//  * ✅ NEW: Helper function to determine compliance event type
//  */
// const getComplianceEventType = (message) => {
//   const msg = message.trim().toUpperCase();
//   if (msg.includes("STOP")) return "STOP";
//   if (msg.includes("START")) return "START";
//   if (msg.includes("HELP")) return "HELP";
//   return "OTHER";
// };

// /**
//  * 📲 POST /api/kiosk/checkin
//  * ✅ IMPROVED: Enhanced SMS debugging and error handling
//  */
// exports.checkin = async (req, res) => {
//   try {
//     const { phone, businessSlug, dateOfBirth } = req.body;

//     // ✅ Validation
//     if (!phone || !businessSlug) {
//       return res.status(400).json({ ok: false, error: "phone and businessSlug required" });
//     }

//     let normalizedPhone = phone.trim().replace(/\D/g, "");
//     if (!normalizedPhone.startsWith("1")) normalizedPhone = "1" + normalizedPhone;
//     normalizedPhone = "+" + normalizedPhone;

//     console.log("📥 Check-in request:", { phone: normalizedPhone, businessSlug });

//     // ✅ OPTIMIZATION: Parallel queries for business and customer
//     const [business, customer] = await Promise.all([
//       Business.findOne({ slug: businessSlug }),
//       Customer.findOne({ phone: normalizedPhone, businessId: null })
//     ]);

//     if (!business) {
//       return res.status(404).json({ ok: false, error: "Business not found" });
//     }

//     // Now fetch customer with correct businessId
//     let existingCustomer = await Customer.findOne({
//       phone: normalizedPhone,
//       businessId: business._id
//     });

//     // ✅ Age gate check
//     if (business.ageGate?.enabled && dateOfBirth) {
//       const birthDate = new Date(dateOfBirth);
//       const age = Math.floor((Date.now() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
//       if (age < (business.ageGate.minAge || 18)) {
//         return res.status(403).json({
//           ok: false,
//           error: `You must be ${business.ageGate.minAge || 18}+ to check in`,
//         });
//       }
//     }

//     // ✅ IMPROVED: Enhanced Twilio setup check with detailed logging
//     console.log("🔍 Twilio Configuration Check:", {
//       businessName: business.name,
//       businessId: business._id,
//       twilioNumber: business.twilioNumber,
//       twilioNumberActive: business.twilioNumberActive,
//       defaultNumber: process.env.DEFAULT_TWILIO_NUMBER,
//       twilioClientExists: !!client
//     });

//     if (!business.twilioNumberActive) {
//       console.error("❌ Twilio not active for business:", business.name);
//       return res.status(503).json({ ok: false, error: "SMS service unavailable" });
//     }

//     const fromNumber = business.twilioNumber || process.env.DEFAULT_TWILIO_NUMBER;
//     if (!fromNumber) {
//       console.error("❌ No Twilio number configured");
//       return res.status(500).json({ ok: false, error: "SMS not configured" });
//     }

//     console.log("📞 Using Twilio number:", fromNumber);

//     // ✅ Status checks
//     if (existingCustomer?.subscriberStatus === 'blocked') {
//       return res.status(403).json({
//         ok: false,
//         error: "Your account is blocked. Contact the business for help.",
//         blocked: true
//       });
//     }

//     if (existingCustomer?.subscriberStatus === 'unsubscribed') {
//       return res.status(403).json({
//         ok: false,
//         error: "You're unsubscribed. Reply START to resubscribe first.",
//         unsubscribed: true
//       });
//     }

//     const isFirstCheckin = !existingCustomer;

//     // ✅ FIXED: Fetch reward template EARLY to get the actual threshold
//     const rewardTemplate = await Reward.findOne({
//       businessId: business._id,
//       phone: { $exists: false },
//       isActive: true,
//     }).sort({ priority: 1 });

//     // ✅ Use the reward template's threshold from database
//     const rewardThreshold = rewardTemplate?.threshold || business.rewardThreshold || 10;
//     const cooldownHours = business.checkinCooldownHours || 24;

//     console.log(`🎯 Reward threshold set to: ${rewardThreshold} (from ${rewardTemplate ? 'reward template' : 'business setting'})`);

//     // ✅ COOLDOWN CHECK
//     let isInCooldown = false;
//     let timeRemaining = null;

//     if (existingCustomer?.lastCheckinAt) {
//       const lastCheckin = new Date(existingCustomer.lastCheckinAt);
//       const now = new Date();
//       const hoursSinceLast = (now - lastCheckin) / (1000 * 60 * 60);
//       isInCooldown = hoursSinceLast < cooldownHours;
      
//       if (isInCooldown) {
//         const nextAvailable = new Date(lastCheckin.getTime() + (cooldownHours * 60 * 60 * 1000));
//         const msRemaining = nextAvailable - now;
        
//         const hoursRemaining = Math.floor(msRemaining / (1000 * 60 * 60));
//         const minutesRemaining = Math.ceil((msRemaining % (1000 * 60 * 60)) / (1000 * 60));
        
//         timeRemaining = {
//           hours: hoursRemaining,
//           minutes: minutesRemaining,
//           nextAvailable: nextAvailable.toISOString(),
//           message: hoursRemaining > 0 
//             ? `Please wait ${hoursRemaining}h ${minutesRemaining}m before your next check-in`
//             : `Please wait ${minutesRemaining} minutes before your next check-in`
//         };
//       }
//     }

//     // ✅ Return early if in cooldown
//     if (isInCooldown) {
//       console.log(`⏳ Cooldown active:`, timeRemaining);
      
//       // Log attempt without creating checkin
//       await CheckinLog.create({
//         businessId: business._id,
//         customerId: existingCustomer._id,
//         phone: normalizedPhone,
//         countryCode: "+1",
//         status: "cooldown",
//         pointsAwarded: 0,
//         metadata: {
//           cooldown: true,
//           timeRemaining: timeRemaining,
//           checkinCounted: false
//         }
//       });

//       const checkinsRemaining = rewardThreshold - (existingCustomer.totalCheckins % rewardThreshold);

//       return res.json({
//         ok: false,
//         cooldown: true,
//         timeRemaining: timeRemaining,
//         totalCheckins: existingCustomer.totalCheckins,
//         rewardThreshold: rewardThreshold,
//         checkinsUntilReward: checkinsRemaining === 0 ? rewardThreshold : checkinsRemaining,
//         message: timeRemaining.message
//       });
//     }

//     // ✅ CREATE OR UPDATE CUSTOMER
//     let customerDoc;
//     if (existingCustomer) {
//       existingCustomer.totalCheckins += 1;
//       existingCustomer.lastCheckinAt = new Date();
      
//       if (dateOfBirth && !existingCustomer.ageVerified) {
//         existingCustomer.ageVerified = true;
//         existingCustomer.ageVerifiedAt = new Date();
//       }
      
//       customerDoc = await existingCustomer.save();
//       console.log(`✅ Check-in counted. Total: ${customerDoc.totalCheckins}`);
//     } else {
//       customerDoc = await Customer.create({
//         phone: normalizedPhone,
//         countryCode: "+1",
//         businessId: business._id,
//         subscriberStatus: "active",
//         totalCheckins: 1,
//         firstCheckinAt: new Date(),
//         lastCheckinAt: new Date(),
//         consentGiven: true,
//         consentTimestamp: new Date(),
//         ageVerified: !!dateOfBirth,
//         ageVerifiedAt: dateOfBirth ? new Date() : undefined,
//       });
//       console.log("✅ New customer created");
//     }

//     // ✅ CREATE CHECKIN LOG
//     const checkinLog = await CheckinLog.create({
//       businessId: business._id,
//       customerId: customerDoc._id,
//       phone: normalizedPhone,
//       countryCode: "+1",
//       status: "kiosk",
//       pointsAwarded: 0,
//       metadata: {
//         cooldown: false,
//         checkinCounted: true,
//         totalCheckinsAfter: customerDoc.totalCheckins,
//         rewardThreshold: rewardThreshold
//       }
//     });

//     // ✅ Calculate progress using the actual threshold
//     const checkinsRemaining = rewardThreshold - (customerDoc.totalCheckins % rewardThreshold);
//     const nextRewardAt = checkinsRemaining === 0 ? rewardThreshold : checkinsRemaining;
    
//     // ✅ Check if threshold reached (using actual threshold from reward template)
//     const shouldIssueReward = customerDoc.totalCheckins > 0 && customerDoc.totalCheckins % rewardThreshold === 0;

//     console.log(`🔍 Reward check: checkins=${customerDoc.totalCheckins}, threshold=${rewardThreshold}, shouldIssue=${shouldIssueReward}`);

//     let newReward = null;
//     let smsResults = {
//       welcome: { attempted: false, success: false, error: null },
//       reward: { attempted: false, success: false, error: null }
//     };

//     // ✅ IMPROVED: Send welcome SMS with better error handling
//     if (isFirstCheckin) {
//       console.log("📱 Attempting to send welcome SMS to new customer");
//       smsResults.welcome.attempted = true;
      
//       try {
//         // Send compliance SMS first
//         console.log("📋 Sending compliance SMS...");
//         await sendComplianceSms(business, normalizedPhone, fromNumber);
//         console.log("✅ Compliance SMS sent");
        
//         // Then send welcome message
//         const welcomeMsg = business.welcomeMessage || 
//           `Welcome to ${business.name}! Thanks for checking in.`;
        
//         console.log("📨 Sending welcome message:", {
//           to: normalizedPhone,
//           from: fromNumber,
//           messagePreview: welcomeMsg.substring(0, 50) + "..."
//         });
        
//         const welcomeResult = await client.messages.create({
//           to: normalizedPhone,
//           from: fromNumber,
//           body: welcomeMsg,
//         });
        
//         console.log("✅ Welcome SMS sent successfully:", {
//           sid: welcomeResult.sid,
//           status: welcomeResult.status
//         });
//         smsResults.welcome.success = true;
        
//       } catch (err) {
//         console.error("❌ Welcome SMS failed:", {
//           error: err.message,
//           code: err.code,
//           status: err.status,
//           moreInfo: err.moreInfo
//         });
//         smsResults.welcome.error = err.message;
//       }
//     }

//     // ✅ IMPROVED: Issue reward with better error handling
//     if (shouldIssueReward) {
//       console.log(`🎉 Reward threshold reached! ${customerDoc.totalCheckins} check-ins`);
      
//       if (rewardTemplate) {
//         // Generate code
//         const rewardCode = `RW-${Math.random().toString(36).substr(2, 8).toUpperCase()}`;
        
//         // ✅ FIXED: Always 15 days expiration
//         const expiresAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);

//         // Create reward instance
//         const rewardInstance = await Reward.create({
//           businessId: business._id,
//           phone: normalizedPhone,
//           name: rewardTemplate.name,
//           description: rewardTemplate.description,
//           threshold: rewardTemplate.threshold,
//           code: rewardCode,
//           expiresAt: expiresAt,
//           expiryDays: 15,
//           redeemed: false,
//           priority: rewardTemplate.priority,
//           isActive: true,
//           discountType: rewardTemplate.discountType || 'none',
//           discountValue: rewardTemplate.discountValue || 0,
//         });

//         // Log in history
//         await RewardHistory.create({
//           businessId: business._id,
//           customerId: customerDoc._id,
//           rewardId: rewardInstance._id,
//           checkinId: checkinLog._id,
//           phone: normalizedPhone,
//           status: "Active",
//         });

//         newReward = {
//           _id: rewardInstance._id,
//           name: rewardTemplate.name,
//           code: rewardCode,
//           description: rewardTemplate.description,
//           expiresAt: expiresAt,
//           discountType: rewardInstance.discountType,
//           discountValue: rewardInstance.discountValue,
//         };

//         // ✅ IMPROVED: Send reward SMS with better error handling
//         console.log("📱 Attempting to send reward SMS");
//         smsResults.reward.attempted = true;
        
//         try {
//           const expiryDate = expiresAt.toLocaleDateString('en-US', { 
//             month: 'short', 
//             day: 'numeric', 
//             year: 'numeric' 
//           });

//           let rewardMsg = '';
          
//           if (rewardTemplate.discountType === 'fixed') {
//             rewardMsg = `🎉 Congratulations! Show this text and receive $${rewardTemplate.discountValue} OFF any purchase! Use code ${rewardCode}. Expires ${expiryDate}.`;
//           } else if (rewardTemplate.discountType === 'percentage') {
//             rewardMsg = `🎉 Congratulations! Show this text and receive ${rewardTemplate.discountValue}% OFF any purchase! Use code ${rewardCode}. Expires ${expiryDate}.`;
//           } else {
//             rewardMsg = `🎉 Congratulations! Show this text and receive your ${rewardTemplate.name}! Use code ${rewardCode}. Expires ${expiryDate}.`;
//           }

//           console.log("📨 Sending reward message:", {
//             to: normalizedPhone,
//             from: fromNumber,
//             messagePreview: rewardMsg.substring(0, 50) + "..."
//           });

//           const rewardResult = await client.messages.create({
//             to: normalizedPhone,
//             from: fromNumber,
//             body: rewardMsg,
//           });

//           console.log("✅ Reward SMS sent successfully:", {
//             sid: rewardResult.sid,
//             status: rewardResult.status
//           });
//           smsResults.reward.success = true;

//         } catch (err) {
//           console.error("❌ Reward SMS failed:", {
//             error: err.message,
//             code: err.code,
//             status: err.status,
//             moreInfo: err.moreInfo
//           });
//           smsResults.reward.error = err.message;
//         }
//       } else {
//         console.warn("⚠️ No reward template found, cannot issue reward");
//       }
//     } else {
//       console.log(`✅ Regular check-in (no SMS sent). Progress: ${nextRewardAt} more needed`);
//     }

//     // ✅ Log SMS results summary
//     console.log("📊 SMS Results Summary:", smsResults);

//     // ✅ SUCCESS RESPONSE
//     const response = {
//       ok: true,
//       phone: normalizedPhone,
//       business: business.name,
//       totalCheckins: customerDoc.totalCheckins,
//       checkinCounted: true,
//       isNewCustomer: isFirstCheckin,
//       subscriberStatus: customerDoc.subscriberStatus,
//       rewardThreshold: rewardThreshold,
//       checkinsUntilReward: nextRewardAt,
//       newReward: newReward,
//       message: nextRewardAt === 1
//         ? `Thanks for checking in! Only 1 more check-in to earn your reward!`
//         : `Thanks for checking in! Only ${nextRewardAt} more check-ins to earn your reward!`,
//       cooldownHours: cooldownHours,
//       nextCheckinAvailable: new Date(Date.now() + (cooldownHours * 60 * 60 * 1000)).toISOString(),
//       // ✅ Add SMS status to response for debugging
//       smsStatus: smsResults
//     };

//     console.log("✅ Check-in complete:", { 
//       checkins: customerDoc.totalCheckins, 
//       nextReward: nextRewardAt,
//       rewardIssued: !!newReward,
//       thresholdUsed: rewardThreshold,
//       welcomeSent: smsResults.welcome.success,
//       rewardSent: smsResults.reward.success
//     });

//     res.json(response);

//   } catch (err) {
//     console.error("💥 Check-in error:", err);
//     res.status(500).json({ ok: false, error: "Server error" });
//   }
// };

// // ✅ FIXED: twilioWebhook in kioskController.js
// // Drop-in replacement for the exports.twilioWebhook function
// //
// // BUGS FIXED:
// // 1. Customer.findOne now scoped to businessId to avoid cross-business matches
// // 2. Added detailed keyword match logging to surface silent failures
// // 3. Keyword uppercase normalization applied defensively at match time
// // 4. Added try/catch around findMatchingKeyword so errors don't silently fall to fallback
// // 5. Fallback is now ONLY sent when keyword array is non-empty but no match found

// exports.twilioWebhook = async (req, res) => {
//   try {
//     const { From, To, Body, MessageSid, AccountSid } = req.body;
//     const incomingFrom = normalizePhone(From);
//     const incomingTo = normalizePhone(To);

//     console.log("📩 Incoming Twilio message:", {
//       from: incomingFrom,
//       to: incomingTo,
//       body: Body,
//       // messageSid: MessageSid,
//       // accountSid: AccountSid,
//     });

//     if (!From) {
//       console.warn("⚠️ Webhook missing 'From' number, ignoring.");
//       return res.type("text/xml").send("<Response></Response>");
//     }

//     const incoming = Body ? Body.trim() : "";

//     // ✅ Check compliance keywords first
//     const isCompliance = isComplianceKeyword(incoming);
//     const eventType = isCompliance ? getComplianceEventType(incoming) : "OTHER";

//     // ✅ FIX 1: Find business FIRST by Twilio number
//     let business = null;
//     if (incomingTo) {
//       business = await Business.findOne({
//         twilioNumber: incomingTo,
//         twilioNumberActive: true,
//       });

//       if (business) {
//         console.log(`✅ Found business for Twilio number ${incomingTo}:`, business.name);
//       } else {
//         console.warn(`⚠️ No business found for Twilio number: ${incomingTo}`);
//       }
//     }

//     // ✅ FIX 2: Scope customer lookup to this business to avoid cross-business matches
//     let customer = null;
//     if (business) {
//       customer = await Customer.findOne({
//         phone: incomingFrom,
//         businessId: business._id,
//       });
//     } else {
//       // Fallback: find any customer with this phone (compliance handling)
//       customer = await Customer.findOne({ phone: incomingFrom }).sort({ createdAt: -1 });
//     }

//     // ✅ Create inbound event
//     const inbound = await InboundEvent.create({
//       fromNumber: incomingFrom,
//       toNumber: incomingTo,
//       body: Body,
//       eventType,
//       customerId: customer?._id || null,
//       businessId: business?._id || null,
//       messageSid: MessageSid,
//       accountSid: AccountSid,
//       status: "received",
//       raw: req.body,
//     });

//     console.log("✅ InboundEvent saved:", {
//       id: inbound._id,
//       type: eventType,
//       from: incomingFrom,
//       to: incomingTo,
//       businessId: business?._id,
//       customerId: customer?._id,
//     });

//     const twiml = new twilio.twiml.MessagingResponse();
//     let responseMessage = "";
//     let shouldRespond = true;

//     // ─────────────────────────────────────────────────────────
//     // PRIORITY 1: Compliance keywords (STOP / START / HELP)
//     // ─────────────────────────────────────────────────────────
//     if (isCompliance) {
//       console.log(`🔒 Processing compliance keyword: ${eventType}`);

//       if (customer) {
//         if (eventType === "STOP") {
//           customer.subscriberStatus = "unsubscribed";
//           responseMessage = "You have been unsubscribed. Reply START to rejoin.";
//         } else if (eventType === "START") {
//           customer.subscriberStatus = "active";
//           responseMessage = "You are now subscribed again. Thank you!";
//         } else if (eventType === "HELP") {
//           responseMessage = "Reply START to subscribe again or STOP to unsubscribe.";
//         }
//         await customer.save();
//         console.log(`✅ Customer status updated:`, customer.subscriberStatus);
//       } else {
//         if (eventType === "STOP") responseMessage = "You have been unsubscribed.";
//         else if (eventType === "START") responseMessage = "You are now subscribed. Thank you!";
//         else if (eventType === "HELP") responseMessage = "Reply START to subscribe or STOP to unsubscribe.";
//       }

//       inbound.status = "processed";
//       await inbound.save();
//     }

//     // ─────────────────────────────────────────────────────────
//     // PRIORITY 2: Keyword auto-replies
//     // ─────────────────────────────────────────────────────────
//     else if (business && business.autoReplies?.enabled) {
//       console.log(`🔍 Checking keyword auto-replies for business: ${business.name}`);
//       console.log(`📝 Incoming message: "${incoming}"`);
//       console.log(`📋 Active keywords:`, business.autoReplies.keywords
//         .filter(k => k.active)
//         .map(k => ({ keyword: k.keyword, matchType: k.matchType }))
//       );

//       // ✅ FIX 3: Wrap in try/catch so errors don't silently fall to fallback
//       let matchedKeyword = null;
//       try {
//         matchedKeyword = business.findMatchingKeyword(incoming);
//       } catch (matchErr) {
//         console.error("❌ Error in findMatchingKeyword:", matchErr);
//       }

//       if (matchedKeyword) {
//         console.log(`✅ Keyword matched:`, {
//           keyword: matchedKeyword.keyword,
//           matchType: matchedKeyword.matchType,
//           response: matchedKeyword.response.substring(0, 80),
//         });

//         // ✅ Format response (handles {EXPIRATION_DATE} placeholders)
//         responseMessage = business.formatKeywordResponse(matchedKeyword);

//         console.log(`📤 Keyword response: "${responseMessage.substring(0, 120)}"`);

//         // Update usage stats
//         await business.updateKeywordUsage(matchedKeyword._id);

//         inbound.status = "processed";
//         inbound.eventType = "KEYWORD_MATCH";
//         inbound.metadata = {
//           keywordId: matchedKeyword._id,
//           keyword: matchedKeyword.keyword,
//           matchType: matchedKeyword.matchType,
//         };
//         await inbound.save();

//       } else {
//         // ✅ FIX 4: Only send fallback if configured to do so
//         console.log(`🔕 No keyword matched for: "${incoming}"`);

//         if (business.autoReplies.sendFallback) {
//           console.log(`📝 Sending fallback message`);
//           responseMessage =
//             business.autoReplies.fallbackMessage ||
//             "Thanks for your message! We'll get back to you soon.";

//           inbound.status = "processed";
//           inbound.eventType = "FALLBACK";
//         } else {
//           console.log(`🔕 Fallback disabled, no response sent`);
//           shouldRespond = false;
//           inbound.status = "processed";
//           inbound.eventType = "NO_RESPONSE";
//         }

//         await inbound.save();
//       }
//     }

//     // ─────────────────────────────────────────────────────────
//     // PRIORITY 3: No business found — generic fallback
//     // ─────────────────────────────────────────────────────────
//     else {
//       console.warn(`⚠️ No business found or auto-replies disabled`);
//       responseMessage = "Thanks for your message! We'll get back to you soon.";
//       inbound.status = "processed";
//       await inbound.save();
//     }

//     // ─────────────────────────────────────────────────────────
//     // Send TwiML response
//     // ─────────────────────────────────────────────────────────
//     if (shouldRespond && responseMessage) {
//       twiml.message(responseMessage);
//       console.log(`📤 TwiML response queued: "${responseMessage.substring(0, 100)}"`);
//     } else {
//       console.log(`🔕 No TwiML response sent`);
//     }

//     res.type("text/xml").send(twiml.toString());

//   } catch (err) {
//     console.error("💥 Webhook error:", err);
//     res.status(500).send("<Response></Response>");
//   }
// };


// /**
//  * 🏪 GET /api/kiosk/:slug
//  * Returns business details by slug for kiosk display.
//  */
// exports.getKioskBySlug = async (req, res) => {
//   try {
//     const { slug } = req.params;
//     console.log(`🟢 Kiosk request for slug: ${slug}`);

//     const business = await Business.findOne({ slug });
//     if (!business) {
//       return res.status(404).json({ error: "Business not found" });
//     }

//     // Fetch current active rewards for display
//     const activeRewards = await Reward.find({
//       businessId: business._id,
//       redeemed: false,
//       $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
//     }).sort({ createdAt: -1 });

//     res.json({
//       ok: true,
//       business,
//       activeRewards,
//       message: `Loaded kiosk for ${business.name}`,
//     });
//   } catch (err) {
//     console.error("❌ Failed to load kiosk:", err);
//     res.status(500).json({ error: "server error" });
//   }
// };

// /**
//  * Block a customer
//  * POST /admin/block-customer
//  */
// exports.blockCustomer = async (req, res) => {
//   try {
//     const { customerId, reason = "Blocked by admin" } = req.body;
    
//     if (!customerId) return res.status(400).json({ ok: false, error: "customerId is required" });

//     const customer = await Customer.findById(customerId);
//     if (!customer) return res.status(404).json({ ok: false, error: "Customer not found" });

//     if (req.user.role === "staff") return res.status(403).json({ ok: false, error: "Staff cannot block customers" });
//     if (req.user.role !== "master" && customer.businessId.toString() !== req.user.businessId.toString()) {
//       return res.status(403).json({ ok: false, error: "Access denied" });
//     }

//     customer.subscriberStatus = "blocked";
//     customer.blockDate = new Date();
//     customer.blockReason = reason;
    
//     await customer.save();

//     console.log(`🚫 Customer blocked: ${customer.phone}, Reason: ${reason}`);

//     res.json({ 
//       ok: true, 
//       message: "Customer blocked successfully", 
//       customer 
//     });
//   } catch (err) {
//     console.error("Block Customer Error:", err);
//     res.status(500).json({ ok: false, error: err.message });
//   }
// };

// /**
//  * Block a customer by ID (soft delete)
//  * POST /customers/:id/block
//  */
// exports.blockCustomerById = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { reason = "Blocked by admin" } = req.body;

//     const customer = await Customer.findById(id);
//     if (!customer) {
//       return res.status(404).json({ ok: false, error: "Customer not found" });
//     }

//     // Access control
//     if (req.user.role === "staff") {
//       return res.status(403).json({ ok: false, error: "Staff cannot block customers" });
//     }

//     if (req.user.role !== "master" && customer.businessId.toString() !== req.user.businessId.toString()) {
//       return res.status(403).json({ ok: false, error: "Access denied" });
//     }

//     customer.subscriberStatus = "blocked";
//     customer.blockDate = new Date();
//     customer.blockReason = reason;
    
//     await customer.save();

//     console.log(`🚫 Customer blocked: ${customer.phone}, Reason: ${reason}`);

//     res.json({ ok: true, message: "Customer blocked successfully", customer });
//   } catch (err) {
//     console.error("Block Customer Error:", err);
//     res.status(500).json({ ok: false, error: err.message });
//   }
// };

// /**
//  * Unblock a customer by ID
//  * POST /customers/:id/unblock
//  */
// exports.unblockCustomerById = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const customer = await Customer.findById(id);
//     if (!customer) {
//       return res.status(404).json({ ok: false, error: "Customer not found" });
//     }

//     // Access control
//     if (req.user.role === "staff") {
//       return res.status(403).json({ ok: false, error: "Staff cannot unblock customers" });
//     }

//     if (req.user.role !== "master" && customer.businessId.toString() !== req.user.businessId.toString()) {
//       return res.status(403).json({ ok: false, error: "Access denied" });
//     }

//     customer.subscriberStatus = "active";
//     customer.unblockDate = new Date();
    
//     await customer.save();

//     console.log(`🔓 Customer unblocked: ${customer.phone}`);

//     res.json({ 
//       ok: true, 
//       message: "Customer unblocked successfully", 
//       customer 
//     });
//   } catch (err) {
//     console.error("Unblock Customer Error:", err);
//     res.status(500).json({ ok: false, error: err.message });
//   }
// };

// /**
//  * Unblock customer by ID (body)
//  * POST /admin/unblock-customer
//  * Body: { customerId: "..." }
//  */
// exports.unblockCustomer = async (req, res) => {
//   try {
//     const { customerId } = req.body;
//     if (!customerId) return res.status(400).json({ ok: false, error: "customerId is required" });

//     const customer = await Customer.findById(customerId);
//     if (!customer) return res.status(404).json({ ok: false, error: "Customer not found" });

//     if (req.user.role === "staff") return res.status(403).json({ ok: false, error: "Staff cannot unblock customers" });
//     if (req.user.role !== "master" && customer.businessId.toString() !== req.user.businessId.toString()) {
//       return res.status(403).json({ ok: false, error: "Access denied" });
//     }

//     customer.subscriberStatus = "active";
//     customer.unblockDate = new Date();
    
//     await customer.save();

//     console.log(`🔓 Customer unblocked: ${customer.phone}`);

//     res.json({ 
//       ok: true, 
//       message: "Customer unblocked successfully", 
//       customer 
//     });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ ok: false, error: err.message });
//   }
// };

// /**
//  * Redeem a reward
//  * PUT /admin/rewards/:rewardId/redeem
//  */
// exports.redeemReward = async (req, res) => {
//   try {
//     const { rewardId } = req.params;

//     console.log('🎁 Redeeming reward:', rewardId);

//     if (!rewardId) {
//       return res.status(400).json({ ok: false, error: "Reward ID is required" });
//     }

//     // Find the reward
//     const reward = await Reward.findById(rewardId);
    
//     if (!reward) {
//       return res.status(404).json({ ok: false, error: "Reward not found" });
//     }

//     // Check if already redeemed
//     if (reward.redeemed) {
//       return res.status(400).json({ ok: false, error: "Reward already redeemed" });
//     }

//     // Check if expired
//     if (reward.expiresAt && new Date(reward.expiresAt) < new Date()) {
//       return res.status(400).json({ ok: false, error: "Reward has expired" });
//     }

//     // Check access permissions
//     if (req.user.role !== 'master' && req.user.role !== 'superadmin') {
//       if (reward.businessId.toString() !== req.user.businessId.toString()) {
//         return res.status(403).json({ ok: false, error: "Access denied" });
//       }
//     }

//     // ✅ Find the customer and reset their check-ins to zero
//     const customer = await Customer.findOne({ 
//       phone: reward.phone, 
//       businessId: reward.businessId 
//     });

//     if (customer) {
//       customer.totalCheckins = 0;
//       await customer.save();
//       console.log(`🔄 Customer check-ins reset to 0 for phone: ${reward.phone}`);
//     }

//     // Mark as redeemed
//     reward.redeemed = true;
//     reward.redeemedAt = new Date();
//     reward.redeemedBy = req.user.id;
    
//     await reward.save();

//     // Update reward history
//     await RewardHistory.updateOne(
//       { rewardId: reward._id },
//       { 
//         status: "Redeemed",
//         redeemedAt: new Date(),
//         redeemedBy: req.user.id
//       }
//     );

//     console.log(`✅ Reward redeemed: ${reward.code}`);

//     res.json({ 
//       ok: true, 
//       message: "Reward redeemed successfully", 
//       reward,
//       customer: customer ? {
//         phone: customer.phone,
//         totalCheckins: customer.totalCheckins
//       } : null
//     });

//   } catch (err) {
//     console.error('❌ Redeem Error:', err);
//     res.status(500).json({ ok: false, error: err.message });
//   }
// };
// controllers/kioskController.js

const Business = require("../models/Business");
const Customer = require("../models/Customer");
const CheckinLog = require("../models/CheckinLog");
const InboundEvent = require("../models/InboundEvent");
const Reward = require("../models/Reward");
const RewardHistory = require("../models/rewardHistory");
const { sendComplianceSms, client } = require("../services/twilioService");
const twilio = require("twilio");

// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────

const normalizePhone = (num) => {
  if (!num) return num;
  const digits = num.toString().replace(/\D/g, "");
  if (num.trim().startsWith("+")) return `+${digits}`;
  return `+${digits}`;
};

/**
 * ✅ FIXED: Only match EXACT compliance keywords, not substrings.
 * "MUAGRAPEVINE".includes("START") would have been a false positive.
 * Compliance keywords must be the ENTIRE message (trimmed), not just contained.
 */
const COMPLIANCE_KEYWORDS = ["STOP", "START", "HELP", "UNSTOP", "CANCEL", "END", "QUIT"];

const isComplianceKeyword = (message) => {
  const msg = message.trim().toUpperCase();
  return COMPLIANCE_KEYWORDS.includes(msg); // ← exact match only, not includes()
};

const getComplianceEventType = (message) => {
  const msg = message.trim().toUpperCase();
  if (["STOP", "CANCEL", "END", "QUIT", "UNSUBSCRIBE"].includes(msg)) return "STOP";
  if (["START", "UNSTOP", "RESUBSCRIBE"].includes(msg)) return "START";
  if (msg === "HELP") return "HELP";
  return "OTHER";
};

/**
 * ✅ Inline keyword matcher — does NOT depend on Mongoose instance methods.
 * Immune to .lean() stripping, method hydration issues, or schema loading order.
 */
const findMatchingKeyword = (business, message) => {
  if (!business?.autoReplies?.enabled) {
    console.log("🔕 Auto-replies disabled for business");
    return null;
  }

  const keywords = business.autoReplies?.keywords;
  if (!keywords?.length) {
    console.log("🔕 No keywords configured");
    return null;
  }

  // ✅ Strip ALL whitespace and non-printable chars, then uppercase
  const msg = message.replace(/\s+/g, " ").trim().toUpperCase();
  console.log(`🔠 Normalized incoming for matching: "${msg}"`);

  for (const kw of keywords) {
    if (!kw.active) {
      console.log(`  ⏭ Skipping inactive keyword: "${kw.keyword}"`);
      continue;
    }

    // ✅ Strip hidden chars from stored keyword too (defensive)
    const storedKeyword = (kw.keyword || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "") // zero-width chars
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();

    let isMatch = false;

    switch (kw.matchType) {
      case "exact":
        isMatch = msg === storedKeyword;
        break;
      case "contains":
        isMatch = msg.includes(storedKeyword);
        break;
      case "starts_with":
        isMatch = msg.startsWith(storedKeyword);
        break;
      default:
        isMatch = msg === storedKeyword;
    }

    console.log(
      `  Checking "${storedKeyword}" (${kw.matchType}) vs "${msg}": ${isMatch ? "✅ MATCH" : "❌ no match"}`
    );

    if (isMatch) return kw;
  }

  return null;
};

/**
 * ✅ Inline response formatter — replaces {EXPIRATION_DATE} placeholder.
 */
const formatKeywordResponse = (keyword) => {
  if (!keyword.hasExpiration || !keyword.expirationDays) {
    return keyword.response;
  }

  const expDate = new Date();
  expDate.setDate(expDate.getDate() + keyword.expirationDays);
  const formatted = expDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return keyword.response.replace(/\{\{?EXPIRATION_DATE\}?\}/g, formatted);
};

// ─────────────────────────────────────────────────────────
// CHECKIN
// ─────────────────────────────────────────────────────────

exports.checkin = async (req, res) => {
  try {
    const { phone, businessSlug, dateOfBirth } = req.body;

    if (!phone || !businessSlug) {
      return res.status(400).json({ ok: false, error: "phone and businessSlug required" });
    }

    let normalizedPhone = phone.trim().replace(/\D/g, "");
    if (!normalizedPhone.startsWith("1")) normalizedPhone = "1" + normalizedPhone;
    normalizedPhone = "+" + normalizedPhone;

    console.log("📥 Check-in request:", { phone: normalizedPhone, businessSlug });

    const [business, customer] = await Promise.all([
      Business.findOne({ slug: businessSlug }),
      Customer.findOne({ phone: normalizedPhone, businessId: null }),
    ]);

    if (!business) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }

    let existingCustomer = await Customer.findOne({
      phone: normalizedPhone,
      businessId: business._id,
    });

    if (business.ageGate?.enabled && dateOfBirth) {
      const birthDate = new Date(dateOfBirth);
      const age = Math.floor(
        (Date.now() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
      );
      if (age < (business.ageGate.minAge || 18)) {
        return res.status(403).json({
          ok: false,
          error: `You must be ${business.ageGate.minAge || 18}+ to check in`,
        });
      }
    }

    console.log("🔍 Twilio Configuration Check:", {
      businessName: business.name,
      twilioNumber: business.twilioNumber,
      twilioNumberActive: business.twilioNumberActive,
    });

    if (!business.twilioNumberActive) {
      return res.status(503).json({ ok: false, error: "SMS service unavailable" });
    }

    const fromNumber = business.twilioNumber || process.env.DEFAULT_TWILIO_NUMBER;
    if (!fromNumber) {
      return res.status(500).json({ ok: false, error: "SMS not configured" });
    }

    if (existingCustomer?.subscriberStatus === "blocked") {
      return res.status(403).json({
        ok: false,
        error: "Your account is blocked. Contact the business for help.",
        blocked: true,
      });
    }

    if (existingCustomer?.subscriberStatus === "unsubscribed") {
      return res.status(403).json({
        ok: false,
        error: "You're unsubscribed. Reply START to resubscribe first.",
        unsubscribed: true,
      });
    }

    const isFirstCheckin = !existingCustomer;

    const rewardTemplate = await Reward.findOne({
      businessId: business._id,
      phone: { $exists: false },
      isActive: true,
    }).sort({ priority: 1 });

    const rewardThreshold = rewardTemplate?.threshold || business.rewardThreshold || 10;
    const cooldownHours = business.checkinCooldownHours || 24;

    let isInCooldown = false;
    let timeRemaining = null;

    if (existingCustomer?.lastCheckinAt) {
      const lastCheckin = new Date(existingCustomer.lastCheckinAt);
      const now = new Date();
      const hoursSinceLast = (now - lastCheckin) / (1000 * 60 * 60);
      isInCooldown = hoursSinceLast < cooldownHours;

      if (isInCooldown) {
        const nextAvailable = new Date(
          lastCheckin.getTime() + cooldownHours * 60 * 60 * 1000
        );
        const msRemaining = nextAvailable - now;
        const hoursRemaining = Math.floor(msRemaining / (1000 * 60 * 60));
        const minutesRemaining = Math.ceil(
          (msRemaining % (1000 * 60 * 60)) / (1000 * 60)
        );
        timeRemaining = {
          hours: hoursRemaining,
          minutes: minutesRemaining,
          nextAvailable: nextAvailable.toISOString(),
          message:
            hoursRemaining > 0
              ? `Please wait ${hoursRemaining}h ${minutesRemaining}m before your next check-in`
              : `Please wait ${minutesRemaining} minutes before your next check-in`,
        };
      }
    }

    if (isInCooldown) {
      await CheckinLog.create({
        businessId: business._id,
        customerId: existingCustomer._id,
        phone: normalizedPhone,
        countryCode: "+1",
        status: "cooldown",
        pointsAwarded: 0,
        metadata: { cooldown: true, timeRemaining, checkinCounted: false },
      });

      const checkinsRemaining =
        rewardThreshold - (existingCustomer.totalCheckins % rewardThreshold);

      return res.json({
        ok: false,
        cooldown: true,
        timeRemaining,
        totalCheckins: existingCustomer.totalCheckins,
        rewardThreshold,
        checkinsUntilReward:
          checkinsRemaining === 0 ? rewardThreshold : checkinsRemaining,
        message: timeRemaining.message,
      });
    }

    let customerDoc;
    if (existingCustomer) {
      existingCustomer.totalCheckins += 1;
      existingCustomer.lastCheckinAt = new Date();
      if (dateOfBirth && !existingCustomer.ageVerified) {
        existingCustomer.ageVerified = true;
        existingCustomer.ageVerifiedAt = new Date();
      }
      customerDoc = await existingCustomer.save();
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
    }

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
        rewardThreshold,
      },
    });

    const checkinsRemaining =
      rewardThreshold - (customerDoc.totalCheckins % rewardThreshold);
    const nextRewardAt =
      checkinsRemaining === 0 ? rewardThreshold : checkinsRemaining;
    const shouldIssueReward =
      customerDoc.totalCheckins > 0 &&
      customerDoc.totalCheckins % rewardThreshold === 0;

    let newReward = null;
    let smsResults = {
      welcome: { attempted: false, success: false, error: null },
      reward: { attempted: false, success: false, error: null },
    };

    if (isFirstCheckin) {
      smsResults.welcome.attempted = true;
      try {
        await sendComplianceSms(business, normalizedPhone, fromNumber);
        const welcomeMsg =
          business.welcomeMessage ||
          `Welcome to ${business.name}! Thanks for checking in.`;
        const welcomeResult = await client.messages.create({
          to: normalizedPhone,
          from: fromNumber,
          body: welcomeMsg,
        });
        console.log("✅ Welcome SMS sent:", welcomeResult.sid);
        smsResults.welcome.success = true;
      } catch (err) {
        console.error("❌ Welcome SMS failed:", err.message);
        smsResults.welcome.error = err.message;
      }
    }

    if (shouldIssueReward && rewardTemplate) {
      const rewardCode = `RW-${Math.random().toString(36).substr(2, 8).toUpperCase()}`;
      const expiresAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);

      const rewardInstance = await Reward.create({
        businessId: business._id,
        phone: normalizedPhone,
        name: rewardTemplate.name,
        description: rewardTemplate.description,
        threshold: rewardTemplate.threshold,
        code: rewardCode,
        expiresAt,
        expiryDays: 15,
        redeemed: false,
        priority: rewardTemplate.priority,
        isActive: true,
        discountType: rewardTemplate.discountType || "none",
        discountValue: rewardTemplate.discountValue || 0,
      });

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
        expiresAt,
        discountType: rewardInstance.discountType,
        discountValue: rewardInstance.discountValue,
      };

      smsResults.reward.attempted = true;
      try {
        const expiryDate = expiresAt.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        let rewardMsg =
          rewardTemplate.discountType === "fixed"
            ? `🎉 Congratulations! Show this text and receive $${rewardTemplate.discountValue} OFF any purchase! Use code ${rewardCode}. Expires ${expiryDate}.`
            : rewardTemplate.discountType === "percentage"
            ? `🎉 Congratulations! Show this text and receive ${rewardTemplate.discountValue}% OFF any purchase! Use code ${rewardCode}. Expires ${expiryDate}.`
            : `🎉 Congratulations! Show this text and receive your ${rewardTemplate.name}! Use code ${rewardCode}. Expires ${expiryDate}.`;

        const rewardResult = await client.messages.create({
          to: normalizedPhone,
          from: fromNumber,
          body: rewardMsg,
        });
        console.log("✅ Reward SMS sent:", rewardResult.sid);
        smsResults.reward.success = true;
      } catch (err) {
        console.error("❌ Reward SMS failed:", err.message);
        smsResults.reward.error = err.message;
      }
    }

    res.json({
      ok: true,
      phone: normalizedPhone,
      business: business.name,
      totalCheckins: customerDoc.totalCheckins,
      checkinCounted: true,
      isNewCustomer: isFirstCheckin,
      subscriberStatus: customerDoc.subscriberStatus,
      rewardThreshold,
      checkinsUntilReward: nextRewardAt,
      newReward,
      message:
        nextRewardAt === 1
          ? `Thanks for checking in! Only 1 more check-in to earn your reward!`
          : `Thanks for checking in! Only ${nextRewardAt} more check-ins to earn your reward!`,
      cooldownHours,
      nextCheckinAvailable: new Date(
        Date.now() + cooldownHours * 60 * 60 * 1000
      ).toISOString(),
      smsStatus: smsResults,
    });
  } catch (err) {
    console.error("💥 Check-in error:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
};

// ─────────────────────────────────────────────────────────
// TWILIO WEBHOOK
// ─────────────────────────────────────────────────────────

exports.twilioWebhook = async (req, res) => {
  try {
    const { From, To, Body, MessageSid, AccountSid } = req.body;
    const incomingFrom = normalizePhone(From);
    const incomingTo = normalizePhone(To);

    console.log("📩 Incoming Twilio message:", {
      from: incomingFrom,
      to: incomingTo,
      body: Body,
    });

    if (!From) {
      console.warn("⚠️ Webhook missing 'From' number, ignoring.");
      return res.type("text/xml").send("<Response></Response>");
    }

    const incoming = Body ? Body.trim() : "";

    // ✅ FIXED: Compliance check uses exact match, not .includes()
    // Prevents "MUAGRAPEVINE" from falsely triggering START/STOP
    const isCompliance = isComplianceKeyword(incoming);
    const eventType = isCompliance ? getComplianceEventType(incoming) : "OTHER";

    console.log(`🔍 Compliance check: "${incoming.toUpperCase()}" → isCompliance=${isCompliance}`);

    // Find business by the Twilio number that received the message
    let business = null;
    if (incomingTo) {
      business = await Business.findOne({
        twilioNumber: incomingTo,
        twilioNumberActive: true,
      });
      console.log(
        business
          ? `✅ Business found: ${business.name}`
          : `⚠️ No business found for number: ${incomingTo}`
      );
    }

    // Scope customer to this business
    let customer = null;
    if (business) {
      customer = await Customer.findOne({
        phone: incomingFrom,
        businessId: business._id,
      });
    } else {
      customer = await Customer.findOne({ phone: incomingFrom }).sort({
        createdAt: -1,
      });
    }

    // Save inbound event
    const inbound = await InboundEvent.create({
      fromNumber: incomingFrom,
      toNumber: incomingTo,
      body: Body,
      eventType,
      customerId: customer?._id || null,
      businessId: business?._id || null,
      messageSid: MessageSid,
      accountSid: AccountSid,
      status: "received",
      raw: req.body,
    });

    const twiml = new twilio.twiml.MessagingResponse();
    let responseMessage = "";
    let shouldRespond = true;

    // ─────────────────────────────────────────────────────
    // PRIORITY 1: Compliance keywords (STOP / START / HELP)
    // ─────────────────────────────────────────────────────
    if (isCompliance) {
      console.log(`🔒 Compliance keyword: ${eventType}`);

      if (customer) {
        if (eventType === "STOP") {
          customer.subscriberStatus = "unsubscribed";
          responseMessage = "You have been unsubscribed. Reply START to rejoin.";
        } else if (eventType === "START") {
          customer.subscriberStatus = "active";
          responseMessage = "You are now subscribed again. Thank you!";
        } else if (eventType === "HELP") {
          responseMessage =
            "Reply START to subscribe again or STOP to unsubscribe.";
        }
        await customer.save();
      } else {
        if (eventType === "STOP")
          responseMessage = "You have been unsubscribed.";
        else if (eventType === "START")
          responseMessage = "You are now subscribed. Thank you!";
        else if (eventType === "HELP")
          responseMessage =
            "Reply START to subscribe or STOP to unsubscribe.";
      }

      inbound.status = "processed";
      await inbound.save();

    // ─────────────────────────────────────────────────────
    // PRIORITY 2: Keyword auto-replies
    // ─────────────────────────────────────────────────────
    } else if (business && business.autoReplies?.enabled) {
      console.log(`🔍 Auto-reply check for: "${incoming}"`);
      console.log(`📋 Keywords in DB: ${business.autoReplies.keywords?.length || 0}`);
      console.log(
        `📋 Active keywords:`,
        (business.autoReplies.keywords || [])
          .filter((k) => k.active)
          .map((k) => ({
            keyword: k.keyword,
            matchType: k.matchType,
            charCodes: [...(k.keyword || "")].map((c) => c.charCodeAt(0)), // ← reveals hidden chars
          }))
      );

      // ✅ Use inline matcher (no schema method dependency)
      const matchedKeyword = findMatchingKeyword(business, incoming);

      if (matchedKeyword) {
        console.log(
          `✅ Keyword matched: "${matchedKeyword.keyword}" → "${matchedKeyword.response}"`
        );

        responseMessage = formatKeywordResponse(matchedKeyword);

        // Update usage stats (non-fatal if it fails)
        try {
          await Business.updateOne(
            {
              _id: business._id,
              "autoReplies.keywords._id": matchedKeyword._id,
            },
            {
              $inc: { "autoReplies.keywords.$.usageCount": 1 },
              $set: { "autoReplies.keywords.$.lastUsedAt": new Date() },
            }
          );
        } catch (usageErr) {
          console.error("⚠️ Usage update failed (non-fatal):", usageErr.message);
        }

        inbound.status = "processed";
        inbound.eventType = "KEYWORD_MATCH";
        inbound.metadata = {
          keywordId: matchedKeyword._id,
          keyword: matchedKeyword.keyword,
          matchType: matchedKeyword.matchType,
        };
        await inbound.save();

      } else {
        // No keyword matched — send fallback
        console.log(`🔕 No keyword matched for: "${incoming}"`);

        if (business.autoReplies.sendFallback !== false) {
          responseMessage =
            business.autoReplies.fallbackMessage ||
            "Thanks for your message! We'll get back to you soon.";
          console.log(`📝 Sending fallback: "${responseMessage}"`);
          inbound.status = "processed";
          inbound.eventType = "FALLBACK";
        } else {
          console.log(`🔕 Fallback disabled, no response sent`);
          shouldRespond = false;
          inbound.status = "processed";
          inbound.eventType = "NO_RESPONSE";
        }

        await inbound.save();
      }

    // ─────────────────────────────────────────────────────
    // PRIORITY 3: No business / auto-replies disabled
    // ─────────────────────────────────────────────────────
    } else {
      console.warn(`⚠️ No business found or auto-replies disabled`);
      responseMessage = "Thanks for your message! We'll get back to you soon.";
      inbound.status = "processed";
      await inbound.save();
    }

    // Send TwiML response
    if (shouldRespond && responseMessage) {
      twiml.message(responseMessage);
      console.log(`📤 TwiML sending: "${responseMessage}"`);
    } else {
      console.log(`🔕 No TwiML response sent`);
    }

    res.type("text/xml").send(twiml.toString());
  } catch (err) {
    console.error("💥 Webhook error:", err);
    res.status(500).send("<Response></Response>");
  }
};

// ─────────────────────────────────────────────────────────
// KIOSK BY SLUG
// ─────────────────────────────────────────────────────────

exports.getKioskBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const business = await Business.findOne({ slug });
    if (!business) return res.status(404).json({ error: "Business not found" });

    const activeRewards = await Reward.find({
      businessId: business._id,
      redeemed: false,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    }).sort({ createdAt: -1 });

    res.json({ ok: true, business, activeRewards });
  } catch (err) {
    console.error("❌ Failed to load kiosk:", err);
    res.status(500).json({ error: "server error" });
  }
};

// ─────────────────────────────────────────────────────────
// BLOCK / UNBLOCK / REDEEM (unchanged logic, kept intact)
// ─────────────────────────────────────────────────────────

exports.blockCustomer = async (req, res) => {
  try {
    const { customerId, reason = "Blocked by admin" } = req.body;
    if (!customerId)
      return res.status(400).json({ ok: false, error: "customerId is required" });
    const customer = await Customer.findById(customerId);
    if (!customer)
      return res.status(404).json({ ok: false, error: "Customer not found" });
    if (req.user.role === "staff")
      return res.status(403).json({ ok: false, error: "Staff cannot block customers" });
    if (
      req.user.role !== "master" &&
      customer.businessId.toString() !== req.user.businessId.toString()
    )
      return res.status(403).json({ ok: false, error: "Access denied" });
    customer.subscriberStatus = "blocked";
    customer.blockDate = new Date();
    customer.blockReason = reason;
    await customer.save();
    res.json({ ok: true, message: "Customer blocked successfully", customer });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

exports.blockCustomerById = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason = "Blocked by admin" } = req.body;
    const customer = await Customer.findById(id);
    if (!customer)
      return res.status(404).json({ ok: false, error: "Customer not found" });
    if (req.user.role === "staff")
      return res.status(403).json({ ok: false, error: "Staff cannot block customers" });
    if (
      req.user.role !== "master" &&
      customer.businessId.toString() !== req.user.businessId.toString()
    )
      return res.status(403).json({ ok: false, error: "Access denied" });
    customer.subscriberStatus = "blocked";
    customer.blockDate = new Date();
    customer.blockReason = reason;
    await customer.save();
    res.json({ ok: true, message: "Customer blocked successfully", customer });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

exports.unblockCustomerById = async (req, res) => {
  try {
    const { id } = req.params;
    const customer = await Customer.findById(id);
    if (!customer)
      return res.status(404).json({ ok: false, error: "Customer not found" });
    if (req.user.role === "staff")
      return res.status(403).json({ ok: false, error: "Staff cannot unblock customers" });
    if (
      req.user.role !== "master" &&
      customer.businessId.toString() !== req.user.businessId.toString()
    )
      return res.status(403).json({ ok: false, error: "Access denied" });
    customer.subscriberStatus = "active";
    customer.unblockDate = new Date();
    await customer.save();
    res.json({ ok: true, message: "Customer unblocked successfully", customer });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

exports.unblockCustomer = async (req, res) => {
  try {
    const { customerId } = req.body;
    if (!customerId)
      return res.status(400).json({ ok: false, error: "customerId is required" });
    const customer = await Customer.findById(customerId);
    if (!customer)
      return res.status(404).json({ ok: false, error: "Customer not found" });
    if (req.user.role === "staff")
      return res.status(403).json({ ok: false, error: "Staff cannot unblock customers" });
    if (
      req.user.role !== "master" &&
      customer.businessId.toString() !== req.user.businessId.toString()
    )
      return res.status(403).json({ ok: false, error: "Access denied" });
    customer.subscriberStatus = "active";
    customer.unblockDate = new Date();
    await customer.save();
    res.json({ ok: true, message: "Customer unblocked successfully", customer });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

exports.redeemReward = async (req, res) => {
  try {
    const { rewardId } = req.params;
    if (!rewardId)
      return res.status(400).json({ ok: false, error: "Reward ID is required" });
    const reward = await Reward.findById(rewardId);
    if (!reward)
      return res.status(404).json({ ok: false, error: "Reward not found" });
    if (reward.redeemed)
      return res.status(400).json({ ok: false, error: "Reward already redeemed" });
    if (reward.expiresAt && new Date(reward.expiresAt) < new Date())
      return res.status(400).json({ ok: false, error: "Reward has expired" });
    if (req.user.role !== "master" && req.user.role !== "superadmin") {
      if (reward.businessId.toString() !== req.user.businessId.toString())
        return res.status(403).json({ ok: false, error: "Access denied" });
    }
    const customer = await Customer.findOne({
      phone: reward.phone,
      businessId: reward.businessId,
    });
    if (customer) {
      customer.totalCheckins = 0;
      await customer.save();
    }
    reward.redeemed = true;
    reward.redeemedAt = new Date();
    reward.redeemedBy = req.user.id;
    await reward.save();
    await RewardHistory.updateOne(
      { rewardId: reward._id },
      { status: "Redeemed", redeemedAt: new Date(), redeemedBy: req.user.id }
    );
    res.json({
      ok: true,
      message: "Reward redeemed successfully",
      reward,
      customer: customer ? { phone: customer.phone, totalCheckins: customer.totalCheckins } : null,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};