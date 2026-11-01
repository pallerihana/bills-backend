const multer = require('multer'), path = require('path');
const OK = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
const MAX_PROOFS = 6, MAX_FILE = 10 * 1024 * 1024, MAX_TOTAL = 40 * 1024 * 1024;

// Several proof files can be sent under the same field name "proof" (one bill, many proofs)
const mw = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE, files: MAX_PROOFS },
  fileFilter: (req, f, cb) => {
    const ext = path.extname(f.originalname).toLowerCase();
    OK[ext] && OK[ext] === f.mimetype ? cb(null, true) : cb(new Error(`"${f.originalname}": only PDF, JPG, JPEG or PNG files are allowed`));
  },
}).array('proof', MAX_PROOFS);

mw.MAX_PROOFS = MAX_PROOFS;
// Plain-English message for an upload error
mw.explain = e => (e.code === 'LIMIT_FILE_SIZE' ? 'Each file must be under 10 MB'
  : e.code === 'LIMIT_UNEXPECTED_FILE' || e.code === 'LIMIT_FILE_COUNT' ? `You can attach at most ${MAX_PROOFS} proof files to one bill` : e.message);
// Checks the uploaded list (the count and the total size) and returns it. min = 0 is used when editing a bill.
mw.check = (files, min = 1) => {
  const list = files || [], bad = m => Object.assign(new Error(m), { status: 400 });
  if (list.length < min) throw bad('Proof is required (PDF, JPG, JPEG or PNG)');
  if (list.length > MAX_PROOFS) throw bad(`You can attach at most ${MAX_PROOFS} proof files to one bill`);
  if (list.reduce((s, f) => s + (f.size || 0), 0) > MAX_TOTAL) throw bad('The proof files are too large together (40 MB at most)');
  return list;
};
module.exports = mw;