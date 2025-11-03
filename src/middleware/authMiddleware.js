const jwt = require("jsonwebtoken");
const User = require("../models/AdminUser");

// 🔒 Middleware to protect routes (check JWT and attach user)
async function protect(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    // ✅ Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "fallback-secret-key");

    // ✅ CASE 1: Default admin (no DB lookup needed)
    if (decoded.id === "default-admin") {
      req.user = {
        id: "default-admin",
        role: "superadmin",
        name: "Default Admin",
        email: process.env.DEFAULT_ADMIN_EMAIL || "admin@example.com",
      };
      return next();
    }

    // ✅ CASE 2: Normal admin from database
    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      return res.status(401).json({ error: "Unauthorized: User not found" });
    }

    req.user = user; // Attach user to request
    next();
  } catch (err) {
    console.error("❌ JWT verification failed:", err.message);
    return res.status(401).json({ error: "Unauthorized: Invalid or expired token" });
  }
}

// ⚡ Middleware to authorize roles
function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden: Access denied" });
    }
    next();
  };
}

module.exports = { protect, authorizeRoles };
