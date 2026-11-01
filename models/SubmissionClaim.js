const m = require('mongoose');
// One claim per intentional submission. Blocks double-click duplicates (auto-deleted after 24h).
module.exports = m.model('SubmissionClaim', new m.Schema({
  requestId: { type: String, required: true, unique: true },
  expenseId: m.Schema.Types.ObjectId,
  createdAt: { type: Date, default: Date.now, expires: 86400 }
}));