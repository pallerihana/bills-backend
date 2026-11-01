const m = require('mongoose');
module.exports = m.model('User', new m.Schema({
  name: String, email: { type: String, unique: true, lowercase: true, required: true }, password: { type: String, required: true }
}, { timestamps: { createdAt: true, updatedAt: false } }));
