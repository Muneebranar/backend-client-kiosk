const jwt = require("jsonwebtoken");
const User = require("../models/AdminUser");

/**
 * 🔒 Main authentication middleware
 * Protects routes by verifying JWT and attaching user to request
 */
async function protect(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ 
      ok: false,
      error: "Unauthorized: No token provided" 
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    // ✅ Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "fallback-secret-key");

    console.log("🔐 Decoded token:", {
      id: decoded.id,
      role: decoded.role,
      email: decoded.email
    });

    // ✅ CASE 1: Default admin (master admin without DB record)
    if (decoded.id === "default-admin" || decoded.role === "master") {
      req.user = {
        id: decoded.id || "default-admin",
        role: decoded.role || "master",
        name: decoded.name || "Default Admin",
        email: decoded.email || process.env.DEFAULT_ADMIN_EMAIL || "darronwilliams@verizon.net",
        businessId: decoded.businessId,
        businessName: decoded.businessName
      };
      return next();
    }

    // ✅ CASE 2: Normal admin from database
    const user = await User.findById(decoded.id).select("-password").populate("businessId", "name slug");
    
    if (!user) {
      return res.status(401).json({ 
        ok: false,
        error: "Unauthorized: User not found" 
      });
    }

    // Attach standardized user object to request
    req.user = {
      id: user._id.toString(),
      role: user.role,
      name: user.name,
      email: user.email,
      businessId: user.businessId?._id?.toString(),
      businessName: user.businessId?.name,
      permissions: user.permissions || {}
    };

    next();
  } catch (err) {
    console.error("❌ JWT verification failed:", err.message);
    
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ 
        ok: false,
        error: "Unauthorized: Token expired" 
      });
    }
    
    return res.status(401).json({ 
      ok: false,
      error: "Unauthorized: Invalid token" 
    });
  }
}

/**
 * ⚡ Authorize specific roles
 * Usage: authorizeRoles('master', 'admin')
 */
function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        ok: false,
        error: "Unauthorized: Not authenticated" 
      });
    }

    if (!roles.includes(req.user.role)) {
      console.log(`❌ Access denied: ${req.user.role} not in [${roles.join(", ")}]`);
      return res.status(403).json({ 
        ok: false,
        error: `Forbidden: ${req.user.role} role cannot access this resource` 
      });
    }

    next();
  };
}

/**
 * 🔑 Require master admin only
 */
function requireMaster(req, res, next) {
  if (!req.user || (req.user.role !== "master" && req.user.role !== "superadmin")) {
    return res.status(403).json({ 
      ok: false,
      error: "Forbidden: Master admin access required" 
    });
  }
  next();
}

/**
 * 🏢 Ensure user has access to specific business
 * For business admins: can only access their own business
 * For master admins: can access any business
 */
function requireBusinessAccess(req, res, next) {
  const targetBusinessId = req.params.businessId || req.body.businessId || req.query.businessId;

  // Master admin has access to all businesses
  if (req.user.role === "master" || req.user.role === "superadmin") {
    return next();
  }

  // Business admin must match their assigned business
  if (!req.user.businessId) {
    return res.status(403).json({ 
      ok: false,
      error: "Forbidden: No business assigned to your account" 
    });
  }

  if (targetBusinessId && targetBusinessId !== req.user.businessId) {
    return res.status(403).json({ 
      ok: false,
      error: "Forbidden: Cannot access other business data" 
    });
  }

  next();
}

/**
 * 📋 Check specific permission
 * Usage: requirePermission('canImportCSV')
 */
function requirePermission(permission) {
  return (req, res, next) => {
    // Master admin has all permissions
    if (req.user.role === "master" || req.user.role === "superadmin") {
      return next();
    }

    // Check if user has the specific permission
    if (!req.user.permissions || !req.user.permissions[permission]) {
      return res.status(403).json({ 
        ok: false,
        error: `Forbidden: Missing permission '${permission}'` 
      });
    }

    next();
  };
}

/**
 * 🔓 Optional authentication (doesn't fail if no token)
 * Useful for routes that work for both authenticated and non-authenticated users
 */
async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    req.user = null;
    return next();
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "fallback-secret-key");

    if (decoded.id === "default-admin" || decoded.role === "master") {
      req.user = {
        id: decoded.id || "default-admin",
        role: decoded.role || "master",
        name: decoded.name || "Default Admin",
        email: decoded.email || process.env.DEFAULT_ADMIN_EMAIL,
        businessId: decoded.businessId
      };
    } else {
      const user = await User.findById(decoded.id).select("-password");
      if (user) {
        req.user = {
          id: user._id.toString(),
          role: user.role,
          name: user.name,
          email: user.email,
          businessId: user.businessId?.toString(),
          permissions: user.permissions || {}
        };
      } else {
        req.user = null;
      }
    }
  } catch (err) {
    req.user = null;
  }

  next();
}

/**
 * 📊 Rate limiting helper (for import operations)
 */
function createRateLimiter(maxRequests = 5, windowMs = 60000) {
  const requests = new Map();

  return (req, res, next) => {
    const key = req.user.id;
    const now = Date.now();
    
    if (!requests.has(key)) {
      requests.set(key, []);
    }

    const userRequests = requests.get(key);
    const recentRequests = userRequests.filter(time => now - time < windowMs);

    if (recentRequests.length >= maxRequests) {
      return res.status(429).json({
        ok: false,
        error: `Rate limit exceeded. Maximum ${maxRequests} requests per ${windowMs / 1000} seconds.`,
        retryAfter: Math.ceil((recentRequests[0] + windowMs - now) / 1000)
      });
    }

    recentRequests.push(now);
    requests.set(key, recentRequests);
    next();
  };
}

/**
 * 🛡️ Legacy alias for compatibility
 */
const authenticateAdmin = protect;

module.exports = {
  // Primary exports
  protect,
  authorizeRoles,
  requireMaster,
  requireBusinessAccess,
  requirePermission,
  optionalAuth,
  createRateLimiter,
  
  // Aliases for backward compatibility
  authenticateAdmin
};