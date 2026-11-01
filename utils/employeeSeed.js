const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Cleans the seed list: trims, upper-cases IDs, lower-cases emails, skips bad rows and duplicates. Pure function (no database).
exports.prepare = list => {
  const ok = [], warnings = [], ids = new Set(), emails = new Map();
  list.forEach((raw, i) => {
    const r = { employeeId: String(raw.employeeId ?? '').trim().toUpperCase(), name: String(raw.name ?? '').trim().replace(/\s+/g, ' '),
      email: String(raw.email ?? '').trim().toLowerCase(), active: raw.active };
    const where = `row ${i + 1} (${r.employeeId || r.name || '?'})`;
    if (!r.employeeId || !r.name) return warnings.push(`${where}: employeeId and name are required, skipped`);
    if (!EMAIL.test(r.email)) return warnings.push(`${where}: invalid email "${raw.email}", skipped`);
    if (ids.has(r.employeeId)) return warnings.push(`${where}: duplicate employeeId in the seed list, skipped`);
    ids.add(r.employeeId);
    if (emails.has(r.email)) warnings.push(`${where}: email is also used by ${emails.get(r.email)} (both are kept, but only one of them can be added to the same project)`);
    else emails.set(r.email, r.employeeId);
    ok.push(r);
  });
  return { ok, warnings };
};