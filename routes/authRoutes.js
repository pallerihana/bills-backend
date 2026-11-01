const r = require('express').Router(), bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken'), mongoose = require('mongoose');
const User = require('../models/User'), Project = require('../models/Project'), auth = require('../middleware/authMiddleware');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const bad = (res, m, s = 400, extra = {}) => res.status(s).json({ message: m, ...extra });
const wrap = fn => (req, res, next) => fn(req, res).catch(e => (e.code === 11000 ? bad(res, 'An admin with this email already exists', 409) : next(e)));
const fields = b => ({ name: String(b.name || '').trim().replace(/\s+/g, ' '), email: String(b.email || '').trim().toLowerCase(), password: String(b.password || '') });
const pwError = p => (p.length < 8 ? 'Password must be at least 8 characters' : Buffer.byteLength(p) > 72 ? 'Password is too long (72 characters at most)' : ''); // bcrypt ignores bytes after 72
const find = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) { bad(res, 'Admin not found', 404); return null; }
  const u = await User.findById(req.params.id);
  if (!u) bad(res, 'Admin not found', 404);
  return u;
};

r.post('/login', async (req, res, next) => {
  try {
    const { email = '', password = '' } = req.body;
    const u = await User.findOne({ email: email.toLowerCase().trim() });
    if (!u || !(await bcrypt.compare(password, u.password))) return res.status(401).json({ message: 'Invalid email or password' });
    const token = jwt.sign({ id: u._id, email: u.email }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, user: { name: u.name, email: u.email } });
  } catch (e) { next(e); }
});

// ---- Admin management: every route below needs a logged-in admin. Passwords are hashed and never returned. ----
r.post('/admins', auth, wrap(async (req, res) => {
  const { name, email, password } = fields(req.body);
  if (!name) return bad(res, 'Name is required');
  if (!EMAIL.test(email)) return bad(res, 'Enter a valid email address');
  if (pwError(password)) return bad(res, pwError(password));
  if (await User.exists({ email })) return bad(res, 'An admin with this email already exists', 409);
  const u = await User.create({ name, email, password: await bcrypt.hash(password, 10) });
  res.status(201).json({ name: u.name, email: u.email });
}));

r.get('/admins', auth, wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80), f = {};
  if (q) { const rx = new RegExp(esc(q), 'i'); f.$or = [{ name: rx }, { email: rx }]; }
  const items = await User.find(f, 'name email').collation({ locale: 'en', strength: 2 }).sort({ name: 1 }).limit(200).lean();
  res.json({ items: items.map(u => ({ _id: u._id, name: u.name, email: u.email, isYou: String(u._id) === String(req.user.id) })) });
}));

// Update name / email, and the password only when a new one is sent
r.put('/admins/:id', auth, wrap(async (req, res) => {
  const u = await find(req, res); if (!u) return;
  const { name, email, password } = fields(req.body);
  if (!name) return bad(res, 'Name is required');
  if (!EMAIL.test(email)) return bad(res, 'Enter a valid email address');
  if (password && pwError(password)) return bad(res, pwError(password));
  if (await User.exists({ email, _id: { $ne: u._id } })) return bad(res, 'An admin with this email already exists', 409);
  u.name = name; u.email = email; if (password) u.password = await bcrypt.hash(password, 10);
  await u.save();
  res.json({ name: u.name, email: u.email });
}));

// You cannot delete yourself. If the admin owns projects they must be handed to you first (?transfer=1), so no project is lost.
r.delete('/admins/:id', auth, wrap(async (req, res) => {
  const u = await find(req, res); if (!u) return;
  if (String(u._id) === String(req.user.id)) return bad(res, 'You cannot delete the account you are logged in with.');
  const owned = await Project.countDocuments({ createdBy: u._id });
  if (owned && req.query.transfer !== '1')
    return bad(res, `${u.name} owns ${owned} project${owned === 1 ? '' : 's'}. Transfer ${owned === 1 ? 'it' : 'them'} to you and delete this admin?`, 409, { needsTransfer: true, projects: owned });
  if (owned) await Project.updateMany({ createdBy: u._id }, { createdBy: req.user.id });
  await u.deleteOne();
  res.json({ ok: true, transferred: owned });
}));
module.exports = r;