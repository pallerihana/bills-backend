const upload = require('../middleware/uploadMiddleware');
const store = require('./proofStorage');
const { proofsOf, proofFields, planEdit } = require('../utils/proofs');

const parseIds = v => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a.map(String) : []; } catch { return []; } };
const keepFields = p => {
  const o = { cloudinaryPublicId: p.cloudinaryPublicId, cloudinaryUrl: p.cloudinaryUrl, resourceType: p.resourceType, proofFile: p.proofFile,
    originalName: p.originalName, mime: p.mime, size: p.size, deleted: !!p.deleted };
  if (p._id) o._id = p._id;
  return o;
};

// Adds and/or removes proofs on a bill that is being edited. The edit form sends the new files as "proof" and the ids of
// proofs to remove as JSON in "removeProofs". New files are uploaded first; the bill is changed in memory only after every
// upload worked. Returns null when proofs are unchanged, otherwise { fresh, dropped }:
//   - if saving the bill then FAILS, the caller deletes `fresh`
//   - if saving WORKS, the caller deletes `dropped` (the removed proofs)
// An old single-proof bill is converted to the `proofs` list here, and only here, so old bills are never touched otherwise.
exports.applyProofs = async (bill, req, projectId, kind) => {
  const files = upload.check(req.files, 0);
  const { keep, dropped, changed } = planEdit(proofsOf(bill), parseIds(req.body.removeProofs), files.length, upload.MAX_PROOFS);
  if (!changed) return null;
  const fresh = files.length ? await store.uploadMany(files, projectId, kind) : [];
  Object.assign(bill, proofFields([...keep.map(keepFields), ...fresh]));
  bill.proofDeleted = bill.proofs.length > 0 && bill.proofs.every(p => p.deleted);
  bill.cloudinaryPublicId = bill.cloudinaryUrl = bill.resourceType = bill.proofFile = undefined; // the old single-proof fields now live inside `proofs`
  return { fresh, dropped };
};