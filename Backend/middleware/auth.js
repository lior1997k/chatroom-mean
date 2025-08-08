const { verifyToken } = require('../utils/jwt');

module.exports = function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    req.user = verifyToken(token); // { id, username, iat, exp }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};
