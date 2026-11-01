const jwt = require('jsonwebtoken'), User = require('../models/User');
// Verifies the token AND that the admin account still exists, so a deleted admin is locked out immediately
module.exports = async (req, res, next) => {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    req.user = jwt.verify(t, process.env.JWT_SECRET);
    if (!(await User.exists({ _id: req.user.id }))) throw new Error('account removed');
  } catch { return res.status(401).json({ message: 'Please log in again' }); }
  next();
};