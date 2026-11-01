const OFF = Number(process.env.APP_TZ_OFFSET_MIN ?? 330) * 60000, DAY = 86400000;
const fmt = d => new Date(d).toLocaleDateString('en-GB', { timeZone: 'UTC' }).replace(/\//g, '-');

// Employees may submit until the END of the Form Submission Last Date (local time via APP_TZ_OFFSET_MIN).
// Project start/end dates are never used here.
const windowOf = p => ({ closesAt: p.formEndDate ? new Date(+p.formEndDate + DAY - OFF) : null });
const expired = p => { const { closesAt } = windowOf(p); return !!closesAt && Date.now() >= closesAt; };
const blockReason = p => (p.locked || expired(p)) ? 'Expense Submission Closed' : null; // lock OR deadline stops employees

// Reminder button is enabled only in the last 2 days before the last date
const remindWindow = p => {
  const { closesAt } = windowOf(p);
  if (!closesAt || p.locked) return false;
  const left = closesAt - Date.now();
  return left > 0 && left <= 2 * DAY;
};
// Proof cleanup date = Form Submission Last Date + 7 days (start of that day, local time). Project end date is never used.
const cleanupDateOf = d => new Date(+new Date(d) + 7 * DAY - OFF);
module.exports = { windowOf, expired, blockReason, remindWindow, fmt, cleanupDateOf };