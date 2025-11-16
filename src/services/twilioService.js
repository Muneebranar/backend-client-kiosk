const twilio = require("twilio");

// ✅ Initialize Twilio client
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/**
 * 📜 Send Compliance SMS
 * - Uses business Twilio number if available
 * - Falls back to default
 */
async function sendComplianceSms(business, toPhone, fromNumber) {
  const from =
    fromNumber ||
    business.twilioNumber ||
    process.env.DEFAULT_TWILIO_NUMBER ||
    process.env.TWILIO_PHONE_NUMBER;

  if (!from) throw new Error("No Twilio 'from' number defined!");

  const body = `${
    business.name || "Business"
  }: Thanks for checking in! Reply STOP to unsubscribe or HELP for support.`;

  console.log("📞 Sending Twilio SMS:", { from, to: toPhone, body });

  try {
    const result = await client.messages.create({ to: toPhone, from, body });
    console.log("✅ Twilio message sent:", result.sid);
    return { sid: result.sid, from, to: toPhone, status: "sent" };
  } catch (err) {
    // 🧠 Handle common Twilio errors gracefully
    if (err.code === 21610) {
      console.log("❌ User unsubscribed (STOP). Skipping SMS.");
      return { status: "unsubscribed", to: toPhone };
    }
    if (err.code === 21211 || err.message?.includes("Invalid 'To' Phone Number")) {
      console.log("❌ Invalid or non-SMS phone number:", toPhone);
      return { status: "invalid_number", to: toPhone };
    }

    console.error("❌ Twilio unexpected error:", err.message || err);
    return { status: "failed", error: err.message };
  }
}

/**
 * 💬 Send General SMS (Welcome / Reward / Custom)
 */
async function sendSms(to, from, message) {
  const actualFrom =
    from ||
    process.env.DEFAULT_TWILIO_NUMBER ||
    process.env.TWILIO_PHONE_NUMBER;

  if (!actualFrom) throw new Error("No Twilio 'from' number configured!");

  console.log("📲 Sending general SMS:", { from: actualFrom, to, message });

  try {
    const result = await client.messages.create({
      to,
      from: actualFrom,
      body: message,
    });
    console.log("✅ General SMS sent:", result.sid);
    return { sid: result.sid, from: actualFrom, to, status: "sent" };
  } catch (err) {
    if (err.code === 21610) {
      console.log("❌ User unsubscribed (STOP). Skipping SMS.");
      return { status: "unsubscribed", to };
    }
    if (err.code === 21211 || err.message?.includes("Invalid 'To' Phone Number")) {
      console.log("❌ Invalid or non-SMS phone number:", to);
      return { status: "invalid_number", to };
    }

    console.error("❌ Failed to send general SMS:", err.message);
    return { status: "failed", error: err.message };
  }
}

/**
 * 📨 Send SMS (Standardized interface for CSV imports and bulk operations)
 * This function is specifically designed for the import system
 * 
 * @param {Object} params - SMS parameters
 * @param {string} params.to - Recipient phone number
 * @param {string} params.body - Message content
 * @param {string} params.businessId - Business ID (optional, for logging/tracking)
 * @returns {Promise<Object>} Result object with status
 */
async function sendSMS({ to, body, businessId }) {
  const from = process.env.DEFAULT_TWILIO_NUMBER || process.env.TWILIO_PHONE_NUMBER;
  
  if (!from) {
    throw new Error("No Twilio 'from' number configured!");
  }

  console.log("📲 Sending SMS via sendSMS:", { 
    from, 
    to, 
    businessId,
    bodyPreview: body.substring(0, 50) + '...' 
  });

  try {
    const result = await client.messages.create({
      to,
      from,
      body,
    });
    
    console.log("✅ SMS sent successfully:", result.sid);
    
    return { 
      sid: result.sid, 
      from, 
      to, 
      status: "sent",
      success: true 
    };
  } catch (err) {
    // Handle Twilio-specific errors
    if (err.code === 21610) {
      console.log("❌ User unsubscribed (STOP). Skipping SMS:", to);
      return { status: "unsubscribed", to, success: false };
    }
    
    if (err.code === 21211 || err.message?.includes("Invalid 'To' Phone Number")) {
      console.log("❌ Invalid or non-SMS phone number:", to);
      return { status: "invalid_number", to, success: false };
    }

    // For other errors, log and throw so the import code can handle it
    console.error("❌ Failed to send SMS to", to, ":", err.message);
    throw new Error(`Twilio SMS failed: ${err.message}`);
  }
}

module.exports = {
  client,
  sendComplianceSms,
  sendSms,
  sendSMS, // ✅ Export the new standardized function
};