// Cleans the subject tags: trims, collapses spaces, removes repeats (any capitals), at most 15 tags of 30 characters.
// If the old single `subject` text is sent instead of a list, it is split on commas.
exports.cleanTags = (input, fallbackText = '') => {
  const raw = Array.isArray(input) ? input : fallbackText ? String(fallbackText).split(',') : [];
  const seen = new Set(), out = [];
  for (const t of raw) {
    const tag = String(t ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
    const key = tag.toLowerCase();
    if (tag && !seen.has(key)) { seen.add(key); out.push(tag); }
    if (out.length === 15) break;
  }
  return out;
};