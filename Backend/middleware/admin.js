const User = require('../models/User');

module.exports = async function requireAdmin(req, res, next) {
  try {
    const currentUser = await User.findById(req.user?.id).select('_id role').lean();
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'support')) {
      return res.status(403).json({
        error: {
          code: 'ADMIN_FORBIDDEN',
          message: 'Admin/support role is required.'
        }
      });
    }
    req.adminUser = currentUser;
    next();
  } catch (err) {
    return res.status(500).json({
      error: {
        code: 'ADMIN_CHECK_FAILED',
        message: 'Could not verify admin access.'
      }
    });
  }
};
