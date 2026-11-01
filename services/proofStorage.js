const cloudinary = require('../config/cloudinary');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { proofsOf } = require('../utils/proofs');
const UP = path.join(__dirname, '..', 'uploads'); // legacy local files only
const EXT = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };
// Files are private ('authenticated'): the browser never gets a Cloudinary link, the backend serves them after the admin login check.
const OPTS = { resource_type: 'raw', type: 'authenticated' };
const bad = m => Object.assign(new Error(m), { status: 400 });

const looksRight = f => {
  const b = f.buffer;
  if (f.mimetype === 'application/pdf') return b.slice(0, 4).toString() === '%PDF';
  if (f.mimetype === 'image/png') return b.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
};
const stream = (buffer, options) => new Promise((resolve, reject) =>
  cloudinary.uploader.upload_stream(options, (e, r) => (e ? reject(e) : resolve(r))).end(buffer));
const signedUrl = id => cloudinary.url(id, { ...OPTS, sign_url: true, secure: true });
const fetchBuf = async url => {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Could not read the file from Cloudinary (HTTP ${res.status}). In Cloudinary open Settings > Security and allow "PDF and ZIP files delivery".`);
  return Buffer.from(await res.arrayBuffer());
};

// One proof file -> the entry saved inside the bill's `proofs` list
const uploadOne = async (file, projectId, kind) => {
  if (!EXT[file.mimetype]) throw bad('Only PDF, JPG, JPEG or PNG files are allowed');
  if (!looksRight(file)) throw bad(`"${file.originalname}": the file content does not match its type`);
  const r = await stream(file.buffer, { ...OPTS, public_id: `projects/${projectId}/${kind}/${Date.now()}_${crypto.randomBytes(6).toString('hex')}${EXT[file.mimetype]}`, overwrite: false });
  return { cloudinaryPublicId: r.public_id, cloudinaryUrl: r.secure_url, resourceType: 'raw', originalName: file.originalname, mime: file.mimetype, size: file.size, deleted: false };
};

const destroyOne = async p => {
  if (p.cloudinaryPublicId) await cloudinary.uploader.destroy(p.cloudinaryPublicId, { ...OPTS, invalidate: true });
  if (p.proofFile) await fs.promises.unlink(path.join(UP, p.proofFile)).catch(() => {});
};
// Deletes every file in the list. One failure never stops the rest (so nothing is left behind); the first error is thrown at the end.
exports.destroyMany = async list => {
  let first = null;
  for (const p of list || []) { try { await destroyOne(p); } catch (e) { first = first || e; } }
  if (first) throw first;
};
// Deletes ALL proofs of a bill (new bills with a list, or old bills with one proof)
exports.destroy = bill => exports.destroyMany(proofsOf(bill).filter(p => !p.deleted));

// Uploads all files of one bill. If any upload fails, the ones already uploaded are deleted again, so nothing is orphaned.
exports.uploadMany = async (files, projectId, kind) => {
  const done = [];
  try { for (const f of files) done.push(await uploadOne(f, projectId, kind)); }
  catch (e) { await exports.destroyMany(done).catch(() => {}); throw e; }
  return done;
};
exports.uploadOne = uploadOne;
// Old single-file shape, still used by migrateProofs.js
exports.upload = async (file, projectId, kind) => {
  const p = await uploadOne(file, projectId, kind);
  return { cloudinaryPublicId: p.cloudinaryPublicId, cloudinaryUrl: p.cloudinaryUrl, resourceType: 'raw', proofOriginalName: p.originalName, proofMime: p.mime, proofDeleted: false };
};

// The i-th proof of a bill as { buf, mime, name }, or null if it was removed or is missing
exports.readProofAt = async (bill, i = 0) => {
  const p = proofsOf(bill)[i];
  if (!p || p.deleted) return null;
  let buf = null;
  if (p.cloudinaryPublicId) buf = await fetchBuf(signedUrl(p.cloudinaryPublicId));
  else if (p.proofFile) { const f = path.join(UP, p.proofFile); buf = fs.existsSync(f) ? fs.readFileSync(f) : null; }
  return buf ? { buf, mime: p.mime, name: p.originalName } : null;
};
exports.readProof = async e => (await exports.readProofAt(e, 0))?.buf || null; // first proof only (older callers)

// Final generated proof document, kept in projects/{id}/final-documents/ and never auto-deleted
exports.uploadFinalDoc = async (buffer, projectId) => {
  const r = await stream(buffer, { ...OPTS, public_id: `projects/${projectId}/final-documents/final-proof-document.pdf`, overwrite: true, invalidate: true });
  return { finalDocPublicId: r.public_id, finalDocUrl: r.secure_url, finalDocCreatedAt: new Date() };
};
exports.readFinalDoc = async p => {
  const b = await fetchBuf(signedUrl(p.finalDocPublicId));
  if (!b) throw new Error('The saved final proof document could not be found.');
  return b;
};