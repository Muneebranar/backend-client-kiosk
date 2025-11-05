const debugAuth = (req, res, next) => {
  console.log('🔐 Auth Debug:', {
    method: req.method,
    path: req.path,
    userId: req.user?._id || req.user?.id,
    userRole: req.user?.role,
    userBusinessId: req.user?.businessId,
    params: req.params,
    body: req.body,
    timestamp: new Date().toISOString()
  });
  next();
};

module.exports = debugAuth;