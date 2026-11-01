const crypto = require('crypto');
const MAX_FAILS = 5, LOCK_MINUTES = 15;
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// Decides one verification attempt for a person who picked their name on the shared link.
// Both the Employee ID and the registered email must match. Pure function: the route saves the returned `set`.
exports.decide = (pe, input, expectedId, now = Date.now()) => {
  if (pe.verifyLockedUntil && +new Date(pe.verifyLockedUntil) > now) return { result: 'locked', minutes: Math.ceil((+new Date(pe.verifyLockedUntil) - now) / 60000) };
  const email = String(input.email || '').trim().toLowerCase(), id = String(input.employeeId || '').trim().toUpperCase();
  const okEmail = same(email, pe.email), okId = !!expectedId && same(id, String(expectedId).toUpperCase()); // both are always checked
  if (okEmail && okId) return { result: 'ok', set: { verifyFails: 0, verifyLockedUntil: null } };
  const fails = (pe.verifyFails || 0) + 1;
  if (fails >= MAX_FAILS) return { result: 'fail', locked: true, set: { verifyFails: 0, verifyLockedUntil: new Date(now + LOCK_MINUTES * 60000) } };
  return { result: 'fail', set: { verifyFails: fails }, left: MAX_FAILS - fails };
};
exports.LOCK_MINUTES = LOCK_MINUTES;