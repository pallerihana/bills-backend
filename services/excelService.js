const ExcelJS = require('exceljs');

// ---------------------------------------------------------------
// Colours and formats
// ---------------------------------------------------------------
const NAVY = 'FF1F4E79';
const RED = 'FFB91C1C';
const PINK = 'FFFEE2E2';
const ZEBRA = 'FFF3F7FB';
const BORDER = 'FFD0D7DE';

// Indian digit grouping (15,00,000.00). If you prefer plain grouping, use '"₹"#,##0.00'.
const INR =
  '[>=10000000]"₹"##\\,##\\,##\\,##0.00;[>=100000]"₹"##\\,##\\,##0.00;"₹"##,##0.00';
const DATE_FMT = 'dd-mm-yyyy';

// ---------------------------------------------------------------
// Safe helpers
// ---------------------------------------------------------------
const r2 = (n) => Math.round(n * 100) / 100;
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const list = (v) => {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (v == null || v === '') return [];
  return [String(v)];
};
const text = (v, fallback = '') => (v == null || v === '' ? fallback : String(v));

const istFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// Real Excel date for the IST calendar day (no one-day shift on UTC servers).
const toDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const [y, m, day] = istFormatter.format(d).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
};
const dateCell = (v) => toDate(v) || '-';
const fmtText = (v) => {
  const d = toDate(v);
  if (!d) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
};

const formatStatus = (s) => String(s || 'SUBMITTED').replace(/_/g, ' ').toUpperCase();
const employeeNo = (e) => Number(e.billNo) || 0;
const companyNo = (e) => Math.abs(Number(e.billNo) || 0);

// ---------------------------------------------------------------
// Styling helpers
// ---------------------------------------------------------------
const thin = { style: 'thin', color: { argb: BORDER } };
const allBorders = { top: thin, left: thin, bottom: thin, right: thin };
const solid = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

const headRow = (row, ncols) => {
  for (let c = 1; c <= ncols; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = solid(NAVY);
    cell.border = allBorders;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  }
  row.height = 24;
  return row;
};

// Style a data row: borders, wrap, top alignment, optional fill/font, money & date columns.
const styleRow = (row, ncols, o = {}) => {
  for (let c = 1; c <= ncols; c++) {
    const cell = row.getCell(c);
    cell.border = allBorders;
    cell.alignment = {
      vertical: 'top',
      wrapText: true,
      horizontal: (o.align && o.align[c - 1]) || 'left',
    };
    if (o.fill) cell.fill = solid(o.fill);
    if (o.font) cell.font = o.font;
    if (o.money && o.money.includes(c)) cell.numFmt = INR;
    if (o.dates && o.dates.includes(c)) cell.numFmt = DATE_FMT;
  }
  return row;
};

const redFont = { color: { argb: RED }, bold: true };

// ---------------------------------------------------------------
// Builder
// ---------------------------------------------------------------
exports.buildExcel = async (project, expenses = [], names = {}, company = []) => {
  // Sorted copies, same order as the PDF report.
  const empList = [...expenses].sort((a, b) => employeeNo(a) - employeeNo(b));
  const coList = [...company].sort((a, b) => companyNo(a) - companyNo(b));

  const empTotal = r2(empList.reduce((s, e) => s + num(e.amount), 0));
  const coTotal = r2(coList.reduce((s, c) => s + num(c.amount), 0)); // each company bill counted once

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Expenses');
  const NC = 14;

  // ---- Project info (rows 1-4) ----
  [
    ['College Name:', text(project.collegeName)],
    ['Project Start Date:', fmtText(project.startDate)],
    ['Project End Date:', project.endDate ? fmtText(project.endDate) : 'To be decided'],
    ['Subject:', text(project.subject)],
  ].forEach((r) => {
    const row = ws.addRow(r);
    row.getCell(1).font = { bold: true, color: { argb: NAVY } };
    ws.mergeCells(row.number, 2, row.number, 5);
    row.getCell(2).alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
  });
  ws.addRow([]);

  // ---- Header (row 6) ----
  const HEADER_ROW = ws.rowCount + 1;
  headRow(
    ws.addRow([
      'Bill No', 'Employee Name', 'Employee Email', 'Date', 'Reason', 'Members', 'Total Members',
      'Paid By', 'Amount', 'Proof File Name', 'Submission Date', 'Bill Type', 'Member Share', 'Status',
    ]),
    NC
  );

  // Column alignment: numbers right, short values centred.
  const align = [
    'center', 'left', 'left', 'center', 'left', 'left', 'center',
    'left', 'right', 'left', 'center', 'center', 'right', 'center',
  ];
  const DATE_COLS = [4, 11];
  const MONEY_COLS = [9, 13];

  // 1) Employee bill rows
  empList.forEach((e, i) => {
    const row = ws.addRow([
      e.billNo,
      names[e.employeeEmail] || '',
      text(e.employeeEmail),
      dateCell(e.date),
      text(e.reason),
      list(e.members).join(', '),
      num(e.totalMembers) || list(e.members).length,
      text(e.paidBy, '-'),
      num(e.amount),
      text(e.proofOriginalName),
      dateCell(e.submittedAt),
      'EMPLOYEE',
      '',
      formatStatus(e.status),
    ]);
    styleRow(row, NC, {
      align,
      dates: DATE_COLS,
      money: MONEY_COLS,
      fill: i % 2 === 1 ? ZEBRA : null,
    });
  });

  // 2) Company bills: exactly ONE row per bill (C-1, C-2, ...). All members go into the Members cell and the
  //    bill amount appears once. Member Share = this bill's total / member count (rounded down to the paisa).
  coList.forEach((c) => {
    const members = list(c.members);
    const n = members.length || 1;
    const amount = num(c.amount);
    const cents = Math.round(amount * 100);
    const base = Math.floor(cents / n) / 100;
    const extra = cents % n;

    const row = ws.addRow([
      `C-${companyNo(c)}`,
      'Company',
      list(c.memberEmails).join(', '),
      dateCell(c.date),
      text(c.reason),
      members.join(', '),
      n,
      text(c.paidBy, 'Company'),
      amount,
      text(c.proofOriginalName),
      dateCell(c.submittedAt),
      'COMPANY',
      base,
      '-',
    ]);
    styleRow(row, NC, {
      align,
      dates: DATE_COLS,
      money: MONEY_COLS,
      fill: PINK,
      font: redFont,
    });

    // When the total does not divide evenly, the leftover paise go to the first members so the shares add up exactly to the bill total
    if (extra) {
      row.getCell(13).note = `Shares add up exactly to ${amount}: the first ${extra} member(s) pay ${r2(base + 0.01)}, the rest pay ${base}.`;
    }
  });

  const lastDataRow = ws.rowCount;

  // ---- Totals ----
  const tot = (label, value, font) => {
    const row = ws.addRow(['', '', '', '', '', '', '', label, value]);
    const l = row.getCell(8);
    const v = row.getCell(9);
    l.font = font || { bold: true };
    v.font = font || { bold: true };
    l.alignment = { horizontal: 'right' };
    v.alignment = { horizontal: 'right' };
    v.numFmt = INR;
    l.border = allBorders;
    v.border = allBorders;
    return row;
  };

  ws.addRow([]);
  if (!coList.length) {
    tot('Total', empTotal);
  } else {
    const noteRow = ws.addRow([
      "Note: each company bill is one row. Its amount is counted once in the totals below. Member Share is that bill's total divided by its member count.",
    ]);
    ws.mergeCells(noteRow.number, 1, noteRow.number, NC);
    noteRow.getCell(1).font = { italic: true, color: { argb: RED } };
    noteRow.getCell(1).alignment = { wrapText: true, vertical: 'middle' };
    noteRow.height = 30;
    ws.addRow([]);
    tot('Total Employee Bills', empTotal);
    tot('Total Company Bills', coTotal, redFont);
    tot('Grand Total', r2(empTotal + coTotal));
  }

  [10, 20, 28, 14, 30, 30, 14, 20, 16, 28, 16, 12, 16, 14].forEach(
    (w, i) => (ws.getColumn(i + 1).width = w)
  );

  // Freeze the header, add filters, print setup.
  ws.views = [{ state: 'frozen', ySplit: HEADER_ROW, xSplit: 1 }];
  if (lastDataRow > HEADER_ROW) {
    ws.autoFilter = {
      from: { row: HEADER_ROW, column: 1 },
      to: { row: lastDataRow, column: NC },
    };
  }
  ws.pageSetup = {
    orientation: 'landscape',
    paperSize: 9, // A4
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}`,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };

  // ---------------------------------------------------------------
  // Summary sheet
  // ---------------------------------------------------------------
  const sm = wb.addWorksheet('Summary');

  const section = (title) => {
    sm.addRow([]);
    const r = sm.addRow([title]);
    r.font = { bold: true, size: 13, color: { argb: NAVY } };
  };
  const line = (values, ncols, o = {}) => styleRow(sm.addRow(values), ncols, o);

  const title = sm.addRow(['Total Summary']);
  title.font = { bold: true, size: 13, color: { argb: NAVY } };
  line(['Total Employee Bills', empTotal], 2, { money: [2], align: ['left', 'right'] });
  line(['Total Company Bills', coTotal], 2, {
    money: [2], align: ['left', 'right'], fill: PINK, font: redFont,
  });
  line(['Grand Total', r2(empTotal + coTotal)], 2, {
    money: [2], align: ['left', 'right'], font: { bold: true },
  });

  // Employee-wise
  section('Employee-wise Summary (employee-submitted bills only)');
  headRow(sm.addRow(['Employee Name', 'Employee Email', 'Bills', 'Amount']), 4);
  const byEmp = {};
  empList.forEach((e) => {
    const key = text(e.employeeEmail, '-');
    const g = byEmp[key] || (byEmp[key] = { name: names[e.employeeEmail] || key, count: 0, amount: 0 });
    g.count += 1;
    g.amount += num(e.amount);
  });
  Object.entries(byEmp)
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .forEach(([email, g]) =>
      line([g.name, email, g.count, r2(g.amount)], 4, {
        money: [4], align: ['left', 'left', 'center', 'right'],
      })
    );
  line(['Total', '', empList.length, empTotal], 4, {
    money: [4], align: ['left', 'left', 'center', 'right'], font: { bold: true },
  });

  // Company amount
  section('Company Amount (each company bill counted once)');
  headRow(sm.addRow(['Bill', 'Reason', 'Members', 'Paid By', 'Amount']), 5);
  coList.forEach((c) =>
    line(
      [`C-${companyNo(c)}`, text(c.reason), list(c.members).length || 1, text(c.paidBy, 'Company'), num(c.amount)],
      5,
      { money: [5], align: ['left', 'left', 'center', 'left', 'right'], fill: PINK, font: redFont }
    )
  );
  line(['Company Bills Total', '', '', '', coTotal], 5, {
    money: [5], align: ['left', 'left', 'center', 'left', 'right'], fill: PINK, font: redFont,
  });

  // Reimbursement by Paid By
  section('Reimbursement Summary by Paid By');
  headRow(sm.addRow(['Paid By', 'Type', 'Bills', 'Amount']), 4);
  const group = (items, type, fallback) => {
    const m = new Map();
    items.forEach((x) => {
      const label = text(x.paidBy, fallback).trim() || fallback;
      const key = label.toLowerCase();
      const g = m.get(key) || { label, type, count: 0, amount: 0 };
      g.count += 1;
      g.amount += num(x.amount);
      m.set(key, g);
    });
    return [...m.values()];
  };
  const reAlign = ['left', 'left', 'center', 'right'];
  group(empList, 'Paid personally (reimbursable to this person)', '-').forEach((g) =>
    line([g.label, g.type, g.count, r2(g.amount)], 4, { money: [4], align: reAlign })
  );
  group(coList, 'Company bill (not owed to any employee)', 'Company').forEach((g) =>
    line([g.label, g.type, g.count, r2(g.amount)], 4, {
      money: [4], align: reAlign, fill: PINK, font: redFont,
    })
  );
  line(['Owed to employees', '', '', empTotal], 4, { money: [4], align: reAlign });
  line(['Company-paid bills', '', '', coTotal], 4, { money: [4], align: reAlign });
  line(['Total', '', '', r2(empTotal + coTotal)], 4, {
    money: [4], align: reAlign, font: { bold: true },
  });

  [34, 44, 14, 22, 18].forEach((w, i) => (sm.getColumn(i + 1).width = w));
  sm.pageSetup = {
    orientation: 'portrait',
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };

  return wb.xlsx.writeBuffer();
};