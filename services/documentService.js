const store = require('./proofStorage');
const { proofsOf } = require('../utils/proofs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fs = require('fs');

// ---------------------------------------------------------------
// Page geometry (A4 portrait, PDF points)
// ---------------------------------------------------------------
const W = 595.28;
const H = 841.89;
const M = 38;
const CONTENT_W = W - M * 2;
const BAR_TOP = 32;                 // gap above the bill-number bar
const BAR_H = 46;                   // bill-number bar height
const HEADER_H = BAR_TOP + BAR_H;   // everything below the bar starts under this line
const FOOTER_SAFE = M + 14;         // proof area never goes below this
const MAX_ON_PAGE = 6;              // proofs that fit readably on one bill page

// ---------------------------------------------------------------
// Company logo (cover page, top right)
// Order: LOGO_PATH env / ./assets/codetantra-logo.png -> LOGO_URL -> skip.
// Bytes are cached, so the network is hit at most once per server run.
// Tip: download the image once and save it as assets/codetantra-logo.png
// (the LinkedIn link has an expiring token and may stop working).
// ---------------------------------------------------------------
const LOGO_URL =
  process.env.LOGO_URL ||
  'https://media.licdn.com/dms/image/v2/C4D22AQHNPGIAFj3wsw/feedshare-shrink_800/feedshare-shrink_800/0/1650908921576?e=2147483647&v=beta&t=K6mjm48BL_eWa7uxQq5cHkCkjCOXcByYdmRyAlVXGco';
const LOGO_PATH =
  process.env.LOGO_PATH || require('path').join(__dirname, 'assets', 'codetantra-logo.png');

let logoBytesCache; // undefined = not tried yet, null = unavailable

const loadLogoBytes = async () => {
  if (logoBytesCache !== undefined) return logoBytesCache;
  logoBytesCache = null;

  try {
    if (fs.existsSync(LOGO_PATH)) {
      logoBytesCache = fs.readFileSync(LOGO_PATH);
      return logoBytesCache;
    }
  } catch (err) {
    /* try URL next */
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(LOGO_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) logoBytesCache = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    logoBytesCache = null;
  }
  return logoBytesCache;
};

// ---------------------------------------------------------------
// Colours
// ---------------------------------------------------------------
const C = {
  navy: rgb(0.055, 0.2, 0.4),
  blue: rgb(0.13, 0.39, 0.78),
  blueLight: rgb(0.91, 0.96, 1),
  blueBorder: rgb(0.79, 0.87, 0.95),
  red: rgb(0.73, 0.12, 0.16),
  redLight: rgb(1, 0.93, 0.93),
  redBar: rgb(1, 0.84, 0.84),
  redBorder: rgb(0.92, 0.7, 0.7),
  yellow: rgb(0.996, 0.9, 0.36),
  yellowBorder: rgb(0.86, 0.68, 0.08),
  green: rgb(0.08, 0.48, 0.29),
  greenLight: rgb(0.9, 0.97, 0.92),
  ink: rgb(0.13, 0.17, 0.23),
  muted: rgb(0.38, 0.43, 0.5),
  border: rgb(0.86, 0.89, 0.92),
  light: rgb(0.97, 0.98, 0.99),
  white: rgb(1, 1, 1),
  soft: rgb(0.86, 0.91, 0.98),
};

// ---------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------
const fmtDate = (value) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d
    .toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
    .replace(/\//g, '-');
};

const safeAmount = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const money = (value) =>
  `Rs. ${safeAmount(value).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// Standard PDF fonts only support WinAnsi, so strip anything else.
// With a custom Unicode font we keep the text as-is.
const makeClean = (unicode) => (value) => {
  let s = String(value ?? '-');
  if (unicode) return s.replace(/\s+/g, ' ');
  return s
    .replace(/₹/g, 'Rs. ')
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E]/g, '?');
};

// Employee bill numbers sort as numbers; company numbers may be negative.
const employeeNo = (e) => Number(e.billNo) || 0;
const companyNo = (e) => Math.abs(Number(e.billNo) || 0);

const getMembers = (expense) => {
  if (Array.isArray(expense.members)) return expense.members.map(String);
  if (expense.members == null || expense.members === '') return [];
  return [String(expense.members)];
};

const getEmployeeName = (expense, names) => {
  const email = expense.employeeEmail || '';
  return names[email] ? `${names[email]} (${email})` : email || '-';
};

const formatStatus = (status) =>
  String(status || 'SUBMITTED').replace(/_/g, ' ').toUpperCase();

// Detect the real file type from the bytes first, MIME second.
const detectProofType = (expense, buf) => {
  if (buf && buf.length > 4) {
    if (buf.slice(0, 4).toString('latin1') === '%PDF') return 'pdf';
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
    if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  }
  const mime = String(expense.proofMime || '').toLowerCase();
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  return null;
};

// ---------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------
exports.buildProofDoc = async (project, expenses = [], names = {}, company = []) => {
  const doc = await PDFDocument.create();

  // ---- Fonts -------------------------------------------------
  let font;
  let bold;
  let unicode = false;

  const customFontPath = process.env.PDF_FONT_PATH;
  if (customFontPath && fs.existsSync(customFontPath)) {
    try {
      doc.registerFontkit(require('@pdf-lib/fontkit'));
      font = await doc.embedFont(fs.readFileSync(customFontPath), { subset: true });
      bold = font;
      unicode = true;
    } catch (err) {
      font = null; // fall back to Helvetica below
    }
  }
  if (!font) {
    font = await doc.embedFont(StandardFonts.Helvetica);
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
  }

  const clean = makeClean(unicode);

  // ---- Data --------------------------------------------------
  const employeeBills = [...expenses].sort((a, b) => employeeNo(a) - employeeNo(b));
  const companyBills = [...company].sort((a, b) => companyNo(a) - companyNo(b));

  const employeeTotal = employeeBills.reduce((s, e) => s + safeAmount(e.amount), 0);
  const companyTotal = companyBills.reduce((s, e) => s + safeAmount(e.amount), 0);
  const generatedAt = fmtDate(new Date());

  // ---- Drawing helpers ---------------------------------------
  const textWidth = (value, f, size) => f.widthOfTextAtSize(clean(value), size);

  const drawText = (page, value, x, y, o = {}) =>
    page.drawText(clean(value), {
      x,
      y,
      size: o.size || 10,
      font: o.bold ? bold : font,
      color: o.color || C.ink,
    });

  const drawRight = (page, value, rightX, y, o = {}) => {
    const f = o.bold ? bold : font;
    drawText(page, value, rightX - textWidth(value, f, o.size || 10), y, o);
  };

  const box = (page, x, y, width, height, fill, border, bw = 0.7) =>
    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: fill,
      borderColor: border,
      borderWidth: bw,
    });

  // Largest font size (<= max) at which the text fits the width.
  const fitSize = (value, f, max, min, width) => {
    let size = max;
    while (size > min && textWidth(value, f, size) > width) size -= 0.5;
    return size;
  };

  // Shorten text with "..." so it fits the width.
  const fitText = (value, f, size, maxWidth) => {
    let s = clean(value);
    if (maxWidth < 24) return '';
    if (textWidth(s, f, size) <= maxWidth) return s;
    while (s.length > 1 && textWidth(`${s}...`, f, size) > maxWidth) s = s.slice(0, -1);
    return `${s}...`;
  };

  // Wrap text by real glyph widths; hard-break very long tokens.
  const wrapText = (value, f, size, maxWidth) => {
    const words = clean(value).split(' ').filter(Boolean);
    const lines = [];
    let current = '';

    const pushLongWord = (word) => {
      let fragment = '';
      for (const ch of word) {
        if (fragment && f.widthOfTextAtSize(fragment + ch, size) > maxWidth) {
          lines.push(fragment);
          fragment = ch;
        } else {
          fragment += ch;
        }
      }
      return fragment;
    };

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (f.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      current = f.widthOfTextAtSize(word, size) > maxWidth ? pushLongWord(word) : word;
    }
    if (current) lines.push(current);
    return lines.length ? lines : ['-'];
  };

  // Limit to N lines, ending the last one with "...".
  const limitLines = (lines, max, f, size, maxWidth) => {
    if (lines.length <= max) return lines;
    const out = lines.slice(0, max);
    let last = out[max - 1];
    while (last.length > 1 && f.widthOfTextAtSize(`${last}...`, size) > maxWidth) {
      last = last.slice(0, -1);
    }
    out[max - 1] = `${last}...`;
    return out;
  };

  // Fit w x h inside an area, centred horizontally and aligned to the top. Never distorts.
  const fitInto = (w, h, area, pad = 10, maxUp = 1) => {
    const s = Math.min((area.width - pad * 2) / w, (area.height - pad * 2) / h, maxUp);
    const width = w * s;
    const height = h * s;
    return {
      x: area.x + (area.width - width) / 2,
      y: area.y + area.height - pad - height,
      width,
      height,
    };
  };

  // ---------------------------------------------------------
  // Cover page
  // ---------------------------------------------------------
  const renderCover = async () => {
    const page = doc.addPage([W, H]);

    page.drawRectangle({ x: 0, y: H - 112, width: W, height: 112, color: C.navy });
    drawText(page, 'PROJECT EXPENSE PROOF REPORT', M, H - 48, { size: 21, bold: true, color: C.white });
    drawText(page, 'COMPANY EXPENSE DOCUMENT', M, H - 72, { size: 10, color: C.soft });
    drawText(page, `Generated: ${generatedAt} | Generated by CodeTantra Bills`, M, H - 92, {
      size: 9,
      color: C.white,
    });

    // Company logo on the right, inside a white tile so any background looks clean.
    try {
      const logoBytes = await loadLogoBytes();
      if (logoBytes && logoBytes.length > 4) {
        const isPngLogo = logoBytes[0] === 0x89 && logoBytes[1] === 0x50;
        const logo = isPngLogo ? await doc.embedPng(logoBytes) : await doc.embedJpg(logoBytes);

        const tile = { w: 120, h: 76 };
        const tileX = W - M - tile.w;
        const tileY = H - 112 + (112 - tile.h) / 2;
        page.drawRectangle({
          x: tileX,
          y: tileY,
          width: tile.w,
          height: tile.h,
          color: C.white,
          borderColor: C.soft,
          borderWidth: 0.8,
        });

        const pad = 6;
        const s = Math.min((tile.w - pad * 2) / logo.width, (tile.h - pad * 2) / logo.height);
        page.drawImage(logo, {
          x: tileX + (tile.w - logo.width * s) / 2,
          y: tileY + (tile.h - logo.height * s) / 2,
          width: logo.width * s,
          height: logo.height * s,
        });
      }
    } catch (err) {
      // A missing or broken logo must never stop the report.
    }

    let y = H - 138;

    // Project details
    box(page, M, y - 25, CONTENT_W, 25, C.blueLight, C.blueBorder, 0.8);
    drawText(page, 'PROJECT DETAILS', M + 12, y - 17, { size: 11, bold: true, color: C.navy });
    y -= 25;

    const details = [
      ['College Name', project.collegeName || '-'],
      ['Project Start Date', fmtDate(project.startDate)],
      ['Project End Date', project.endDate ? fmtDate(project.endDate) : 'To be decided'],
      ['Subject', project.subject || '-'],
    ];

    const rowH = 31;
    const labelW = 148;
    const valueW = CONTENT_W - labelW - 18;

    for (const [label, value] of details) {
      y -= rowH;
      box(page, M, y, labelW, rowH, C.light, C.border, 0.5);
      box(page, M + labelW, y, CONTENT_W - labelW, rowH, C.white, C.border, 0.5);
      drawText(page, label, M + 9, y + rowH / 2 - 3, { size: 9, bold: true, color: C.navy });

      const lines = limitLines(wrapText(value, font, 9, valueW), 2, font, 9, valueW);
      const lh = 11;
      const startY = y + rowH / 2 + ((lines.length - 1) * lh) / 2 - 3;
      lines.forEach((line, i) => {
        drawText(page, line, M + labelW + 9, startY - i * lh, { size: 9 });
      });
    }

    // Summary cards
    y -= 28;
    drawText(page, 'EXPENSE SUMMARY', M, y, { size: 12, bold: true, color: C.navy });
    y -= 14;

    const gap = 8;
    const cardW = (CONTENT_W - gap * 3) / 4;
    const cardH = 83;

    const cards = [
      { label: 'EMPLOYEE BILLS', value: String(employeeBills.length), fill: C.blueLight, color: C.blue },
      { label: 'COMPANY BILLS', value: String(companyBills.length), fill: C.redLight, color: C.red },
      { label: 'EMPLOYEE TOTAL', value: money(employeeTotal), fill: C.greenLight, color: C.green },
      { label: 'COMPANY TOTAL', value: money(companyTotal), fill: C.redLight, color: C.red },
    ];

    cards.forEach((card, i) => {
      const x = M + i * (cardW + gap);
      box(page, x, y - cardH, cardW, cardH, card.fill, C.border);
      drawText(page, card.label, x + 8, y - 22, { size: 7, bold: true, color: card.color });
      const size = fitSize(card.value, bold, 15, 7, cardW - 16);
      drawText(page, card.value, x + 8, y - 54, { size, bold: true, color: card.color });
    });

    y -= cardH + 28;

    const note =
      employeeBills.length + companyBills.length === 0
        ? 'No bills were submitted for this project.'
        : 'Each following page shows one bill: its details at the top and all of its attached proofs below. ' +
          'Employee bills come first, then company bills, both in bill-number order.';

    wrapText(note, font, 9, CONTENT_W).forEach((line, i) => {
      drawText(page, line, M, y - i * 12, { size: 9, color: C.muted });
    });
  };

  // ---------------------------------------------------------
  // Bill page: number bar + details + ALL proofs on ONE page
  // ---------------------------------------------------------
  const billLabel = (expense, isCompany) =>
    isCompany ? `BILL NO: C-${companyNo(expense)}` : `BILL NO: ${expense.billNo ?? '-'}`;

  // Yellow bar for employee bills, light-red bar for company bills.
  const drawHeaderBar = (page, label, isCompany) => {
    const y = H - BAR_TOP - BAR_H;
    box(page, M, y, CONTENT_W, BAR_H, isCompany ? C.redBar : C.yellow, isCompany ? C.red : C.yellowBorder, 1);
    drawText(page, label, M + 16, y + 15, { size: 24, bold: true, color: isCompany ? C.red : C.navy });
  };

  // Draws the details panel; returns the y of its bottom edge.
  const drawDetails = (page, expense, isCompany) => {
    const accent = isCompany ? C.red : C.navy;

    const rows = isCompany
      ? [
          ['Expense Date', fmtDate(expense.date)],
          ['Reason', expense.reason || '-'],
          ['Members', getMembers(expense).join(', ') || '-'],
          ['Paid By', expense.paidBy || 'Company'],
          ['Bill Type', 'Company Expense'],
        ]
      : [
          ['Employee', getEmployeeName(expense, names)],
          ['Expense Date', fmtDate(expense.date)],
          ['Reason', expense.reason || '-'],
          ['Members', getMembers(expense).join(', ') || '-'],
          ['Paid By', expense.paidBy || '-'],
          ['Status', formatStatus(expense.status)],
        ];

    const labelW = 104;
    const amountW = 140;
    const panelW = CONTENT_W - amountW - 10;
    const valueW = panelW - labelW - 16;
    const size = 9;
    const lh = 11.5;

    const prepared = rows.map(([label, value]) => {
      const lines = limitLines(wrapText(value, font, size, valueW), 3, font, size, valueW);
      return { label, lines, height: Math.max(26, lines.length * lh + 12) };
    });

    const totalH = prepared.reduce((s, r) => s + r.height, 0);
    const top = H - HEADER_H - 16;
    let y = top;

    for (const row of prepared) {
      const bottom = y - row.height;
      box(page, M, bottom, labelW, row.height, C.light, C.border, 0.5);
      box(page, M + labelW, bottom, panelW - labelW, row.height, C.white, C.border, 0.5);

      drawText(page, row.label, M + 8, y - row.height / 2 - 3, { size: 8.5, bold: true, color: C.navy });

      const startY = y - row.height / 2 + ((row.lines.length - 1) * lh) / 2 - 3;
      row.lines.forEach((line, i) => {
        drawText(page, line, M + labelW + 8, startY - i * lh, { size });
      });
      y = bottom;
    }

    // Amount card (same height as the panel)
    const ax = M + panelW + 10;
    box(
      page,
      ax,
      top - totalH,
      amountW,
      totalH,
      isCompany ? C.redLight : C.blueLight,
      isCompany ? C.redBorder : C.blueBorder,
      0.8
    );
    drawText(page, 'TOTAL AMOUNT', ax + 10, top - 22, { size: 7.5, bold: true, color: accent });
    const amount = money(expense.amount);
    const aSize = fitSize(amount, bold, 16, 8, amountW - 20);
    drawText(page, amount, ax + 10, top - 46, { size: aSize, bold: true, color: accent });

    return top - totalH;
  };

  // ---- Proof loading: one item per proof file, whatever its type or state ----
  const usedAttachmentNames = new Set();
  const attachmentName = (label, k, name) => {
    let base = clean(`${label}-Proof-${k}-${name || 'proof'}`).replace(/[^A-Za-z0-9._-]+/g, '_');
    if (!/\.pdf$/i.test(base)) base += '.pdf';
    while (usedAttachmentNames.has(base)) base = `_${base}`;
    usedAttachmentNames.add(base);
    return base;
  };

  const loadProofItems = async (expense, label) => {
    const metas = proofsOf(expense);
    const items = [];

    for (let i = 0; i < Math.min(metas.length, MAX_ON_PAGE); i += 1) {
      const name = metas[i].originalName || `Proof ${i + 1}`;
      let got = null;
      try {
        got = await store.readProofAt(expense, i);
      } catch (err) {
        got = null;
      }
      if (!got || !got.buf || !got.buf.length) {
        items.push({ name, kind: 'missing' });
        continue;
      }

      const type = detectProofType({ proofMime: got.mime }, got.buf);
      try {
        if (type === 'png' || type === 'jpg') {
          const img = type === 'png' ? await doc.embedPng(got.buf) : await doc.embedJpg(got.buf);
          items.push({ name, kind: 'image', img, w: img.width, h: img.height });
        } else if (type === 'pdf') {
          const source = await PDFDocument.load(got.buf, { ignoreEncryption: true });
          const pages = source.getPageCount();
          const [first] = await doc.embedPdf(source, [0]); // a one-page preview of the proof
          if (pages > 1) {
            // Keep the complete original inside this report (PDF "Attachments" panel), so no page is lost.
            await doc.attach(new Uint8Array(got.buf), attachmentName(label, i + 1, name), {
              mimeType: 'application/pdf',
              description: `Complete original proof PDF (${pages} pages) for ${label}, proof file ${i + 1}`,
              creationDate: new Date(),
              modificationDate: new Date(),
            });
          }
          items.push({ name, kind: 'pdf', page: first, w: first.width, h: first.height, pages });
        } else {
          items.push({ name, kind: 'unsupported' });
        }
      } catch (err) {
        items.push({ name, kind: 'bad' });
      }
    }
    return { items, total: metas.length };
  };

  // ---- Grid layout: 1 proof = full width, 2 = side by side, 3-6 = compact grid ----
  const GAP = 8;
  const CELL_HEAD = 24;
  const NOTE_H = 15;

  const chooseGrid = (items, body) => {
    const n = items.length;
    if (n <= 1) return { cols: 1, rows: 1 };
    if (n === 2) return { cols: 2, rows: 1 }; // two proofs always sit side by side
    const options = n === 3 ? [[3, 1], [2, 2]] : n === 4 ? [[2, 2]] : [[3, 2]];
    let best = options[0];
    let bestScore = -1;
    for (const [cols, rows] of options) {
      const cw = (body.width - GAP * (cols - 1)) / cols;
      const ch = (body.height - GAP * (rows - 1)) / rows;
      const score = items.reduce((sum, it) => {
        if (!it.w) return sum;
        const s = Math.min((cw - 8) / it.w, (ch - CELL_HEAD - 8) / it.h, 1.5);
        return sum + (it.w * s * it.h * s) / (cw * ch); // share of the cell the proof fills
      }, 0);
      if (score > bestScore) { bestScore = score; best = [cols, rows]; }
    }
    return { cols: best[0], rows: best[1] };
  };

  const drawPlaceholder = (page, content, title, message) => {
    const h = Math.min(54, content.height - 8);
    if (h < 30) return;
    const y = content.y + (content.height - h) / 2;
    box(page, content.x + 6, y, content.width - 12, h, C.redLight, C.redBorder, 0.8);
    drawText(page, fitText(title, bold, 8.5, content.width - 24), content.x + 12, y + h - 17, { size: 8.5, bold: true, color: C.red });
    wrapText(message, font, 7.5, content.width - 24).slice(0, 2).forEach((l, i) => {
      drawText(page, l, content.x + 12, y + h - 29 - i * 9, { size: 7.5 });
    });
  };

  const drawCell = (page, cell, item, k, cols) => {
    const { x, y, w, h } = cell;
    box(page, x, y, w, h, C.white, C.blueBorder, 0.8);
    box(page, x, y + h - CELL_HEAD, w, CELL_HEAD, C.blueLight, C.blueBorder, 0.8);

    const labelSize = cols >= 3 ? 8.5 : 10;
    const label = `Proof File ${k}`;
    drawText(page, label, x + 8, y + h - CELL_HEAD + 8, { size: labelSize, bold: true, color: C.blue });
    const room = w - 16 - textWidth(label, bold, labelSize) - 10;
    drawRight(page, fitText(item.name, font, 7.5, room), x + w - 8, y + h - CELL_HEAD + 8.5, { size: 7.5 });

    const note = item.kind === 'pdf' && item.pages > 1;
    const noteH = note ? NOTE_H : 0;
    const content = { x: x + 4, y: y + 4 + noteH, width: w - 8, height: h - CELL_HEAD - 8 - noteH };

    if (item.kind === 'image') {
      const r = fitInto(item.w, item.h, content, 4, 1.5);
      page.drawImage(item.img, r);
      page.drawRectangle({ ...r, borderColor: C.border, borderWidth: 0.6 });
    } else if (item.kind === 'pdf') {
      const r = fitInto(item.w, item.h, content, 4, 1);
      page.drawPage(item.page, r);
      page.drawRectangle({ ...r, borderColor: C.border, borderWidth: 0.6 });
      if (note) {
        const msg = fitText(`PDF, ${item.pages} pages - page 1 shown. Full PDF is attached to this report.`, font, 7, w - 16);
        drawText(page, msg, x + 8, y + 6, { size: 7, color: C.muted });
      }
    } else if (item.kind === 'missing') {
      drawPlaceholder(page, content, 'PROOF UNAVAILABLE', 'This proof file is no longer available (removed by cleanup or could not be retrieved).');
    } else if (item.kind === 'bad') {
      drawPlaceholder(page, content, 'UNABLE TO DISPLAY PROOF', 'This file is damaged, protected or in an unsupported format.');
    } else {
      drawPlaceholder(page, content, 'UNSUPPORTED PROOF TYPE', 'Only PDF, JPG and PNG proofs can be shown.');
    }
  };

  const drawProofs = (page, detailsBottom, loaded) => {
    const { items, total } = loaded;
    const area = { x: M, y: FOOTER_SAFE, width: CONTENT_W, height: detailsBottom - 14 - FOOTER_SAFE };
    const TITLE_H = 30;

    box(page, area.x, area.y, area.width, area.height, C.light, C.blueBorder, 0.8);
    box(page, area.x, area.y + area.height - TITLE_H, area.width, TITLE_H, C.soft, C.blueBorder, 0.8);
    drawText(page, total > 1 ? 'ATTACHED EXPENSE PROOFS' : 'ATTACHED EXPENSE PROOF', area.x + 12, area.y + area.height - 20, {
      size: 12, bold: true, color: C.navy,
    });
    if (total > MAX_ON_PAGE) {
      drawRight(page, `Layout warning: ${total} proofs, only the first ${MAX_ON_PAGE} fit on one page`, area.x + area.width - 12, area.y + area.height - 19, {
        size: 8, bold: true, color: C.red,
      });
    }

    const body = { x: area.x + 8, y: area.y + 8, width: area.width - 16, height: area.height - TITLE_H - 16 };
    if (!items.length) {
      drawPlaceholder(page, { ...body, y: body.y + body.height / 2 - 40, height: 80 }, 'NO PROOF ATTACHED', 'No proof file is attached to this bill.');
      return;
    }

    const { cols, rows } = chooseGrid(items, body);
    const cw = (body.width - GAP * (cols - 1)) / cols;
    const ch = (body.height - GAP * (rows - 1)) / rows;

    items.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      drawCell(page, {
        x: body.x + col * (cw + GAP),
        y: body.y + body.height - (row + 1) * ch - row * GAP,
        w: cw,
        h: ch,
      }, item, i + 1, cols);
    });
  };

  const renderBill = async (expense, isCompany) => {
    const page = doc.addPage([W, H]); // exactly one page per bill, however many proofs it has
    const label = isCompany ? `C-${companyNo(expense)}` : `Bill-${expense.billNo}`;

    drawHeaderBar(page, billLabel(expense, isCompany), isCompany);
    const detailsBottom = drawDetails(page, expense, isCompany);
    drawProofs(page, detailsBottom, await loadProofItems(expense, label));
  };

  // ---------------------------------------------------------
  // Footer on every page
  // ---------------------------------------------------------
  const addFooters = () => {
    const pages = doc.getPages();
    const total = pages.length;
    const college = clean(project.collegeName || 'Project');

    pages.forEach((page, index) => {
      page.drawLine({
        start: { x: M, y: 25 },
        end: { x: W - M, y: 25 },
        thickness: 0.6,
        color: C.border,
      });
      drawText(page, `Project Expense Report | ${college}`, M, 12, { size: 7, color: C.muted });
      drawRight(page, `Page ${index + 1} of ${total}`, W - M, 12, { size: 7, color: C.muted });
    });
  };

  // ---------------------------------------------------------
  // Build
  // ---------------------------------------------------------
  await renderCover();

  for (const expense of employeeBills) {
    await renderBill(expense, false);
  }
  for (const expense of companyBills) {
    await renderBill(expense, true);
  }

  addFooters();

  return Buffer.from(await doc.save());
};