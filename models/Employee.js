const m = require('mongoose');
const s = new m.Schema({
  employeeId: { type: String, required: true, unique: true, trim: true, uppercase: true }, // company employee ID is the unique key
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  active: { type: Boolean, default: true }
}, { timestamps: true });
s.index({ name: 1 });
module.exports = m.model('Employee', s);