require('dotenv').config();
const mongoose = require('mongoose'), fs = require('fs'), path = require('path');
const Expense = require('./models/Expense'), store = require('./services/proofStorage');
(async () => {
  const del = process.argv.includes('--delete-local');
  await mongoose.connect(process.env.MONGO_URI);
  const list = await Expense.find({ proofFile: { $exists: true, $ne: '' }, cloudinaryPublicId: { $in: [null, ''] }, proofDeleted: { $ne: true } });
  let ok = 0, fail = 0;
  for (const e of list) {
    const file = path.join(__dirname, 'uploads', e.proofFile);
    try {
      if (!fs.existsSync(file)) throw new Error('local file missing');
      const up = await store.upload({ buffer: fs.readFileSync(file), mimetype: e.proofMime, originalname: e.proofOriginalName }, e.projectId, e.billType === 'COMPANY' ? 'company-proofs' : 'employee-proofs');
      await Expense.updateOne({ _id: e._id }, { $set: { cloudinaryPublicId: up.cloudinaryPublicId, cloudinaryUrl: up.cloudinaryUrl, resourceType: up.resourceType }, $unset: { proofFile: 1 } });
      if (del) fs.unlinkSync(file);
      ok++; console.log('migrated', String(e._id));
    } catch (x) { fail++; console.error('FAILED', String(e._id), '-', x.message); }
  }
  console.log(`Done. migrated=${ok} failed=${fail}`); process.exit();
})();