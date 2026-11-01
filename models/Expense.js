const m = require('mongoose');
const s = new m.Schema({
  projectId: { type: m.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  billType: { type: String, enum: ['EMPLOYEE', 'COMPANY'], default: 'EMPLOYEE' }, // old bills without this field count as EMPLOYEE
  employeeEmail: { type: String, required: function () { return this.billType !== 'COMPANY'; } },
  // Employee bills: 1, 2, 3...   Company bills are stored as -1, -2, -3... (shown as C-1, C-2...)
  billNo: { type: Number, required: true },
  date: { type: Date, required: true }, reason: { type: String, required: true },
  members: [String], memberEmails: [String], totalMembers: Number,
  // Proof. New uploads live in Cloudinary. proofFile is only for old bills that still have a local file.
  proofs: [{                                  // new bills: every proof file of the bill (old bills use the single-proof fields below)
    cloudinaryPublicId: String, cloudinaryUrl: String, resourceType: String, proofFile: String,
    originalName: String, mime: String, size: Number,
    deleted: { type: Boolean, default: false }, uploadedAt: { type: Date, default: Date.now },
  }],
  proofFile: String,
  cloudinaryPublicId: String, cloudinaryUrl: String, resourceType: String,
  proofOriginalName: String,                 // original file name (kept even after cleanup, used in Excel)
  proofMime: String,
  proofDeleted: { type: Boolean, default: false }, proofDeletedAt: Date,
  memberIds: [String],   // company employee IDs of the members (older bills have none and keep their typed names)
  projectEmployeeId: { type: m.Schema.Types.ObjectId, ref: 'ProjectEmployee' },   // the employee record that submitted this bill (new bills only)
  status: { type: String, enum: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'REIMBURSED'], default: 'SUBMITTED' }, // old bills count as SUBMITTED
  statusUpdatedAt: Date, rejectionReason: String,
  paidBy: { type: String, required: true }, amount: { type: Number, required: true, min: 0.01 },
  createdBy: { type: m.Schema.Types.ObjectId, ref: 'User' },
  submittedAt: { type: Date, default: Date.now }, updatedAt: Date
});
s.index({ projectId: 1, billNo: 1 }, { unique: true });
module.exports = m.model('Expense', s);