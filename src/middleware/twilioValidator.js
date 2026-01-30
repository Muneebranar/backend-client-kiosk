const twilio = require("twilio");

module.exports = (req, res, next) => {
  // 🔓 Dev bypass
  if (process.env.NODE_ENV !== "production") {
    console.log("🧪 DEV MODE: Twilio validator skipped");
    return next();
  }

  const incomingAccountSid = req.body?.AccountSid;
  const envAccountSid = process.env.TWILIO_ACCOUNT_SID;

  // // 🧾 LOG — AccountSid comparison
  // console.log("🔍 Twilio AccountSid Check:", {
  //   incomingAccountSid: incomingAccountSid || "❌ missing",
  //   envAccountSid: envAccountSid || "❌ missing",
  //   match: incomingAccountSid === envAccountSid
  // });

  // ❌ AccountSid missing
  if (!incomingAccountSid) {
    console.warn("⚠️ Webhook blocked: AccountSid missing");
    return res.status(403).send("<Response>Forbidden</Response>");
  }

  // ❌ AccountSid mismatch
  if (incomingAccountSid !== envAccountSid) {
    console.warn("⚠️ Webhook blocked: AccountSid mismatch");
    return res.status(403).send("<Response>Forbidden</Response>");
  }

  const twilioSignature = req.headers["x-twilio-signature"];

  // 🧾 LOG — Signature presence
  console.log("🔍 Twilio Signature:", {
    present: !!twilioSignature
  });

  // ⚠️ Signature missing → allow (safe fallback)
  if (!twilioSignature) {
    console.warn("⚠️ Signature missing — allowed");
    return next();
  }

  // 🌐 URL reconstruction
  const protocol = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  const url = `${protocol}://${host}${req.originalUrl}`;

  // 🧾 LOG — URL used for validation
  console.log("🔍 Signature Validation URL:", url);

  const isValid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    twilioSignature,
    url,
    req.body
  );

  // 🧾 LOG — Validation result
  console.log("🔍 Signature valid:", isValid);

  if (!isValid) {
    console.warn("⚠️ Webhook blocked: Invalid signature");
    return res.status(403).send("<Response>Invalid signature</Response>");
  }

  console.log("✅ Twilio webhook validated successfully");
  next();
};
