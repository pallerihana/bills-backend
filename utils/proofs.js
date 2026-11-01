// One place that knows how proofs are stored, so every other file stays simple.
// NEW bills keep a `proofs` array. OLD bills keep the single-proof fields (cloudinaryPublicId, proofFile, proofOriginalName,
// proofMime, proofDeleted). proofsOf() makes both look the same, so old bills keep working with no database migration.

exports.proofsOf = b => {
  if (b && b.proofs && b.proofs.length) {
    return Array.from(b.proofs).map((p, i) => ({
      id: p._id ? String(p._id) : String(i), _id: p._id, cloudinaryPublicId: p.cloudinaryPublicId, cloudinaryUrl: p.cloudinaryUrl, resourceType: p.resourceType,
      proofFile: p.proofFile, originalName: p.originalName, mime: p.mime, size: p.size, deleted: !!p.deleted,
      available: !p.deleted && !!(p.cloudinaryPublicId || p.proofFile),
    }));
  }
  if (b && (b.cloudinaryPublicId || b.proofFile || b.proofOriginalName)) {
    return [{ id: 'legacy', cloudinaryPublicId: b.cloudinaryPublicId, cloudinaryUrl: b.cloudinaryUrl, resourceType: b.resourceType, proofFile: b.proofFile,
      originalName: b.proofOriginalName, mime: b.proofMime, deleted: !!b.proofDeleted, available: !b.proofDeleted && !!(b.cloudinaryPublicId || b.proofFile), legacy: true }];
  }
  return [];
};

// Fields to save on a bill for a list of proofs. proofOriginalName (all names joined) and proofMime (first file) are kept
// so the Excel export and older code paths keep working: still ONE Excel row per bill, all filenames in it.
exports.proofFields = list => ({
  proofs: list,
  proofOriginalName: list.map(p => p.originalName).filter(Boolean).join(', '),
  proofMime: list[0] ? list[0].mime : undefined,
  proofDeleted: false,
});

// Decides what an edit does to a bill's proofs. `existing` comes from proofsOf(); `removeIds` are the proofs the admin removed.
exports.planEdit = (existing, removeIds, addCount, max) => {
  const fail = m => Object.assign(new Error(m), { status: 400 });
  const rm = new Set((removeIds || []).map(String));
  const keep = existing.filter(p => !rm.has(p.id)), dropped = existing.filter(p => rm.has(p.id));
  if (dropped.length !== rm.size) throw fail('Unknown proof selected for removal');
  const alive = keep.filter(p => !p.deleted).length + addCount;
  if (alive < 1 && dropped.some(p => !p.deleted)) throw fail('A bill must keep at least one proof. Add a new file before removing the last one.');
  if (alive > max) throw fail(`A bill can have at most ${max} proof files`);
  return { keep, dropped, alive, changed: rm.size > 0 || addCount > 0 };
};