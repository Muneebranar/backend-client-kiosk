  // const Business = require("../models/Business");
  // const Checkin = require("../models/Checkin");
  // const InboundEvent = require("../models/InboundEvent");
  // const PointsLedger = require("../models/PointsLedger");
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
//  * 🟢 POST /api/checkin
//  * Handles customer check-in for a given business.
//  * Includes: compliance SMS, welcome SMS, points tracking, cooldown, and auto rewards.
// //  */
// // exports.checkin = async (req, res) => {
// //   try {
// //     const { phone, businessSlug } = req.body;

// //     // ✅ Normalize phone number: always ensure it starts with +1
// //     let normalizedPhone = phone?.trim() || "";
// //     normalizedPhone = normalizedPhone.replace(/\D/g, ""); // remove non-digits
// //     if (!normalizedPhone.startsWith("1")) {
// //       normalizedPhone = "1" + normalizedPhone;
// //     }
// //     normalizedPhone = "+" + normalizedPhone;

// //     console.log("📥 Incoming check-in:", {
// //       original: phone,
// //       normalized: normalizedPhone,
// //       businessSlug,
// //     });

// //     if (!phone || !businessSlug) {
// //       return res.status(400).json({ error: "phone and businessSlug required" });
// //     }

// //     // 🔹 Get business by slug
// //     const business = await Business.findOne({ slug: businessSlug });
// //     if (!business) return res.status(404).json({ error: "Business not found" });

// //     const fromNumber =
// //       business.twilioNumber ||
// //       process.env.DEFAULT_TWILIO_NUMBER ||
// //       process.env.TWILIO_PHONE_NUMBER;

// //     // 🔹 Get existing check-in for this customer
// //     let existingCheckin = await Checkin.findOne({
// //       phone: normalizedPhone,
// //       businessId: business._id,
// //     });

// //     // 🔹 Apply cooldown (in minutes)
// //     const cooldownMinutes = 0.1;
// //     if (existingCheckin) {
// //       const minutesSinceLast =
// //         (Date.now() - new Date(existingCheckin.updatedAt)) / (1000 * 60);
// //       if (minutesSinceLast < cooldownMinutes) {
// //         const remaining = Math.ceil(cooldownMinutes - minutesSinceLast);
// //         console.log(`⏳ Cooldown active: ${remaining} minutes remaining`);
// //         return res.json({
// //           ok: false,
// //           message: `You can check in again after ${remaining} minutes.`,
// //         });
// //       }
// //     }

// //     // ✅ If record exists → update existing
// //     if (existingCheckin) {
// //       existingCheckin.totalCheckins = (existingCheckin.totalCheckins || 1) + 1;
// //       existingCheckin.pointsAwarded = (existingCheckin.pointsAwarded || 0) + 1;
// //       existingCheckin.lastCheckinAt = new Date();
// //       await existingCheckin.save();
// //       console.log("🔁 Existing check-in updated:", existingCheckin._id);
// //     } else {
// //       // ✅ If first time → create new record
// //       existingCheckin = await Checkin.create({
// //         phone: normalizedPhone,
// //         businessId: business._id,
// //         pointsAwarded: 1,
// //         totalCheckins: 1,
// //         consentGiven: true,
// //         sentCompliance: false,
// //       });
// //       console.log("💾 New check-in created:", existingCheckin._id);
// //     }

// //     // ✅ Update Points Ledger
// //     const ledger = await PointsLedger.findOneAndUpdate(
// //       { phone: normalizedPhone, businessId: business._id },
// //       {
// //         $inc: { points: 1 },
// //         $set: { lastCheckinAt: new Date() },
// //         $setOnInsert: { createdAt: new Date() },
// //       },
// //       { new: true, upsert: true }
// //     );

// //     console.log("📘 Points Ledger updated:", ledger);

// //     // ✅ Send compliance & welcome SMS only for first-ever check-in
// //     if (!existingCheckin || existingCheckin.totalCheckins === 1) {
// //       try {
// //         await sendComplianceSms(business, normalizedPhone, fromNumber);
// //         console.log("✅ Compliance SMS sent.");

// //         const welcomeMsg =
// //           business.welcomeMessage ||
// //           `Welcome to ${business.name}! Thanks for checking in.`;

// //         await client.messages.create({
// //           to: normalizedPhone,
// //           from: fromNumber,
// //           body: welcomeMsg,
// //         });
// //         console.log("💬 Welcome SMS sent!");
// //       } catch (err) {
// //         console.error("❌ SMS sending failed:", err.message);
// //       }
// //     }

// //     // ✅ Check rewards
// //     const totalPoints = ledger.points;

// //     // ✅ Only fetch reward templates (not yet issued ones)
// //     const rewardTemplates = await Reward.find({
// //       businessId: business._id,
// //       phone: { $exists: false },
// //     });

// //     let newReward = null;

// //     for (const template of rewardTemplates) {
// //       const alreadyIssued = await Reward.findOne({
// //         businessId: business._id,
// //         phone: normalizedPhone,
// //         name: template.name,
// //         redeemed: false,
// //       });

// //       if (!alreadyIssued && totalPoints >= template.threshold) {
// //         newReward = await Reward.create({
// //           businessId: business._id,
// //           phone: normalizedPhone,
// //           name: template.name,
// //           description: template.description,
// //           threshold: template.threshold,
// //           code: `RW-${Math.random().toString(36).substr(2, 8).toUpperCase()}`,
// //           expiresAt: new Date(
// //             Date.now() +
// //               (business.rewardExpiryDays || 7) * 24 * 60 * 60 * 1000
// //           ),
// //           redeemed: false,
// //         });

// //         console.log("🎁 New reward issued:", newReward.code);

// //         // ✅ Deduct points
// //         await PointsLedger.updateOne(
// //           { businessId: business._id, phone: normalizedPhone },
// //           { $inc: { points: -template.threshold } }
// //         );

// //         // ✅ Send SMS
// //         await client.messages.create({
// //           to: normalizedPhone,
// //           from: fromNumber,
// //           body: `🎉 Congrats! You’ve unlocked ${template.name}! Use code ${newReward.code}.`,
// //         });
// //       }
// //     }

// //     // ✅ Done
// //     console.log("✅ Check-in complete.");
// //     res.json({
// //       ok: true,
// //       phone: normalizedPhone,
// //       business: business.name,
// //       totalPoints: ledger.points,
// //       newReward,
// //     });
// //   } catch (err) {
// //     console.error("💥 Check-in error:", err);
// //     res.status(500).json({ error: "Server error" });
// //   }
// // };


// exports.checkin = async (req, res) => {
//   try {
//     // const { phone, businessSlug } = req.body;
//      const { phone, businessSlug, dateOfBirth } = req.body; // ✅ add DOB


//     // ========== VALIDATION ==========
//     if (!phone || !businessSlug) {
//       return res.status(400).json({ 
//         ok: false, 
//         error: "phone and businessSlug are required" 
//       });
//     }

//     // ✅ Normalize phone number
//     let normalizedPhone = phone?.trim() || "";
//     normalizedPhone = normalizedPhone.replace(/\D/g, "");

    
//     if (!normalizedPhone) {
//       return res.status(400).json({ 
//         ok: false, 
//         error: "Invalid phone number format" 
//       });
//     }
    
//     if (!normalizedPhone.startsWith("1")) normalizedPhone = "1" + normalizedPhone;
//     normalizedPhone = "+" + normalizedPhone;

//     console.log("📥 Incoming check-in:", {
//       original: phone,
//       normalized: normalizedPhone,
//       businessSlug,
//     });

//     // ========== GET BUSINESS ==========
//     const business = await Business.findOne({ slug: businessSlug });
//     if (!business) {
//       return res.status(404).json({ 
//         ok: false, 
//         error: "Business not found" 
//       });
//     }

// //new added
//     // ✅ AGE GATE CHECK
//     if (business.ageGate?.enabled && dateOfBirth) {
//       const birthDate = new Date(dateOfBirth);
//       const age = Math.floor((Date.now() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
      
//       if (age < (business.ageGate.minAge || 18)) {
//         return res.status(403).json({
//           ok: false,
//           error: `You must be ${business.ageGate.minAge}+ to check in`,
//         });
//       }
//     }

//     // ✅ CHECK IF NUMBER IS ACTIVE
//     if (!business.twilioNumberActive) {
//       return res.status(503).json({
//         ok: false,
//         error: "SMS service temporarily unavailable for this business",
//       });
//     }

//     const fromNumber =
//       business.twilioNumber ||
//       process.env.DEFAULT_TWILIO_NUMBER ||
//       process.env.TWILIO_PHONE_NUMBER;

//     // 🔹 Get existing check-in for this customer
//     let existingCheckin = await Checkin.findOne({
//       phone: normalizedPhone,
//       businessId: business._id,
//     });

//     // 🔹 Apply cooldown (in minutes)
//     const cooldownMinutes = 0.1;
//     if (existingCheckin) {
//       const minutesSinceLast =
//         (Date.now() - new Date(existingCheckin.updatedAt)) / (1000 * 60);
//       if (minutesSinceLast < cooldownMinutes) {
//         const remaining = Math.ceil(cooldownMinutes - minutesSinceLast);
//         console.log(`⏳ Cooldown active: ${remaining} minutes remaining`);
//         return res.json({
//           ok: false,
//           message: `You can check in again after ${remaining} minutes.`,
//         });
//       }
//     }

//     // ✅ If record exists → update existing
//     if (existingCheckin) {
//       existingCheckin.totalCheckins = (existingCheckin.totalCheckins || 1) + 1;
//       existingCheckin.pointsAwarded = (existingCheckin.pointsAwarded || 0) + 1;
//       existingCheckin.lastCheckinAt = new Date();
//       await existingCheckin.save();
//       console.log("🔁 Existing check-in updated:", existingCheckin._id);
//     } else {
//       // ✅ If first time → create new record
//       existingCheckin = await Checkin.create({
//         phone: normalizedPhone,
//         businessId: business._id,
//         pointsAwarded: 1,
//         totalCheckins: 1,
//         consentGiven: true,
//         sentCompliance: false,
//       });
//       console.log("💾 New check-in created:", existingCheckin._id);
//     }

//     // ✅ Update Points Ledger
//     const ledger = await PointsLedger.findOneAndUpdate(
//       { phone: normalizedPhone, businessId: business._id },
//       {
//         $inc: { points: 1 },
//         $set: { lastCheckinAt: new Date() },
//         $setOnInsert: { createdAt: new Date() },
//       },
//       { new: true, upsert: true }
//     );

//     console.log("📘 Points Ledger updated:", ledger);

//     // ✅ Send compliance & welcome SMS only for first-ever check-in
//     if (!existingCheckin || existingCheckin.totalCheckins === 1) {
//       try {
//         await sendComplianceSms(business, normalizedPhone, fromNumber);
//         console.log("✅ Compliance SMS sent.");

//         const welcomeMsg =
//           business.welcomeMessage ||
//           `Welcome to ${business.name}! Thanks for checking in.`;

//         await client.messages.create({
//           to: normalizedPhone,
//           from: fromNumber,
//           body: welcomeMsg,
//         });
//         console.log("💬 Welcome SMS sent!");
//       } catch (err) {
//         console.error("❌ SMS sending failed:", err.message);
//       }
//     }

//     // ✅ Check rewards
//     const totalPoints = ledger.points;

//     // ✅ Only fetch reward templates (not yet issued ones)
//     const rewardTemplates = await Reward.find({
//       businessId: business._id,
//       phone: { $exists: false },
//     });

//     let newReward = null;

//     for (const template of rewardTemplates) {
//       const alreadyIssued = await Reward.findOne({
//         businessId: business._id,
//         phone: normalizedPhone,
//         name: template.name,
//         redeemed: false,
//       });

//       if (!alreadyIssued && totalPoints >= template.threshold) {
//         newReward = await Reward.create({
//           businessId: business._id,
//           phone: normalizedPhone,
//           name: template.name,
//           description: template.description,
//           threshold: template.threshold,
//           code: `RW-${Math.random().toString(36).substr(2, 8).toUpperCase()}`,
//           expiresAt: new Date(
//             Date.now() +
//               (business.rewardExpiryDays || 7) * 24 * 60 * 60 * 1000
//           ),
//           redeemed: false,
//         });

//         console.log("🎁 New reward issued:", newReward.code);

//         // ✅ Deduct points
//         await PointsLedger.updateOne(
//           { businessId: business._id, phone: normalizedPhone },
//           { $inc: { points: -template.threshold } }
//         );

//         // ✅ Send SMS
//         await client.messages.create({
//           to: normalizedPhone,
//           from: fromNumber,
//           body: `🎉 Congrats! You’ve unlocked ${template.name}! Use code ${newReward.code}.`,
//         });
//       }
//     }

//     // ✅ Done
//     console.log("✅ Check-in complete.");
//     res.json({
//       ok: true,
//       phone: normalizedPhone,
//       business: business.name,
//       totalPoints: ledger.points,
//       newReward,
//     });
//   } catch (err) {
//     console.error("💥 Check-in error:", err);
//     res.status(500).json({ error: "Server error" });
//   }
// };



// // exports.checkin = async (req, res) => {
// //   try {
// //     const { phone, businessSlug } = req.body;

// //     // ✅ Normalize phone number
// //     let normalizedPhone = phone?.trim() || "";
// //     normalizedPhone = normalizedPhone.replace(/\D/g, "");
// //     if (!normalizedPhone.startsWith("1")) normalizedPhone = "1" + normalizedPhone;
// //     normalizedPhone = "+" + normalizedPhone;

// //     console.log("📥 Incoming check-in:", { original: phone, normalized: normalizedPhone, businessSlug });

// //     if (!phone || !businessSlug)
// //       return res.status(400).json({ error: "phone and businessSlug required" });

// //     // 🔹 Get business
// //     const business = await Business.findOne({ slug: businessSlug });
// //     if (!business) return res.status(404).json({ error: "Business not found" });

// //     const fromNumber =
// //       business.twilioNumber ||
// //       process.env.DEFAULT_TWILIO_NUMBER ||
// //       process.env.TWILIO_PHONE_NUMBER;

// //     // 🔹 Check existing check-in
// //     let existingCheckin = await Checkin.findOne({
// //       phone: normalizedPhone,
// //       businessId: business._id,
// //     });

// //     // 🔹 Cooldown
// //     const cooldownMinutes = 0.1;
// //     if (existingCheckin) {
// //       const minutesSinceLast =
// //         (Date.now() - new Date(existingCheckin.updatedAt)) / (1000 * 60);
// //       if (minutesSinceLast < cooldownMinutes) {
// //         const remaining = Math.ceil(cooldownMinutes - minutesSinceLast);
// //         console.log(`⏳ Cooldown active: ${remaining} minutes remaining`);
// //         return res.json({
// //           ok: false,
// //           message: `You can check in again after ${remaining} minutes.`,
// //         });
// //       }
// //     }

// //     // ✅ Update or create checkin
// //     if (existingCheckin) {
// //       existingCheckin.totalCheckins += 1;
// //       existingCheckin.pointsAwarded += 1;
// //       existingCheckin.lastCheckinAt = new Date();
// //       await existingCheckin.save();
// //       console.log("🔁 Existing check-in updated:", existingCheckin._id);
// //     } else {
// //       existingCheckin = await Checkin.create({
// //         businessId: business._id,
// //         phone: normalizedPhone,
// //         pointsAwarded: 1,
// //         totalCheckins: 1,
// //         consentGiven: true,
// //         sentCompliance: false,
// //       });
// //       console.log("💾 New check-in created:", existingCheckin._id);
// //     }

// //     // ✅ Update Points Ledger
// //     const ledger = await PointsLedger.findOneAndUpdate(
// //       { phone: normalizedPhone, businessId: business._id },
// //       {
// //         $inc: { points: 1 },
// //         $set: { lastCheckinAt: new Date() },
// //         $setOnInsert: { createdAt: new Date() },
// //       },
// //       { new: true, upsert: true }
// //     );

// //     console.log("📘 Points Ledger updated:", ledger);

// //     // ✅ Send compliance & welcome SMS for first checkin only
// //     if (!existingCheckin || existingCheckin.totalCheckins === 1) {
// //       try {
// //         await sendComplianceSms(business, normalizedPhone, fromNumber);
// //         console.log("✅ Compliance SMS sent.");

// //         const welcomeMsg =
// //           business.welcomeMessage ||
// //           `Welcome to ${business.name}! Thanks for checking in.`;

// //         await client.messages.create({
// //           to: normalizedPhone,
// //           from: fromNumber,
// //           body: welcomeMsg,
// //         });
// //         console.log("💬 Welcome SMS sent!");
// //       } catch (err) {
// //         console.error("❌ SMS sending failed:", err.message);
// //       }
// //     }

// //     // ✅ Get total points after checkin
// //     const totalPoints = ledger.points;

// //     // ✅ Fetch reward templates
// //     const rewardTemplates = await Reward.find({
// //       businessId: business._id,
// //       phone: { $exists: false },
// //     });

// //     let newReward = null;

// //     for (const template of rewardTemplates) {
// //       const alreadyIssued = await Reward.findOne({
// //         businessId: business._id,
// //         phone: normalizedPhone,
// //         name: template.name,
// //         redeemed: false,
// //       });

// //       if (!alreadyIssued && totalPoints >= template.threshold) {
// //         newReward = await Reward.create({
// //           businessId: business._id,
// //           phone: normalizedPhone,
// //           name: template.name,
// //           description: template.description,
// //           threshold: template.threshold,
// //           code: `RW-${Math.random().toString(36).substr(2, 8).toUpperCase()}`,
// //           expiresAt: new Date(
// //             Date.now() + (business.rewardExpiryDays || 7) * 24 * 60 * 60 * 1000
// //           ),
// //           redeemed: false,
// //         });

// //         console.log("🎁 New reward issued:", newReward.code);

// //         // ✅ Deduct points
// //         await PointsLedger.updateOne(
// //           { businessId: business._id, phone: normalizedPhone },
// //           { $inc: { points: -template.threshold } }
// //         );

// //         // 🟢 NEW: Log reward issuance into RewardHistory
// //         await RewardHistory.create({
// //           businessId: business._id,
// //           rewardId: newReward._id,
// //           checkinId: existingCheckin._id,
// //           phone: normalizedPhone,
// //           status: "Active",
// //         });
// //         console.log("🧾 RewardHistory entry created.");

// //         // ✅ Send SMS
// //         await client.messages.create({
// //           to: normalizedPhone,
// //           from: fromNumber,
// //           body: `🎉 Congrats! You’ve unlocked ${template.name}! Use code ${newReward.code}.`,
// //         });
// //       }
// //     }

// //     // ✅ Done
// //     console.log("✅ Check-in complete.");
// //     res.json({
// //       ok: true,
// //       phone: normalizedPhone,
// //       business: business.name,
// //       totalPoints: ledger.points,
// //       newReward,
// //     });
// //   } catch (err) {
// //     console.error("💥 Check-in error:", err);
// //     res.status(500).json({ error: "Server error" });
// //   }
// // };





//   /**
//    * 💬 POST /api/twilio/webhook
//    * Handles incoming STOP / START / HELP / OTHER messages from Twilio.
//    */
//   exports.twilioWebhook = async (req, res) => {
//     try {
//       const { From, Body, MessageSid, To } = req.body;
//       const incomingFrom = normalizePhone(From);
//       console.log("📩 Incoming Twilio message:", req.body);

//       if (!From) {
//         console.warn("⚠️ Webhook missing 'From' number, ignoring.");
//         return res.type("text/xml").send("<Response></Response>");
//       }

//       const incoming = Body ? Body.trim().toUpperCase() : "";
//       let eventType = "OTHER";
//       if (incoming.includes("STOP")) eventType = "STOP";
//       else if (incoming.includes("START")) eventType = "START";
//       else if (incoming.includes("HELP")) eventType = "HELP";

//       // 🔹 Find last check-in by phone (if any)
//       const checkin = await Checkin.findOne({ phone: incomingFrom }).sort({ createdAt: -1 });

//       // 🔹 Log inbound event
//       const inbound = await InboundEvent.create({
//         fromNumber: incomingFrom,
//         body: Body,
//         eventType,
//         checkinId: checkin ? checkin._id : null,
//         raw: req.body,
//       });

//       console.log("✅ InboundEvent saved:", inbound._id, "Type:", eventType);

//       // 🔹 Update subscription status if STOP/START
//       if (checkin) {
//         if (eventType === "STOP") checkin.unsubscribed = true;
//         else if (eventType === "START") checkin.unsubscribed = false;
//         await checkin.save();
//       }

//       // 🔹 Respond to Twilio
//       const twiml = new twilio.twiml.MessagingResponse();

//       if (eventType === "STOP") {
//         twiml.message("You have been unsubscribed. Reply START to rejoin.");
//       } else if (eventType === "START") {
//         twiml.message("You are now subscribed again. Thank you!");
//       } else if (eventType === "HELP") {
//         twiml.message("Reply START to subscribe again or STOP to unsubscribe.");
//       } else {
//         twiml.message("Thanks for your message! We'll get back to you soon.");
//       }

//       res.type("text/xml").send(twiml.toString());
//     } catch (err) {
//       console.error("💥 Webhook error:", err);
//       res.status(500).send("<Response></Response>");
//     }
//   };




//   /**
//    * 🏪 GET /api/kiosk/:slug
//    * Returns business details by slug for kiosk display.
//    */
//   exports.getKioskBySlug = async (req, res) => {
//     try {
//       const { slug } = req.params;
//       console.log(`🟢 Kiosk request for slug: ${slug}`);

//       const business = await Business.findOne({ slug });
//       if (!business) {
//         return res.status(404).json({ error: "Business not found" });
//       }

//       // 🔹 Fetch current active rewards for display
//       const activeRewards = await Reward.find({
//         businessId: business._id,
//         redeemed: false,
//         $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
//       }).sort({ createdAt: -1 });

//       res.json({
//         ok: true,
//         business,
//         activeRewards,
//         message: `Loaded kiosk for ${business.name}`,
//       });
//     } catch (err) {
//       console.error("❌ Failed to load kiosk:", err);
//       res.status(500).json({ error: "server error" });
//     }
//   };


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
 * Main check-in endpoint - creates/updates Customer record
 * ✅ MODIFIED: 24-hour cooldown for earning points
 */
// kioskController.js - checkin function
// Updated to use CheckinLog with customerId

  exports.checkin = async (req, res) => {
  try {
    const { phone, businessSlug, dateOfBirth } = req.body;

    // ========== VALIDATION ==========
    if (!phone || !businessSlug) {
      return res.status(400).json({ 
        ok: false, 
        error: "phone and businessSlug are required" 
      });
    }

    // ✅ Normalize phone number
    let normalizedPhone = phone?.trim() || "";
    normalizedPhone = normalizedPhone.replace(/\D/g, "");

    if (!normalizedPhone) {
      return res.status(400).json({ 
        ok: false, 
        error: "Invalid phone number format" 
      });
    }
    
    if (!normalizedPhone.startsWith("1")) normalizedPhone = "1" + normalizedPhone;
    normalizedPhone = "+" + normalizedPhone;

    console.log("📥 Incoming check-in:", { 
      original: phone, 
      normalized: normalizedPhone, 
      businessSlug 
    });

    // ========== GET BUSINESS ==========
    const business = await Business.findOne({ slug: businessSlug });
    if (!business) {
      return res.status(404).json({ 
        ok: false, 
        error: "Business not found" 
      });
    }

    // ========== AGE GATE CHECK ==========
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

    // ========== CHECK IF TWILIO NUMBER IS ACTIVE ==========
    if (!business.twilioNumberActive) {
      return res.status(503).json({
        ok: false,
        error: "SMS service temporarily unavailable for this business",
      });
    }

    const fromNumber =
      business.twilioNumber ||
      process.env.DEFAULT_TWILIO_NUMBER ||
      process.env.TWILIO_PHONE_NUMBER;

    if (!fromNumber) {
      console.error("❌ No Twilio number configured");
      return res.status(500).json({ 
        ok: false, 
        error: "SMS service not configured" 
      });
    }

    // ========== FIND CUSTOMER AND CHECK STATUS ==========
    let customer = await Customer.findOne({
      phone: normalizedPhone,
      businessId: business._id,
    });

    // ========== BLOCKED STATUS CHECK ==========
    if (customer && customer.subscriberStatus === 'blocked') {
      console.log("🚫 Customer is blocked:", normalizedPhone);
      
      try {
        await CheckinLog.create({
          businessId: business._id,
          customerId: customer._id,
          phone: normalizedPhone,
          countryCode: "+1",
          status: "kiosk",
          pointsAwarded: 0,
          metadata: {
            blocked: true,
            subscriberStatus: "blocked",
            attemptReason: "Customer is blocked from checking in"
          }
        });
        console.log("📝 Blocked attempt logged");
      } catch (logErr) {
        console.error("❌ Failed to log blocked attempt:", logErr);
      }

      return res.status(403).json({
        ok: false,
        error: "Your account has been blocked. Please contact the business for assistance.",
        blocked: true
      });
    }

    // ========== OPTED-OUT STATUS CHECK ==========
    if (customer && customer.subscriberStatus === 'opted-out') {
      console.log("⚠️ Customer is opted-out:", normalizedPhone);
      
      try {
        await CheckinLog.create({
          businessId: business._id,
          customerId: customer._id,
          phone: normalizedPhone,
          countryCode: "+1",
          status: "kiosk",
          pointsAwarded: 0,
          metadata: {
            optedOut: true,
            subscriberStatus: "opted-out",
            attemptReason: "Customer has opted out of service"
          }
        });
        console.log("📝 Opted-out attempt logged");
      } catch (logErr) {
        console.error("❌ Failed to log opted-out attempt:", logErr);
      }

      return res.status(403).json({
        ok: false,
        error: "You have opted out of this service. Reply START to resubscribe first.",
        optedOut: true
      });
    }

    const isFirstCheckin = !customer;
    let isNewlyUnblocked = false;

    // ========== CHECK IF RECENTLY UNBLOCKED ==========
    if (customer && customer.unblockDate) {
      const hoursSinceUnblock = (Date.now() - new Date(customer.unblockDate).getTime()) / (1000 * 60 * 60);
      if (hoursSinceUnblock < 24) {
        isNewlyUnblocked = true;
      }
    }

    // ========== 24-HOUR COOLDOWN CHECK ==========
    const cooldownHours = 24;
    let isInCooldown = false;
    let remainingHours = 0;
    let remainingMinutes = 0;

    if (customer && customer.lastCheckinAt) {
      const hoursSinceLast = (Date.now() - new Date(customer.lastCheckinAt)) / (1000 * 60 * 60);
      isInCooldown = hoursSinceLast < cooldownHours;
      
      if (isInCooldown) {
        remainingHours = Math.floor(cooldownHours - hoursSinceLast);
        remainingMinutes = Math.ceil((cooldownHours - hoursSinceLast - remainingHours) * 60);
      }
    }

    // ========== DETERMINE POINTS TO AWARD ==========
    const pointsToAward = isInCooldown ? 0 : 1;

    // ========== CREATE OR UPDATE CUSTOMER RECORD FIRST ==========
    try {
      if (customer) {
        if (isInCooldown) {
          customer.totalCheckins += 1;
          console.log(`⏳ Cooldown active: ${remainingHours}h ${remainingMinutes}m remaining. No points awarded. Total checkins: ${customer.totalCheckins}`);
        } else {
          customer.points += 1;
          customer.totalCheckins += 1;
          customer.lastCheckinAt = new Date();
          console.log(`✅ Cooldown passed. Point awarded. Total checkins: ${customer.totalCheckins}, Total points: ${customer.points}`);
        }

        if (customer.unblockDate && isNewlyUnblocked) {
          const hoursSinceUnblock = (Date.now() - new Date(customer.unblockDate).getTime()) / (1000 * 60 * 60);
          if (hoursSinceUnblock >= 24) {
            customer.unblockDate = undefined;
          }
        }

        if (dateOfBirth && !customer.ageVerified) {
          customer.ageVerified = true;
          customer.ageVerifiedAt = new Date();
        }

        await customer.save();
        console.log("🔄 Customer updated and saved:", customer._id);
      } else {
        // ✅ NEW CUSTOMER
        customer = await Customer.create({
          phone: normalizedPhone,
          countryCode: "+1",
          businessId: business._id,
          subscriberStatus: "active",
          points: 1,
          totalCheckins: 1,
          firstCheckinAt: new Date(),
          lastCheckinAt: new Date(),
          consentGiven: true,
          consentTimestamp: new Date(),
          ageVerified: !!dateOfBirth,
          ageVerifiedAt: dateOfBirth ? new Date() : undefined,
        });

        console.log("✅ New customer created:", customer._id);
      }
    } catch (err) {
      console.error("❌ Failed to update customer:", err);
      return res.status(500).json({ 
        ok: false, 
        error: "Failed to update customer record" 
      });
    }

    // ✅ CREATE CHECKIN LOG with customerId
    let checkinLog;
    try {
      const logData = {
        businessId: business._id,
        customerId: customer._id,
        phone: normalizedPhone,
        countryCode: "+1",
        status: "kiosk",
        pointsAwarded: pointsToAward,
      };

      if (isInCooldown) {
        logData.metadata = {
          cooldown: true,
          cooldownRemainingHours: remainingHours,
          cooldownRemainingMinutes: remainingMinutes,
          attemptReason: "Check-in attempted within 24-hour cooldown period",
          lastCheckinAt: customer.lastCheckinAt
        };
      }

      if (isNewlyUnblocked) {
        logData.metadata = {
          ...logData.metadata,
          newlyUnblocked: true,
          unblockDate: customer.unblockDate
        };
      }

      checkinLog = await CheckinLog.create(logData);
      console.log("💾 CheckinLog created:", checkinLog._id);
    } catch (err) {
      console.error("❌ Failed to create checkin log:", err);
    }

    // ========== SEND COMPLIANCE & WELCOME SMS ==========
    if (isFirstCheckin) {
      try {
        await sendComplianceSms(business, normalizedPhone, fromNumber);
        console.log("✅ Compliance SMS sent");
      } catch (err) {
        console.error("❌ Compliance SMS failed:", err.message);
      }

      try {
        const welcomeMsg =
          business.welcomeMessage ||
          `Welcome to ${business.name}! Thanks for checking in.`;

        await client.messages.create({
          to: normalizedPhone,
          from: fromNumber,
          body: welcomeMsg,
        });
        console.log("💬 Welcome SMS sent!");
      } catch (err) {
        console.error("❌ Welcome SMS failed:", err.message);
      }
    }

    // ✅ FETCH REWARD TEMPLATES & PROCESS REWARDS
    let newReward = null;
    
    // Check rewards based on total checkins (not cooldown-dependent)
    const rewardTemplates = await Reward.find({
      businessId: business._id,
      phone: { $exists: false },
      isActive: true,
    }).sort({ priority: 1 });

    console.log(`\n📋 Found ${rewardTemplates.length} reward templates for business`);
    console.log(`👤 Customer has ${customer.totalCheckins} checkins and ${customer.points} points\n`);

    // ========== PROCESS REWARDS ==========
    try {
      for (const template of rewardTemplates) {
        console.log(`🔍 Checking template: ${template.name}`);
        console.log(`   - Threshold: ${template.threshold} checkins`);
        console.log(`   - Customer checkins: ${customer.totalCheckins}`);
        console.log(`   - Threshold met: ${customer.totalCheckins >= template.threshold}`);
        
        // ✅ Check if reward already issued
        const alreadyIssued = await RewardHistory.findOne({
          businessId: business._id,
          customerId: customer._id,
          rewardId: template._id,
          status: { $ne: 'Redeemed' }
        });

        console.log(`   - Already issued: ${!!alreadyIssued}`);

        // Check based on TOTAL CHECKINS
        if (!alreadyIssued && customer.totalCheckins >= template.threshold) {
          console.log(`   ✅ REWARD TRIGGERED!\n`);
          
          // Generate unique reward code
          const rewardCode = `RW-${Math.random().toString(36).substr(2, 8).toUpperCase()}`;

          // ✅ Create reward instance for this customer
          const rewardInstance = await Reward.create({
            businessId: business._id,
            phone: normalizedPhone,
            name: template.name,
            description: template.description,
            threshold: template.threshold,
            code: rewardCode,
            expiresAt: template.expiryDays 
              ? new Date(Date.now() + template.expiryDays * 24 * 60 * 60 * 1000)
              : null,
            redeemed: false,
            priority: template.priority,
            isActive: true,
            discountType: template.discountType || 'none',
            discountValue: template.discountValue || 0,
          });

          console.log("🎁 Reward instance created:", rewardInstance._id);

          // ✅ Log in RewardHistory with customerId
          const rewardHistory = await RewardHistory.create({
            businessId: business._id,
            customerId: customer._id,
            rewardId: rewardInstance._id,
            checkinId: checkinLog._id,
            phone: normalizedPhone,
            status: "Active",
          });

          console.log("🧾 RewardHistory entry created successfully:");
          console.log("   - History ID:", rewardHistory._id);
          console.log("   - Customer ID:", customer._id);
          console.log("   - Reward Instance ID:", rewardInstance._id);
          console.log("   - Status:", rewardHistory.status);

          // Send reward SMS
          try {
            const expiryText = template.expiryDays 
              ? ` Valid for ${template.expiryDays} days.`
              : "";

            await client.messages.create({
              to: normalizedPhone,
              from: fromNumber,
              body: `🎉 Congrats! After ${customer.totalCheckins} check-ins, you've unlocked ${template.name}! Use code ${rewardCode}.${expiryText}`,
            });
            console.log("📱 Reward SMS sent successfully");
          } catch (err) {
            console.error("❌ Reward SMS failed:", err.message);
          }

          // Store reward data for response
          newReward = {
            _id: rewardInstance._id,
            name: template.name,
            code: rewardCode,
            description: template.description,
            expiresAt: rewardInstance.expiresAt,
            threshold: template.threshold,
            discountType: rewardInstance.discountType,
            discountValue: rewardInstance.discountValue,
          };

          console.log("🎁 Reward data prepared for response:", newReward);

          // Only issue one reward per checkin
          break;
        } else {
          console.log(`   ❌ Reward not triggered\n`);
        }
      }
    } catch (err) {
      console.error("❌ Reward processing error:", err.message);
      console.error(err.stack);
    }

    // ========== SUCCESS RESPONSE ==========
    console.log("✅ Check-in complete\n");
    
    const response = {
      ok: true,
      phone: normalizedPhone,
      business: business.name,
      totalPoints: customer.points,
      totalCheckins: customer.totalCheckins,
      pointsAwarded: pointsToAward,
      isNewCustomer: isFirstCheckin,
      isNewlyUnblocked: isNewlyUnblocked,
      subscriberStatus: customer.subscriberStatus,
      newReward: newReward,
    };

    if (isInCooldown) {
      response.cooldown = {
        active: true,
        remainingHours: remainingHours,
        remainingMinutes: remainingMinutes,
        message: `You can earn your next point in ${remainingHours}h ${remainingMinutes}m`,
        nextPointAvailableAt: new Date(new Date(customer.lastCheckinAt).getTime() + (24 * 60 * 60 * 1000))
      };
    } else if (customer.lastCheckinAt) {
      response.cooldown = {
        active: false,
        message: "Point earned! Check in again in 24 hours for your next point.",
        nextPointAvailableAt: new Date(Date.now() + (24 * 60 * 60 * 1000))
      };
    }

    res.json(response);

  } catch (err) {
    console.error("💥 Check-in error:", err);
    console.error(err.stack);

    if (err.name === "ValidationError") {
      return res.status(400).json({
        ok: false,
        error: "Invalid data provided",
        details: Object.keys(err.errors).map(key => ({
          field: key,
          message: err.errors[key].message,
        })),
      });
    }

    if (err.name === "MongoError" || err.name === "MongoServerError") {
      return res.status(500).json({
        ok: false,
        error: "Database error occurred",
      });
    }

    res.status(500).json({ 
      ok: false, 
      error: "Server error" 
    });
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

    // 🔹 Find last check-in by phone (if any)
    const checkin = await CheckinLog.findOne({ phone: incomingFrom }).sort({ createdAt: -1 });

    // 🔹 Log inbound event
    const inbound = await InboundEvent.create({
      fromNumber: incomingFrom,
      body: Body,
      eventType,
      checkinId: checkin ? checkin._id : null,
      raw: req.body,
    });

    console.log("✅ InboundEvent saved:", inbound._id, "Type:", eventType);

    // 🔹 Update subscription status if STOP/START
    if (checkin) {
      if (eventType === "STOP") checkin.unsubscribed = true;
      else if (eventType === "START") checkin.unsubscribed = false;
      await checkin.save();
    }

    // 🔹 Respond to Twilio
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

    // 🔹 Fetch current active rewards for display
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
exports.blockCustomer = async (req, res) => {
  try {
    const { customerId, reason = "Blocked by admin" } = req.body;  // ⚠️ ADD REASON
    
    if (!customerId) return res.status(400).json({ ok: false, error: "customerId is required" });

    const customer = await Customer.findById(customerId);
    if (!customer) return res.status(404).json({ ok: false, error: "Customer not found" });

    if (req.user.role === "staff") return res.status(403).json({ ok: false, error: "Staff cannot block customers" });
    if (req.user.role !== "master" && customer.businessId.toString() !== req.user.businessId.toString()) {
      return res.status(403).json({ ok: false, error: "Access denied" });
    }

    // ⚠️ Track block date and reason
    customer.subscriberStatus = "blocked";
    customer.blockDate = new Date();  // ⚠️ ADD THIS
    customer.blockReason = reason;    // ⚠️ ADD THIS
    
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
    const { reason = "Blocked by admin" } = req.body;  // ⚠️ ADD REASON

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

    // ⚠️ Track block date and reason
    customer.subscriberStatus = "blocked";
    customer.blockDate = new Date();  // ⚠️ ADD THIS
    customer.blockReason = reason;    // ⚠️ ADD THIS
    
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

    // ⚠️ RESET POINTS TO 0 when unblocking
    customer.subscriberStatus = "active";
    customer.points = 0;  // ⚠️ ADD THIS
    customer.unblockDate = new Date();  // ⚠️ ADD THIS - Track when unblocked
    
    await customer.save();

    console.log(`🔓 Customer unblocked: ${customer.phone}, Points reset to 0`);

    res.json({ 
      ok: true, 
      message: "Customer unblocked successfully. Points reset to 0.", 
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

    // ⚠️ RESET POINTS TO 0 when unblocking
    customer.subscriberStatus = "active";
    customer.points = 0;  // ⚠️ ADD THIS
    customer.unblockDate = new Date();  // ⚠️ ADD THIS
    
    await customer.save();

    console.log(`🔓 Customer unblocked: ${customer.phone}, Points reset to 0`);

    res.json({ 
      ok: true, 
      message: "Customer unblocked successfully. Points reset to 0.", 
      customer 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
};