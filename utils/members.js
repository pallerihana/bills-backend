// Works out the Members of an EMPLOYEE bill from what the browser sent. Names are always taken from the project's
// stored employee list by ID; a name typed or edited in the browser is never trusted.
exports.resolveMembers = (project, body, prior = {}) => {
  const fail = m => Object.assign(new Error(m), { status: 400 });
  const parse = v => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
  const names = [...new Set(parse(body.members).map(x => String(x).trim()).filter(Boolean))];
  const refs = project.formMemberRefs || [];
  if (!refs.length) return { members: names, memberIds: [] };            // older project: typed names, exactly as before

  const pm = prior.members || [], pids = prior.memberIds || [];
  const byId = Object.fromEntries(refs.map(r => [r.employeeId, r.name]));
  pids.forEach((id, i) => { if (!byId[id] && pm[i]) byId[id] = pm[i]; });  // someone already on this bill stays valid
  const ids = [...new Set(parse(body.memberIds).map(x => String(x).trim().toUpperCase()).filter(Boolean))];
  if (ids.some(i => !byId[i])) throw fail('Some selected members are not part of this project form');

  const picked = ids.map(i => byId[i]), pickedLc = new Set(picked.map(n => n.toLowerCase())), priorLc = new Set(pm.map(n => n.toLowerCase()));
  // Only old typed names that were ALREADY on this bill are kept. Any other name sent by the browser is ignored, never stored.
  const extras = names.filter(n => !pickedLc.has(n.toLowerCase()) && priorLc.has(n.toLowerCase()));
  return { members: [...picked, ...extras], memberIds: ids };
};