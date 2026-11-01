const cron = require('node-cron');
const audit = require('./auditService');
const Project = require('../models/Project'), PE = require('../models/ProjectEmployee'), Expense = require('../models/Expense');
const store = require('./proofStorage'), cloudinary = require('../config/cloudinary');
const { buildProofDoc } = require('./documentService');
const { cleanupDateOf } = require('../utils/fillWindow');

// Save the final proof PDF to projects/{id}/final-documents/ BEFORE any proof is deleted (only once, never overwritten later)
async function ensureFinalDoc(p) {
  if (p.finalDocPublicId) return;
  const [ex, co, emps] = await Promise.all([
    Expense.find({ projectId: p._id, billType: { $ne: 'COMPANY' }, status: { $ne: 'REJECTED' } }).sort({ billNo: 1 }),
    Expense.find({ projectId: p._id, billType: 'COMPANY' }).sort({ billNo: -1 }),
    PE.find({ projectId: p._id })]);
  const names = Object.fromEntries(emps.map(e => [e.email, e.name || '']));
  p.set(await store.uploadFinalDoc(await buildProofDoc(p, ex, names, co), p._id));
  await p.save();
}

// Removes anything left over in the two temporary folders (e.g. a failed earlier delete). final-documents/ is never touched.
async function sweep(pid) {
  for (const kind of ['employee-proofs', 'company-proofs']) {
    let res;
    do { res = await cloudinary.api.delete_resources_by_prefix(`projects/${pid}/${kind}/`, { resource_type: 'raw', type: 'authenticated' }); } while (res.partial);
  }
}


async function cleanupProject(p) {
  const bills = await Expense.find({
    projectId: p._id,
    proofDeleted: { $ne: true },
    $or: [
      { cloudinaryPublicId: { $exists: true, $ne: '' } },
      { proofFile: { $exists: true, $ne: '' } },
      { 'proofs.0': { $exists: true } }
    ]
  });

  if (bills.length) await ensureFinalDoc(p);
  // If this fails, nothing is deleted and the project retries next run.

  for (const b of bills) {
    // Delete every proof belonging to this bill, including new and legacy formats.
    // Throws on failure so the project can be retried later.
    await store.destroy(b);

    // Keep bill data; clear proof references and mark proofs as deleted.
    const upd = b.proofs && b.proofs.length
      ? {
          $set: {
            proofDeleted: true,
            proofDeletedAt: new Date(),
            'proofs.$[].deleted': true
          },
          $unset: {
            'proofs.$[].cloudinaryPublicId': 1,
            'proofs.$[].cloudinaryUrl': 1,
            'proofs.$[].proofFile': 1
          }
        }
      : {
          $set: {
            proofDeleted: true,
            proofDeletedAt: new Date()
          },
          $unset: {
            cloudinaryPublicId: 1,
            cloudinaryUrl: 1,
            resourceType: 1,
            proofFile: 1
          }
        };

    await Expense.updateOne({ _id: b._id }, upd);
  }

  await sweep(p._id).catch(e =>
    console.error('Cleanup sweep warning:', e.message)
  );

  p.proofCleanupCompleted = true;
  p.proofCleanupCompletedAt = new Date();
  await p.save();

  console.log(
    `Proof cleanup done for project ${p._id} (${bills.length} proofs removed)`
  );

  await audit.log(
    p._id,
    audit.system,
    'PROJECT',
    'PROOF_CLEANUP',
    `automatically removed ${bills.length} proof file(s) (7 days after the form last date). Bill data and the final document were kept`
  );
}


let running = false;
async function runCleanup() {
  if (running) return; running = true;
  try {
    const now = new Date();
    const projects = await Project.find({ formEndDate: { $ne: null }, proofCleanupCompleted: { $ne: true } });
    for (const p of projects) {
      if ((p.proofCleanupDate || cleanupDateOf(p.formEndDate)) > now) continue; // not due yet (also covers extended deadlines)
      try { await cleanupProject(p); } catch (e) { console.error('Cleanup failed for project', String(p._id), '-', e.message); }
    }
  } catch (e) { console.error('Cleanup job error:', e.message); }
  finally { running = false; }
}
exports.runCleanup = runCleanup;
exports.start = () => { runCleanup(); cron.schedule('15 * * * *', runCleanup); }; // on startup, then every hour