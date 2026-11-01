const AuditLog = require('../models/AuditLog');
exports.money = n => `₹${Number(n).toLocaleString('en-IN')}`;
exports.admin = req => ({ type: 'ADMIN', name: req.user.email });
exports.employee = pe => ({ type: 'EMPLOYEE', name: pe.name || pe.email });
exports.system = { type: 'SYSTEM', name: 'System' };
// Never throws: a logging problem must not break the action that triggered it
exports.log = async (projectId, actor, category, action, message, meta) => {
  try { await AuditLog.create({ projectId, category, action, actorType: actor.type, actor: actor.name, message, meta }); }
  catch (e) { console.error('Audit log failed:', e.message); }
};