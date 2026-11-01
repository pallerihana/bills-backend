// Public routes for the COMMON form link (WhatsApp / Copy Form Link). They never accept bills.
// A person picks their name and proves it with their Employee ID + registered email, then goes to their own personal
// secure link, so every bill is still submitted through the existing personal-token route (numbering, Cloudinary,
// lock and deadline rules all stay exactly as they were).
const r = require('express').Router(), mongoose = require('mongoose');
const Project = require('../models/Project'), PE = require('../models/ProjectEmployee'), Employee = require('../models/Employee');
const audit = require('../services/auditService'), identity = require('../utils/identity');
const { blockReason } = require('../utils/fillWindow');
const h = fn => (req, res, next) => fn(req, res, next).catch(next);
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const byShare = async st => (await Project.findOne({ shareToken: String(st).slice(0, 100) })) || Promise.reject(err('This link is not valid', 404));
const mask = e => { const [u, d] = String(e).split('@'); return `${u[0] || '?'}***@${d || ''}`; };

// Names of the employees registered for THIS project (no emails, no IDs)
r.get('/:st', h(async (req, res) => {
  const p = await byShare(req.params.st);
  const rows = await PE.find({ projectId: p._id }, 'name email').collation({ locale: 'en', strength: 2 }).sort({ name: 1 }).lean();
  const label = e => e.name || mask(e.email), total = {}, seen = {};
  rows.forEach(e => { total[label(e)] = (total[label(e)] || 0) + 1; });
  const employees = rows.map(e => { const n = label(e); seen[n] = (seen[n] || 0) + 1; return { id: String(e._id), name: total[n] > 1 ? `${n} (${seen[n]})` : n }; }); // same names get (1), (2)
  res.json({ project: { collegeName: p.collegeName, startDate: p.startDate, endDate: p.endDate, subject: p.subject },
    closed: !!blockReason(p), closesOn: p.formEndDate, employees });
}));

r.post('/:st/verify', h(async (req, res) => {
  const p = await byShare(req.params.st), pid = String(req.body.peId || '');
  const pe = mongoose.isValidObjectId(pid) ? await PE.findOne({ _id: pid, projectId: p._id }) : null; // an employee of another project never matches
  if (!pe) throw err('Please select your name from the list');
  const expectedId = pe.employeeId || (await Employee.findOne({ email: pe.email }, 'employeeId'))?.employeeId; // older rows: look the ID up by email
  const d = identity.decide(pe, req.body, expectedId);
  if (d.result === 'locked') throw err(`Too many wrong attempts. Try again in ${d.minutes} minute(s), or use the personal link from your email.`, 429);
  await PE.updateOne({ _id: pe._id }, { $set: d.set });
  if (d.result === 'fail') {
    if (d.locked) {
      await audit.log(p._id, audit.employee(pe), 'PEOPLE', 'VERIFY_LOCKED', `was locked out of the shared form link for ${identity.LOCK_MINUTES} minutes after too many wrong verification attempts`);
      throw err(`Too many wrong attempts. This name is locked for ${identity.LOCK_MINUTES} minutes. You can still use the personal link from your email.`, 429);
    }
    throw err(`The Employee ID or email does not match this name. ${d.left} attempt(s) left.`, 403);
  }
  await audit.log(p._id, audit.employee(pe), 'PEOPLE', 'IDENTITY_VERIFIED', 'verified their identity through the shared form link');
  res.json({ token: pe.formToken });
}));
module.exports = r;