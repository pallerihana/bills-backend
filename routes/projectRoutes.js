const r = require('express').Router(), crypto = require('crypto');
const { cleanTags } = require('../utils/tags');
const Project = require('../models/Project'), PE = require('../models/ProjectEmployee'), Expense = require('../models/Expense'), AuditLog = require('../models/AuditLog');
const auth = require('../middleware/authMiddleware'), upload = require('../middleware/uploadMiddleware');
const { sendForms, sendReminder } = require('../services/emailService');
const { buildExcel } = require('../services/excelService');
const { buildProofDoc } = require('../services/documentService');
const store = require('../services/proofStorage');

const Employee = require('../models/Employee'), { resolveMembers } = require('../utils/members');
const { proofFields } = require('../utils/proofs'), { applyProofs } = require('../services/proofEdit');
const audit = require('../services/auditService'), { money } = audit;
const { windowOf, expired, remindWindow, cleanupDateOf, fmt } = require('../utils/fillWindow');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MSG = "Proof file is no longer available. This project's temporary proof files were automatically removed 7 days after the form submission deadline.";
const STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'REIMBURSED'];
const STATUS_TEXT = { SUBMITTED: 'Submitted', UNDER_REVIEW: 'Under Review', APPROVED: 'Approved', REJECTED: 'Rejected', REIMBURSED: 'Reimbursed' };
const h = fn => (req, res, next) => fn(req, res, next).catch(next);
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const own = async req => (await Project.findOne({ _id: req.params.id, createdBy: req.user.id })) || Promise.reject(err('Project not found', 404));
const lock = p => { if (p.locked) throw err('This project is locked. Unlock it to make changes.'); };
const nameMap = async pid => Object.fromEntries((await PE.find({ projectId: pid })).map(e => [e.email, e.name || '']));
const up = (req, res, next) => upload(req, res, e => (e ? next(err(upload.explain(e))) : next()));
const reopenCleanup = pid => Project.updateOne({ _id: pid }, { proofCleanupCompleted: false, $unset: { proofCleanupCompletedAt: 1 } });
const log = (req, p, cat, action, msg, meta) => audit.log(p._id, audit.admin(req), cat, action, msg, meta);
const ymd = d => new Date(d).toISOString().slice(0, 10);
const changes = (b, a) => [
  b.amount !== a.amount && `Amount: ${money(b.amount)} → ${money(a.amount)}`,
  b.date !== a.date && `Date: ${fmt(b.date)} → ${fmt(a.date)}`,
  b.reason !== a.reason && `Reason: "${b.reason}" → "${a.reason}"`,
  b.paidBy !== a.paidBy && `Paid By: ${b.paidBy} → ${a.paidBy}`,
  b.members !== a.members && 'Members changed'].filter(Boolean);
r.use(auth);

r.get('/stats', h(async (req, res) => {
  const ps = await Project.find({ createdBy: req.user.id }), ids = ps.map(p => p._id), now = new Date();
  const [emps, all] = await Promise.all([
    PE.find({ projectId: { $in: ids } }, 'projectId status sentAt'),
    Expense.find({ projectId: { $in: ids } }, 'projectId amount date billType status')]);
  const per = Object.fromEntries(ps.map(p => [p._id, { _id: p._id, name: p.collegeName, amount: 0, bills: 0, submitted: 0, noBill: 0, pending: 0, pendingSent: 0, toReview: 0, approved: 0, employees: 0, companyTotal: 0 }])); // NEW: employees, companyTotal
  emps.forEach(e => { const x = per[e.projectId]; if (!x) return; x.employees++; if (e.status === 'Submitted') x.submitted++; else if (e.status === 'No Bill') x.noBill++; else { x.pending++; if (e.sentAt) x.pendingSent++; } }); // NEW: x.employees++
  const rv = Object.fromEntries(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'REIMBURSED'].map(k => [k, { count: 0, amount: 0 }]));
  const monthly = {}; let companyTotal = 0, companyBills = 0;
  all.forEach(e => {
    const x = per[e.projectId]; if (!x) return;
    if (e.billType === 'COMPANY') { companyTotal += e.amount; companyBills++; x.companyTotal += e.amount; return; } // NEW: x.companyTotal += e.amount
    const s = e.status || 'SUBMITTED'; rv[s].count++; rv[s].amount += e.amount;
    if (s === 'SUBMITTED' || s === 'UNDER_REVIEW') x.toReview++;
    if (s === 'APPROVED') x.approved++;
    if (s === 'REJECTED') return; // rejected bills are not counted in totals
    x.amount += e.amount; x.bills++;
    const k = e.date.toISOString().slice(0, 7); monthly[k] = (monthly[k] || 0) + e.amount;
  });
  const attention = [];
  ps.forEach(p => {
    const x = per[p._id], add = (type, text) => attention.push({ type, projectId: p._id, project: p.collegeName, text });
    if (remindWindow(p) && x.pendingSent > 0) add('DEADLINE', `${x.pendingSent} employee(s) have not responded and the form closes soon`);
    if (expired(p) && x.pending > 0 && !p.locked) add('EXPIRED', `Deadline passed with ${x.pending} employee(s) still pending`);
    if (x.toReview > 0 && !p.locked) add('REVIEW', `${x.toReview} bill(s) waiting for review`);
    if (x.approved > 0 && !p.locked) add('REIMBURSE', `${x.approved} approved bill(s) awaiting reimbursement`);
  });
  const list = Object.values(per), tot = k => list.reduce((s, p) => s + p[k], 0), active = ps.filter(p => !p.endDate || p.endDate >= now).length;
  res.json({ totalProjects: ps.length, activeProjects: active, completedProjects: ps.length - active, lockedProjects: ps.filter(p => p.locked).length,
    totalEmployees: emps.length, submitted: tot('submitted'), noBill: tot('noBill'), formsPending: tot('pending'),
    formsCompleted: tot('submitted') + tot('noBill'), totalBills: tot('bills'), totalAmount: tot('amount'),
    companyBills, companyTotal, grandTotal: tot('amount') + companyTotal, review: rv, attention,
    projects: list, monthly: Object.entries(monthly).sort().map(([month, amount]) => ({ month, amount })) });
}));

// Latest activity across all my projects, for the dashboard
r.get('/activity/recent', h(async (req, res) => {
  const ps = await Project.find({ createdBy: req.user.id }, 'collegeName'), name = Object.fromEntries(ps.map(p => [p._id, p.collegeName]));
  const items = await AuditLog.find({ projectId: { $in: ps.map(p => p._id) } }).sort({ createdAt: -1 }).limit(8).lean();
  res.json(items.map(i => ({ ...i, project: name[i.projectId] })));
}));

r.get('/', h(async (req, res) => res.json(await Project.find({ createdBy: req.user.id }).sort({ startDate: -1 }))));

r.post('/', h(async (req, res) => {
  const { collegeName, startDate, endDate } = req.body;
  const tags = cleanTags(req.body.tags, req.body.subject);
  const hasEnd = !!endDate; // the end date can be left out when only the semester or year is known
  if (!collegeName?.trim() || !startDate) throw err('College name and start date are required');
  if (isNaN(new Date(startDate))) throw err('Start date is not valid');
  if (hasEnd && isNaN(new Date(endDate))) throw err('End date is not valid');
  if (hasEnd && new Date(endDate) < new Date(startDate)) throw err('End date cannot be before start date');
  const p = await Project.create({ collegeName, startDate, endDate: hasEnd ? endDate : undefined, tags, subject: tags.join(', '), createdBy: req.user.id });
  await log(req, p, 'PROJECT', 'PROJECT_CREATED', `created the project "${p.collegeName}"`);
  res.status(201).json(p);
}));

r.get('/:id', h(async (req, res) => {
  const project = await own(req);
    if (!project.shareToken) { // created once, atomically, so two page loads can never produce two different links
    await Project.updateOne({ _id: project._id, shareToken: { $in: [null, ''] } }, { $set: { shareToken: crypto.randomBytes(24).toString('hex') } });
    project.shareToken = (await Project.findById(project._id, 'shareToken')).shareToken;
  }
  const [employees, all] = await Promise.all([PE.find({ projectId: project._id }).sort({ _id: 1 }), Expense.find({ projectId: project._id }).sort({ billNo: 1 })]);
  const expenses = all.filter(e => e.billType !== 'COMPANY'), company = all.filter(e => e.billType === 'COMPANY').sort((a, b) => b.billNo - a.billNo);
  const counted = expenses.filter(e => e.status !== 'REJECTED'); // rejected bills stay visible but are not counted in totals
  const by = {}, nm = {};
  employees.forEach(e => nm[e.email] = e.name || '');
  counted.forEach(e => { const b = by[e.employeeEmail] || (by[e.employeeEmail] = { bills: 0, amount: 0 }); b.bills++; b.amount += e.amount; });
  const count = s => employees.filter(e => e.status === s).length, rw = remindWindow(project), win = windowOf(project);
  const empTotal = counted.reduce((s, e) => s + e.amount, 0), coTotal = company.reduce((s, c) => s + c.amount, 0);
  const st = k => expenses.filter(e => (e.status || 'SUBMITTED') === k), sum = a => a.reduce((t, e) => t + e.amount, 0);
  res.json({ project, shareUrl: `${process.env.CLIENT_URL}/expense-form/shared/${project.shareToken}`, fill: { ...win, expired: expired(project), remindOpen: rw },
    expenses: expenses.map(e => ({ ...e.toObject(), status: e.status || 'SUBMITTED', employeeName: nm[e.employeeEmail] || '' })),
    companyBills: company.map(c => ({ ...c.toObject(), billLabel: `C-${-c.billNo}` })),
    employees: employees.map(e => ({ _id: e._id, name: e.name || '', email: e.email, employeeId: e.employeeId || '', status: e.status, sentAt: e.sentAt,
      bills: by[e.email]?.bills || 0, totalAmount: by[e.email]?.amount || 0, reminderCount: e.reminderCount || 0, lastReminderAt: e.lastReminderAt,
      canRemind: rw && !project.locked && e.status === 'Pending' && !!e.sentAt })),
    stats: { employees: employees.length, sent: employees.filter(e => e.sentAt).length, submitted: count('Submitted'), noBill: count('No Bill'), pending: count('Pending'),
      totalBills: counted.length, totalAmount: empTotal, companyBills: company.length, companyTotal: coTotal, grandTotal: empTotal + coTotal,
      review: { submitted: st('SUBMITTED').length, underReview: st('UNDER_REVIEW').length, approved: st('APPROVED').length, rejected: st('REJECTED').length, reimbursed: st('REIMBURSED').length,
        approvedAmount: sum(st('APPROVED')), reimbursedAmount: sum(st('REIMBURSED')), rejectedAmount: sum(st('REJECTED')) } } });
}));

// Activity history (read-only), newest first
r.get('/:id/audit', h(async (req, res) => {
  const p = await own(req), limit = Math.min(+req.query.limit || 30, 200), skip = Math.max(+req.query.skip || 0, 0);
  const q = { projectId: p._id }; if (['BILL', 'REVIEW', 'PROJECT', 'PEOPLE'].includes(req.query.category)) q.category = req.query.category;
  const [items, total] = await Promise.all([AuditLog.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), AuditLog.countDocuments(q)]);
  res.json({ items, total });
}));

r.put('/:id/form', h(async (req, res) => {
  const p = await own(req); lock(p);
    let members, refs = [];
  if (Array.isArray(req.body.memberIds)) {          // chosen from the employee directory: names come from the database, not the browser
    const ids = [...new Set(req.body.memberIds.map(x => String(x).trim().toUpperCase()).filter(Boolean))];
    const found = await Employee.find({ employeeId: { $in: ids } }), byId = Object.fromEntries(found.map(e => [e.employeeId, e]));
    const had = new Set((p.formMemberRefs || []).map(r => r.employeeId));
    const bad = ids.filter(i => !byId[i] || (!byId[i].active && !had.has(i)));   // an employee already on the form may stay even if made inactive later
    if (bad.length) throw err(`Unknown or inactive employee(s): ${bad.join(', ')}`);
    refs = ids.map(i => ({ employeeId: i, name: byId[i].name })); members = refs.map(r => r.name);
  } else members = [...new Set((req.body.members || []).map(m => String(m).trim()).filter(Boolean))];
  const { endDate } = req.body;
  if (!members.length) throw err('Add at least one member to create the form');
  if (!endDate || isNaN(new Date(endDate))) throw err('Form Submission Last Date is required');
  const first = !p.formCreated, oldEnd = p.formEndDate;
  const due = cleanupDateOf(endDate);
  if (!p.proofCleanupDate || +p.proofCleanupDate !== +due) { p.proofCleanupDate = due; p.proofCleanupCompleted = false; p.proofCleanupCompletedAt = undefined; }
  p.formMembers = members; p.formMemberRefs = refs; p.formEndDate = endDate; p.formCreated = true; await p.save();
  await log(req, p, 'PROJECT', first ? 'FORM_CREATED' : 'FORM_UPDATED',
    first ? `created the expense form · Last date ${fmt(endDate)}`
      : oldEnd && +new Date(oldEnd) !== +new Date(endDate) ? `changed the Form Submission Last Date: ${fmt(oldEnd)} → ${fmt(endDate)}` : 'updated the expense form');
  res.json({ ok: true });
}));

r.post('/:id/lock', h(async (req, res) => { const p = await own(req); p.locked = true; p.lockedAt = new Date(); await p.save(); await log(req, p, 'PROJECT', 'LOCKED', 'locked the project'); res.json({ ok: true }); }));
r.post('/:id/unlock', h(async (req, res) => { const p = await own(req); p.locked = false; p.lockedAt = undefined; await p.save(); await log(req, p, 'PROJECT', 'UNLOCKED', 'unlocked the project'); res.json({ ok: true }); }));

// Add several employees from the directory. Name and email come from the database, never from the browser.
r.post('/:id/employees/bulk', h(async (req, res) => {
  const p = await own(req); lock(p);
  if (!p.formCreated) throw err('Create the expense form first');
  const ids = [...new Set((req.body.employeeIds || []).map(x => String(x).trim().toUpperCase()).filter(Boolean))];
  if (!ids.length) throw err('Select at least one employee');
  if (ids.length > 200) throw err('Select at most 200 employees at a time');
  const found = await Employee.find({ employeeId: { $in: ids } }), byId = Object.fromEntries(found.map(e => [e.employeeId, e]));
  const unknown = ids.filter(i => !byId[i]);
  if (unknown.length) throw err(`Unknown employee ID(s): ${unknown.join(', ')}`);
  const off = found.filter(e => !e.active);
  if (off.length) throw err(`Inactive employees cannot be added: ${off.map(e => e.name).join(', ')}`);
  const have = new Set((await PE.find({ projectId: p._id }, 'email employeeId')).flatMap(e => [e.email, e.employeeId].filter(Boolean)));
  const added = [], skipped = [];
  for (const id of ids) {
    const e = byId[id];
    if (have.has(e.email) || have.has(e.employeeId)) { skipped.push(e.name); continue; }   // already in this project
    try {
      await PE.create({ projectId: p._id, name: e.name, email: e.email, employeeId: e.employeeId, employeeRef: e._id, formToken: crypto.randomBytes(24).toString('hex') });
      have.add(e.email); have.add(e.employeeId); added.push(e.name);
    } catch (x) { if (x.code === 11000) skipped.push(e.name); else throw x; }
  }
  if (added.length) await log(req, p, 'PEOPLE', 'EMPLOYEE_ADDED', `added ${added.length} employee(s): ${added.join(', ')}`);
  res.status(201).json({ added: added.length, skipped: skipped.length });
}));

r.post('/:id/employees', h(async (req, res) => {
  const p = await own(req); lock(p);
  if (!p.formCreated) throw err('Create the expense form first');
  const email = (req.body.email || '').trim().toLowerCase(), name = (req.body.name || '').trim();
  if (!name) throw err('Employee name is required');
  if (!EMAIL.test(email)) throw err('Enter a valid email address');
  if (await PE.exists({ projectId: p._id, email })) throw err('This email is already added');
  const e = await PE.create({ projectId: p._id, name, email, formToken: crypto.randomBytes(24).toString('hex') });
  await log(req, p, 'PEOPLE', 'EMPLOYEE_ADDED', `added employee ${name} (${email})`);
  res.status(201).json(e);
}));

r.delete('/:id/employees/:eid', h(async (req, res) => {
  const p = await own(req); lock(p);
  const e = await PE.findOne({ _id: req.params.eid, projectId: p._id });
  if (!e) throw err('Employee not found', 404);
  if (await Expense.exists({ projectId: p._id, employeeEmail: e.email })) throw err('This employee has already submitted bills');
  await e.deleteOne();
  await log(req, p, 'PEOPLE', 'EMPLOYEE_REMOVED', `removed employee ${e.name || e.email} (${e.email})`);
  res.json({ ok: true });
}));

r.post('/:id/send', h(async (req, res) => {
  const p = await own(req); lock(p);
  if (!p.formCreated) throw err('Create the expense form first');
  if (expired(p)) throw err('The Form Submission Last Date has passed. Extend it in the Expense Form first.');
    const pending = await PE.find({ projectId: p._id, status: 'Pending' }), seen = new Set();
  const list = pending.filter(e => EMAIL.test(e.email) && !seen.has(e.email) && seen.add(e.email)); // valid email only, never twice
  const invalid = pending.length - list.length;
  if (!list.length) throw err(invalid ? 'No pending employees have a valid email address' : 'No pending employees to send to');
  const results = await sendForms(p, list), failed = results.filter(x => x.status === 'rejected').length;
  if (failed === list.length) throw err('Emails could not be sent. Check the EMAILJS_* values in .env and the backend terminal for details');
  await log(req, p, 'PEOPLE', 'FORMS_SENT', `sent the form email to ${list.length - failed} employee(s)${failed ? ` (${failed} failed)` : ''}`);
    res.json({ sent: list.length - failed, failed: failed + invalid });
}));

r.post('/:id/employees/:eid/remind', h(async (req, res) => {
  const p = await own(req); lock(p);
  const e = await PE.findOne({ _id: req.params.eid, projectId: p._id });
  if (!e) throw err('Employee not found', 404);
  if (e.status !== 'Pending') throw err('This employee has already responded');
  if (!e.sentAt) throw err('Send the form first');
  if (!remindWindow(p)) throw err('Reminders are available only in the last 2 days before the form deadline');
  try { await sendReminder(p, e); } catch (x) { console.error(x.message); throw err('Reminder could not be sent. Check the backend terminal for details'); }
  await log(req, p, 'PEOPLE', 'REMINDER_SENT', `sent a reminder to ${e.name || e.email}`);
  res.json({ ok: true, email: e.email });
}));

// Review workflow for an employee bill: Submitted, Under Review, Approved, Rejected (reason required), Reimbursed (only after Approved)
r.put('/:id/expenses/:eid/status', h(async (req, res) => {
  const p = await own(req); lock(p);
  const x = await Expense.findOne({ _id: req.params.eid, projectId: p._id, billType: { $ne: 'COMPANY' } });
  if (!x) throw err('Bill not found', 404);
  const to = req.body.status, from = x.status || 'SUBMITTED', reason = String(req.body.reason || '').trim();
  if (!STATUSES.includes(to)) throw err('Invalid status');
  if (to === from) throw err('This bill already has that status');
  if (to === 'REIMBURSED' && from !== 'APPROVED') throw err('Only approved bills can be marked as reimbursed');
  if (to === 'REJECTED' && !reason) throw err('A rejection reason is required');
  x.status = to; x.statusUpdatedAt = new Date(); x.rejectionReason = to === 'REJECTED' ? reason : undefined; await x.save();
  const what = { UNDER_REVIEW: 'moved to Under Review', APPROVED: 'approved', REJECTED: 'rejected', REIMBURSED: 'marked as Reimbursed', SUBMITTED: 'reset to Submitted' }[to];
  await log(req, p, 'REVIEW', `BILL_${to}`, `${what.startsWith('moved') || what.startsWith('marked') || what.startsWith('reset') ? '' : ''}${to === 'APPROVED' || to === 'REJECTED' ? `${what} Bill #${x.billNo}` : `${what.split(' ')[0]} Bill #${x.billNo} ${what.split(' ').slice(1).join(' ')}`.trim()} · ${money(x.amount)}${to === 'REJECTED' ? ` · Reason: ${reason}` : ''}`,
    { billNo: x.billNo, from, to });
  res.json(x);
}));

// Edit an employee bill (bill number never changes); proofs can be added or removed
r.put('/:id/expenses/:eid', up, h(async (req, res) => {
  const p = await own(req); lock(p);
  const x = await Expense.findOne({ _id: req.params.eid, projectId: p._id, billType: { $ne: 'COMPANY' } });
  if (!x) throw err('Bill not found', 404);
  const { date, reason, paidBy, amount } = req.body, amt = Number(amount);
  const { members, memberIds } = resolveMembers(p, req.body, { members: x.members, memberIds: x.memberIds });
  if (!date || isNaN(new Date(date))) throw err('Date is required');
  if (!reason?.trim()) throw err('Reason is required');
  if (!members.length) throw err('Add at least one member');
  if (!paidBy?.trim()) throw err('Paid By is required');
  if (!(amt > 0)) throw err('Amount must be greater than zero');
  const before = { amount: x.amount, date: ymd(x.date), reason: x.reason, paidBy: x.paidBy, members: x.members.join(', ') };
  const plan = await applyProofs(x, req, p._id, 'employee-proofs'); // uploads any new files and prepares the new proof list (null when proofs are unchanged)
  try {
    Object.assign(x, { date, reason: reason.trim(), members, memberIds, totalMembers: members.length, paidBy: paidBy.trim(), amount: amt });
    await x.save();
  } catch (e) { if (plan) await store.destroyMany(plan.fresh).catch(() => {}); throw e; }
  if (plan) { await store.destroyMany(plan.dropped.filter(d => !d.deleted)).catch(e => console.error('Old proof delete failed:', e.message)); await reopenCleanup(p._id); }
  const ch = changes(before, { amount: amt, date: ymd(date), reason: reason.trim(), paidBy: paidBy.trim(), members: members.join(', ') });
  if (ch.length) await log(req, p, 'BILL', 'BILL_EDITED', `edited Bill #${x.billNo} — ${ch.join('; ')}`, { billNo: x.billNo });
  if (plan) await log(req, p, 'BILL', 'PROOF_CHANGED', `changed the proofs of Bill #${x.billNo} (${plan.fresh.length} added, ${plan.dropped.length} removed)`, { billNo: x.billNo });
  res.json(x);
}));

r.delete('/:id/expenses/:eid', h(async (req, res) => {
  const p = await own(req); lock(p);
  const x = await Expense.findOneAndDelete({ _id: req.params.eid, projectId: p._id, billType: { $ne: 'COMPANY' } });
  if (!x) throw err('Bill not found', 404);
  await store.destroy(x).catch(e => console.error('Proof delete failed (the cleanup job will sweep it):', e.message));
  if (!(await Expense.exists({ projectId: p._id, employeeEmail: x.employeeEmail })))
    await PE.updateOne({ projectId: p._id, email: x.employeeEmail }, { status: 'Pending', $unset: { respondedAt: 1 } });
  await log(req, p, 'BILL', 'BILL_DELETED', `deleted Bill #${x.billNo} · ${money(x.amount)} · ${x.reason} (${x.employeeEmail})`, { billNo: x.billNo });
  res.json({ ok: true });
}));

// ---------- Company bills (admin only) ----------
const companyBody = async (req, p, prior = {}) => {
  const { date, reason, paidBy, amount } = req.body, amt = Number(amount);
  let emails; try { emails = [...new Set(JSON.parse(req.body.memberEmails || '[]').map(x => String(x).trim().toLowerCase()).filter(Boolean))]; } catch { emails = []; }
  if (!date || isNaN(new Date(date))) throw err('Date is required');
  if (!reason?.trim()) throw err('Reason is required');
  if (!emails.length) throw err('Select at least one member');
  if (!paidBy?.trim()) throw err('Paid By is required');
  if (!(amt > 0)) throw err('Amount must be greater than zero');
  const nameOf = Object.fromEntries((await PE.find({ projectId: p._id, email: { $in: emails } })).map(e => [e.email, e.name || e.email]));
  if (emails.some(e => !nameOf[e] && !prior[e])) throw err('Some selected members are not employees of this project');
  return { date, reason: reason.trim(), paidBy: paidBy.trim(), amount: amt, memberEmails: emails, members: emails.map(e => nameOf[e] || prior[e] || e), totalMembers: emails.length };
};

r.post('/:id/company-bills', up, h(async (req, res) => {
  const p = await own(req); lock(p);
  const body = await companyBody(req, p);
  const files = upload.check(req.files);
  const fresh = await store.uploadMany(files, p._id, 'company-proofs');
  try {
    const { companyBillCount: n } = await Project.findByIdAndUpdate(p._id, { $inc: { companyBillCount: 1 } }, { new: true });
    const x = await Expense.create({ ...body, ...proofFields(fresh), projectId: p._id, billType: 'COMPANY', billNo: -n, employeeEmail: '', createdBy: req.user.id });
    await reopenCleanup(p._id);
    await log(req, p, 'BILL', 'COMPANY_BILL_CREATED', `created Company Bill C-${n} · ${money(x.amount)} · ${x.reason} · ${fresh.length} proof file${fresh.length === 1 ? '' : 's'}`, { billNo: x.billNo });
    res.status(201).json(x);
  } catch (e) { await store.destroyMany(fresh).catch(() => {}); throw e; }
}));

r.put('/:id/company-bills/:cid', up, h(async (req, res) => {
  const p = await own(req); lock(p);
  const x = await Expense.findOne({ _id: req.params.cid, projectId: p._id, billType: 'COMPANY' });
  if (!x) throw err('Company bill not found', 404);
  const prior = Object.fromEntries(x.memberEmails.map((e, i) => [e, x.members[i]]));
  const body = await companyBody(req, p, prior);
  const before = { amount: x.amount, date: ymd(x.date), reason: x.reason, paidBy: x.paidBy, members: x.members.join(', ') };
  const plan = await applyProofs(x, req, p._id, 'company-proofs');
  try {
    Object.assign(x, body, { updatedAt: new Date() });
    await x.save();
  } catch (e) { if (plan) await store.destroyMany(plan.fresh).catch(() => {}); throw e; }
  if (plan) { await store.destroyMany(plan.dropped.filter(d => !d.deleted)).catch(e => console.error('Old proof delete failed:', e.message)); await reopenCleanup(p._id); }
  const label = `C-${-x.billNo}`, ch = changes(before, { amount: body.amount, date: ymd(body.date), reason: body.reason, paidBy: body.paidBy, members: body.members.join(', ') });
  if (ch.length) await log(req, p, 'BILL', 'COMPANY_BILL_EDITED', `edited Company Bill ${label} — ${ch.join('; ')}`, { billNo: x.billNo });
  if (plan) await log(req, p, 'BILL', 'PROOF_CHANGED', `changed the proofs of Company Bill ${label} (${plan.fresh.length} added, ${plan.dropped.length} removed)`, { billNo: x.billNo });
  res.json(x);
}));

r.delete('/:id/company-bills/:cid', h(async (req, res) => {
  const p = await own(req); lock(p);
  const x = await Expense.findOneAndDelete({ _id: req.params.cid, projectId: p._id, billType: 'COMPANY' });
  if (!x) throw err('Company bill not found', 404);
  await store.destroy(x).catch(e => console.error('Proof delete failed (the cleanup job will sweep it):', e.message));
  await log(req, p, 'BILL', 'COMPANY_BILL_DELETED', `deleted Company Bill C-${-x.billNo} · ${money(x.amount)} · ${x.reason}`, { billNo: x.billNo });
  res.json({ ok: true });
}));

// Excel and proof PDF skip rejected bills (they are not reimbursed)
const billsOf = async pid => Promise.all([
  Expense.find({ projectId: pid, billType: { $ne: 'COMPANY' }, status: { $ne: 'REJECTED' } }).sort({ billNo: 1 }),
  Expense.find({ projectId: pid, billType: 'COMPANY' }).sort({ billNo: -1 })]);

r.get('/:id/excel', h(async (req, res) => {
  const p = await own(req), [ex, co] = await billsOf(p._id);
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="expenses.xlsx"' });
  res.send(Buffer.from(await buildExcel(p, ex, await nameMap(p._id), co)));
}));

r.get('/:id/proofs', h(async (req, res) => {
  const p = await own(req), [ex, co] = await billsOf(p._id);
  if (!ex.length && !co.length) throw err('No submissions yet');

  const cleaned = [...ex, ...co].some(b => b.proofDeleted);
  const result = cleaned && p.finalDocPublicId
    ? await store.readFinalDoc(p)
    : await buildProofDoc(p, ex, await nameMap(p._id), co);

  // Make sure we always send a real Buffer so Content-Length is exact
  const pdf = Buffer.isBuffer(result) ? result : Buffer.from(result);

  res.set({
    'Content-Type': 'application/pdf',
    'Content-Length': pdf.length,          // lets the browser show 0-100%
    'Content-Disposition': 'attachment; filename="expense-proofs.pdf"',
    'Cache-Control': 'no-store',
  });
  res.send(pdf);
}));

// View one proof of a bill (employee or company). ?i= is the proof number, starting at 0.
r.get('/:id/expenses/:eid/proof', h(async (req, res) => {
  const p = await own(req), e = await Expense.findOne({ _id: req.params.eid, projectId: p._id });
  if (!e) throw err('Expense not found', 404);
  const got = await store.readProofAt(e, Math.max(0, parseInt(req.query.i, 10) || 0));
  if (!got) throw err(MSG, 410);
  res.type(got.mime).send(got.buf);
}));
module.exports = r;
