const m = require('mongoose');
module.exports = m.model('Project', new m.Schema({
  collegeName: { type: String, required: true, trim: true },
  startDate: { type: Date, required: true }, endDate: { type: Date}, // informational only
  tags: { type: [String], default: [] },   // subject tags; `subject` keeps the same tags joined with commas for Excel, PDF and email
  subject: { type: String, trim: true, default: '' },
  formMembers: { type: [String], default: [] },
  formCreated: { type: Boolean, default: false },
  formEndDate: Date,                        // Form Submission Last Date: the only thing that stops employees
  locked: { type: Boolean, default: false }, lockedAt: Date,   // manual lock: freezes the project
  proofCleanupDate: Date,                                // Form Submission Last Date + 7 days
  proofCleanupCompleted: { type: Boolean, default: false }, proofCleanupCompletedAt: Date,
  finalDocPublicId: String, finalDocUrl: String, finalDocCreatedAt: Date, // preserved final proof document
  formMemberRefs: [{ _id: false, employeeId: String, name: String }],   // directory employees chosen as the form's Members
  shareToken: { type: String, unique: true, sparse: true },   // common link for WhatsApp / Copy Form Link
  companyBillCount: { type: Number, default: 0 },   // counter for company bills (C-1, C-2...)
  nextBillNo: { type: Number, default: 1 }, // atomic per-project bill counter
  createdBy: { type: m.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: { createdAt: true, updatedAt: false } }));