// Public routes: one reusable link per employee and project.
// Everything is looked up from the token, so an employee can only ever see or touch their own bills.
const r = require('express').Router();
const Project = require('../models/Project'), PE = require('../models/ProjectEmployee'), Expense = require('../models/Expense');
const SubmissionClaim = require('../models/SubmissionClaim');
const upload = require('../middleware/uploadMiddleware');
const store = require('../services/proofStorage');
const audit = require('../services/auditService');
const { resolveMembers } = require('../utils/members');
const { proofsOf, proofFields } = require('../utils/proofs');
const { blockReason } = require('../utils/fillWindow');
const MSG = "Proof file is no longer available. This project's temporary proof files were automatically removed 7 days after the form submission deadline.";
const h = fn => (req, res, next) => fn(req, res, next).catch(next);
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const load = async token => (await PE.findOne({ formToken: token })) || Promise.reject(err('This link is not valid', 404));
const open = async pe => { const p = await Project.findById(pe.projectId), why = blockReason(p); if (why) throw err(why, 410); return p; }; // deadline OR project lock
const mine = pe => ({ projectId: pe.projectId, employeeEmail: pe.email, billType: { $ne: 'COMPANY' } }); // scope of "my bills"

// Link info + this employee's own bills. When the deadline has passed or the project is locked, "closed" is true:
// the employee can still see their bills for confirmation but cannot submit.
r.get('/:token', h(async (req, res) => {
  const pe = await load(req.params.token), p = await Project.findById(pe.projectId);
  const list = await Expense.find(mine(pe)).sort({ billNo: 1 });
  res.json({ name: pe.name, email: pe.email, status: pe.status, closed: !!blockReason(p), closesOn: p.formEndDate, members: p.formMembers,
    memberOptions: (p.formMemberRefs || []).map(x => ({ id: x.employeeId, name: x.name })),
    bills: list.map(x => {
      const ps = proofsOf(x);
      return { _id: x._id, billNo: x.billNo, date: x.date, reason: x.reason, amount: x.amount, paidBy: x.paidBy, members: x.members, totalMembers: x.totalMembers,
        status: x.status || 'SUBMITTED', rejectionReason: x.rejectionReason || '',
        proofs: ps.map(q => ({ name: q.originalName, available: q.available })),               // names only, never Cloudinary ids or links
        proofAvailable: ps.some(q => q.available), proofName: x.proofOriginalName };
    }),
    project: { collegeName: p.collegeName, startDate: p.startDate, endDate: p.endDate, subject: p.subject } });
}));

// View one of MY proofs (never another employee's, never a company bill). ?i= is the proof number, starting at 0.
r.get('/:token/bills/:bid/proof', h(async (req, res) => {
  const pe = await load(req.params.token);
  const x = await Expense.findOne({ _id: req.params.bid, ...mine(pe) });
  if (!x) throw err('Bill not found', 404);
  const got = await store.readProofAt(x, Math.max(0, parseInt(req.query.i, 10) || 0));
  if (!got) throw err(MSG, 410);
  res.set('Cache-Control', 'private, no-store').type(got.mime).send(got.buf);
}));

r.post('/:token/respond', h(async (req, res) => {
  const pe = await load(req.params.token); await open(pe);
  if (req.body.answer !== 'no') throw err('Invalid answer');
  if (await Expense.exists(mine(pe))) throw err('You have already submitted bills, so No Bill cannot be set');
  pe.status = 'No Bill'; pe.respondedAt = new Date(); await pe.save();
  await audit.log(pe.projectId, audit.employee(pe), 'PEOPLE', 'NO_BILL', 'responded: no bills to submit');
  res.json({ status: pe.status });
}));

// Submit ONE bill with one or more proof files (all sent as the field "proof"). Always exactly one bill and one bill number.
r.post('/:token', (req, res, next) => upload(req, res, e => (e ? next(err(upload.explain(e))) : next())), h(async (req, res) => {
  const { date, reason, paidBy, amount } = req.body;
  const amt = Number(amount), requestId = String(req.body.requestId || '').trim();
  if (!date || isNaN(new Date(date))) throw err('Date is required');
  if (!reason?.trim()) throw err('Reason is required');
  if (!paidBy?.trim()) throw err('Paid By is required');
  if (!(amt > 0)) throw err('Amount must be greater than zero');
  const files = upload.check(req.files);                                  // 1 to 6 files, size limits
  if (requestId.length < 8) throw err('Missing request id, please reload the page');
  const pe = await load(req.params.token), proj = await open(pe);         // backend enforces deadline + lock on every submit
  const { members, memberIds } = resolveMembers(proj, req.body);
  if (!members.length) throw err('Add at least one member');

  // Claim the request id first: a double-tap returns the same bill and never uploads twice
  try { await SubmissionClaim.create({ requestId }); }
  catch (e) {
    if (e.code !== 11000) throw e;
    for (let i = 0; i < 10; i++) {
      const c = await SubmissionClaim.findOne({ requestId });
      if (c?.expenseId) { const x = await Expense.findById(c.expenseId); return res.json({ message: 'Expense submitted successfully.', billNo: x.billNo, amount: x.amount, duplicate: true }); }
      await sleep(300);
    }
    throw err('Your bill is still being saved. Please wait a moment before trying again.', 409);
  }

  let fresh, x;
  try {
    fresh = await store.uploadMany(files, pe.projectId, 'employee-proofs');       // every proof is stored BEFORE the bill is created
    const p = await Project.findByIdAndUpdate(pe.projectId, { $inc: { nextBillNo: 1 }, proofCleanupCompleted: false }); // atomic: old value = this bill's number
    x = await Expense.create({ ...proofFields(fresh), projectId: pe.projectId, billType: 'EMPLOYEE', employeeEmail: pe.email, projectEmployeeId: pe._id, billNo: p.nextBillNo,
      date, reason: reason.trim(), members, memberIds, totalMembers: members.length, paidBy: paidBy.trim(), amount: amt });
  } catch (e) {
    if (fresh) await store.destroyMany(fresh).catch(() => {});                   // no orphaned files in Cloudinary
    await SubmissionClaim.deleteOne({ requestId });
    throw e;
  }
  await SubmissionClaim.updateOne({ requestId }, { expenseId: x._id });
  await PE.updateOne({ _id: pe._id }, { status: 'Submitted', respondedAt: new Date() });
  await audit.log(pe.projectId, audit.employee(pe), 'BILL', 'BILL_CREATED', `created Bill #${x.billNo} · Amount: ${audit.money(x.amount)} · ${x.reason} · ${fresh.length} proof file${fresh.length === 1 ? '' : 's'}`, { billNo: x.billNo });
  res.status(201).json({ message: 'Expense submitted successfully.', billNo: x.billNo, amount: x.amount });
}));
module.exports = r;