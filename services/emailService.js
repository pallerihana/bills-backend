const { fmt } = require('../utils/fillWindow');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function post(project, e, reminder) {
  const base = `${process.env.CLIENT_URL}/expense-form/${e.formToken}`;
  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: process.env.EMAILJS_SERVICE_ID, template_id: process.env.EMAILJS_TEMPLATE_ID,
      user_id: process.env.EMAILJS_PUBLIC_KEY, accessToken: process.env.EMAILJS_PRIVATE_KEY,
      template_params: {
        to_email: e.email, employee_name: e.name || 'Employee',
        subject: `${reminder ? 'Reminder: ' : ''}Project Expense Details – ${project.collegeName}`,
        intro_text: reminder ? 'This is a reminder. We have not received your response yet and the form closes soon.' : 'Please share your project expense details.',
        college_name: project.collegeName, start_date: fmt(project.startDate), end_date: project.endDate ? fmt(project.endDate) : 'TBA',
        project_subject: project.subject || '-', deadline: project.formEndDate ? fmt(project.formEndDate) : '-',
        form_link: base, yes_link: `${base}?answer=yes`, no_link: `${base}?answer=no`
      }
    })
  });
  if (!res.ok) throw new Error(`EmailJS ${res.status}: ${await res.text()}`);
}

// Sends one by one (EmailJS rate-limits bursts); returns the same shape as Promise.allSettled
exports.sendForms = async (project, employees) => {
  const results = [];
  for (const e of employees) {
    try { await post(project, e, false); e.sentAt = new Date(); await e.save(); results.push({ status: 'fulfilled' }); }
    catch (err) { console.error('Email failed for', e.email, '-', err.message); results.push({ status: 'rejected', reason: err }); }
    await sleep(1100);
  }
  return results;
};

exports.sendReminder = async (project, e) => {
  await post(project, e, true);
  e.reminderCount = (e.reminderCount || 0) + 1; e.lastReminderAt = new Date(); await e.save();
};
