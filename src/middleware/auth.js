const jwt = require('jsonwebtoken');
const User = require('../models/AdminUser');

// 🔒 Middleware to protect routes (check JWT and attach user)
async function protect(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "muneeb");

    console.log('🔐 Decoded token:', decoded);

    // ✅ CASE 1: Master admin (no database record)
    if (decoded.id === 'default-admin' && decoded.role === 'master') {
      req.user = {
        id: 'default-admin',
        role: 'master',
        email: process.env.DEFAULT_ADMIN_EMAIL || 'darronwilliams@verizon.net',
        name: 'Master Admin',
        businessId: null // Master admin has access to all businesses
      };
      console.log('✅ Master admin authenticated');
      return next();
    }

    // ✅ CASE 2: Regular database users (admin/staff)
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user) {
      console.error('❌ User not found in database:', decoded.id);
      return res.status(401).json({ ok: false, error: 'Unauthorized: User not found' });
    }

    // Attach user with consistent structure
    req.user = {
      id: user._id,
      role: user.role,
      email: user.email,
      name: user.name,
      businessId: user.businessId
    };

    console.log('✅ Database user authenticated:', user.email);
    next();
  } catch (err) {
    console.error('❌ JWT verification failed:', err.message);
    
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Token expired' });
    }
    
    return res.status(401).json({ ok: false, error: 'Unauthorized: Invalid token' });
  }
}

// ⚡ Middleware to authorize roles
function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    
    if (!roles.includes(req.user.role)) {
      console.log(`❌ Access denied. User role: ${req.user.role}, Required: ${roles.join(', ')}`);
      return res.status(403).json({ ok: false, error: 'Forbidden: Access denied' });
    }
    
    console.log(`✅ Role authorized: ${req.user.role}`);
    next();
  };
}

module.exports = { protect, authorizeRoles };