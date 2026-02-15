const User = require('../models/User');
const { hasCapability } = require('../utils/permissions');

module.exports = async function requireAdmin(req, res, next) {
  try {
    const currentUser = await User.findById(req.user?.id).select('_id role username').lean();
    if (!currentUser || !hasCapability(currentUser.role, 'access_admin_console')) {
      return res.status(403).json({
        error: {
          code: 'ADMIN_FORBIDDEN',
          message: 'Admin, support, or moderator role is required.'
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
