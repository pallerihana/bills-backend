const m = require('mongoose');
// Append-only: there is no route that edits or deletes audit entries.
const s = new m.Schema({
  projectId: { type: m.Schema.Types.ObjectId, ref: 'Project', required: true },
  category: { type: String, enum: ['BILL', 'REVIEW', 'PROJECT', 'PEOPLE'], required: true },
  action: { type: String, required: true },
  actorType: { type: String, enum: ['ADMIN', 'EMPLOYEE', 'SYSTEM'], required: true },
  actor: String,                  // admin email, employee name, or "System"
  message: { type: String, required: true },
  meta: m.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now }
});
s.index({ projectId: 1, createdAt: -1 });
module.exports = m.model('AuditLog', s);