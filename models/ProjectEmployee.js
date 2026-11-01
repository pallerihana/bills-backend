const m = require('mongoose');
const s = new m.Schema({
  projectId: { type: m.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  name: { type: String, trim: true, default: '' },
  email: { type: String, required: true, lowercase: true, trim: true },
  formToken: { type: String, required: true, unique: true },
  employeeId: String, employeeRef: { type: m.Schema.Types.ObjectId, ref: 'Employee' }, // link to the company directory (older rows have none)
  verifyFails: { type: Number, default: 0 }, verifyLockedUntil: Date,   // wrong-attempt limit for the shared link
  status: { type: String, enum: ['Pending', 'Submitted', 'No Bill'], default: 'Pending' },
  sentAt: Date, respondedAt: Date,
  reminderCount: { type: Number, default: 0 }, lastReminderAt: Date
});
s.index({ projectId: 1, email: 1 }, { unique: true });
module.exports = m.model('ProjectEmployee', s);