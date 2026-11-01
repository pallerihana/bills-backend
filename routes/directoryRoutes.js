const r = require('express').Router(), mongoose = require('mongoose');
const Employee = require('../models/Employee'), PE = require('../models/ProjectEmployee'), Project = require('../models/Project'), Expense = require('../models/Expense');
const auth = require('../middleware/authMiddleware');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const bad = (res, m, s = 400, extra = {}) => res.status(s).json({ message: m, ...extra });
const wrap = fn => (req, res, next) => fn(req, res).catch(e => (e.code === 11000 ? bad(res, 'An employee with this ID already exists', 409) : next(e)));
const out = e => ({ _id: e._id, employeeId: e.employeeId, name: e.name, email: e.email, active: e.active });
const fields = body => ({ name: String(body.name || '').trim().replace(/\s+/g, ' '), email: String(body.email || '').trim().toLowerCase() });
const find = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) { bad(res, 'Employee not found', 404); return null; }
  const e = await Employee.findById(req.params.id);
  if (!e) bad(res, 'Employee not found', 404);
  return e;
};
r.use(auth); // administrators only

r.get('/', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80), limit = Math.min(Math.max(+req.query.limit || 50, 1), 200);
  const f = {};
  if (req.query.includeInactive !== '1') f.active = true;           // inactive employees cannot be picked for new work
  if (q) { const rx = new RegExp(esc(q), 'i'); f.$or = [{ name: rx }, { employeeId: rx }, { email: rx }]; }
  const [items, total] = await Promise.all([
    Employee.find(f, 'employeeId name email active').collation({ locale: 'en', strength: 2 }).sort({ name: 1 }).limit(limit).lean(),
    Employee.countDocuments(f)]);
  res.json({ items, total });
}));

r.post('/', wrap(async (req, res) => {
  const employeeId = String(req.body.employeeId || '').trim().toUpperCase(), { name, email } = fields(req.body);
  if (!name) return bad(res, 'Name is required');
  if (!employeeId) return bad(res, 'Employee ID is required');
  if (!/^\S{1,30}$/.test(employeeId)) return bad(res, 'Employee ID cannot contain spaces (30 characters at most)');
  if (!EMAIL.test(email)) return bad(res, 'Enter a valid email address');
  const byId = await Employee.findOne({ employeeId }, 'name'); if (byId) return bad(res, `Employee ID ${employeeId} already belongs to ${byId.name}`, 409);
  const byMail = await Employee.findOne({ email }, 'name employeeId'); if (byMail) return bad(res, `This email already belongs to ${byMail.name} (${byMail.employeeId})`, 409);
  res.status(201).json(out(await Employee.create({ employeeId, name, email, active: true })));
}));

// Update name, email or active status. The Employee ID cannot change (projects and bills refer to it).
// Projects and bills that already exist keep the name and email they were saved with.
r.put('/:id', wrap(async (req, res) => {
  const e = await find(req, res); if (!e) return;
  const { name, email } = fields(req.body);
  if (!name) return bad(res, 'Name is required');
  if (!EMAIL.test(email)) return bad(res, 'Enter a valid email address');
  const dup = await Employee.findOne({ email, _id: { $ne: e._id } }, 'name employeeId');
  if (dup) return bad(res, `This email already belongs to ${dup.name} (${dup.employeeId})`, 409);
  e.name = name; e.email = email; if (typeof req.body.active === 'boolean') e.active = req.body.active;
  await e.save();
  res.json(out(e));
}));

// Delete only if the employee was never used. Otherwise they must be marked inactive, so history stays intact.
r.delete('/:id', wrap(async (req, res) => {
  const e = await find(req, res); if (!e) return;
  const used = await Promise.all([
    PE.exists({ $or: [{ employeeRef: e._id }, { employeeId: e.employeeId }] }),
    Project.exists({ 'formMemberRefs.employeeId': e.employeeId }),
    Expense.exists({ memberIds: e.employeeId })]);
  if (used.some(Boolean)) return bad(res, `${e.name} is used in projects or bills, so they cannot be deleted. Mark them inactive instead to hide them from new selections.`, 409, { inUse: true });
  await e.deleteOne();
  res.json({ ok: true });
}));
module.exports = r;