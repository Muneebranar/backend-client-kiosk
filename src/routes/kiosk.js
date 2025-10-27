const express = require("express");
const router = express.Router();

const { sendComplianceSms } = require("../services/twilioService");
const Business = require("../models/Business");
const Checkin = require("../models/Checkin");
const { twilioWebhook, getKioskBySlug } = require("../controllers/kioskController");
const { checkin } = require("../controllers/kioskController");
const twilioValidator = require("../middleware/twilioValidator");

/**
 * 🧩 Kiosk Check-In Route
 * Handles user check-in from a business kiosk.
 * Sends compliance SMS and stores check-in details.
 */
router.post("/checkin",checkin);

/**
 * ✅ Twilio Webhook Route
 * Handles inbound SMS or delivery status callbacks.
 */
router.post("/webhook/twilio", twilioValidator, twilioWebhook);

/**
 * ✅ Kiosk by Slug
 * Returns business kiosk page details by slug.
 */
router.get("/:slug", getKioskBySlug);

module.exports = router;
