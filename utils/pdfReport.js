/**
 * Professional PDF quality report generator.
 * Uses PDFKit (no Chromium dependency).
 *
 * Layout (A4 portrait):
 *   1. Navy header band — title, timestamp, grade badge
 *   2. Executive summary — 4 KPI cards
 *   3. Backlog Health Index — score, grade, formula, penalty math
 *   4. Quality dimensions — table with weighted bars
 *   5. Issue breakdown — bar chart
 *   6. Recommendations — numbered list
 *   7. Story-level quality — full table
 *   8. MCP execution log (if any)
 *   9. Footer with page numbers
 */

const PDFDocument = require('pdfkit');

const COLORS = {
  accent:    '#1f3a68',
  accentSoft:'#eef2f7',
  text:      '#111827',
  muted:     '#6b7280',
  soft:      '#9ca3af',
  border:    '#d1d5db',
  borderLite:'#e5e7eb',
  bg:        '#f7f8fa',
  good:      '#047857',
  goodBg:    '#ecfdf5',
  warn:      '#b45309',
  warnBg:    '#fffbeb',
  bad:       '#b91c1c',
  badBg:     '#fef2f2',
  white:     '#ffffff',
};

const PAGE_MARGIN = 40;

function gradeBgColor(grade) {
  return { A: '#10b981', B: '#0ea5e9', C: '#f59e0b', D: '#f97316', F: '#dc2626' }[grade] || COLORS.muted;
}

function scoreColor(score) {
  if (score >= 75) return COLORS.good;
  if (score >= 50) return COLORS.warn;
  return COLORS.bad;
}

const ISSUE_LABEL = {
  missing_acceptance_criteria: 'Missing Acceptance Criteria',
  invalid_story_points: 'Invalid Story Points',
  oversized_story: 'Oversized Story',
  orphan_story: 'Orphan Story',
  weak_title: 'Weak / Vague Title',
};

// Abbreviated versions for the compact story table
const ISSUE_SHORT = {
  missing_acceptance_criteria: 'Missing AC',
  invalid_story_points: 'Invalid Pts',
  oversized_story: 'Oversized',
  orphan_story: 'Orphan',
  weak_title: 'Weak Title',
};

const DIM_LABEL = {
  title: 'Title Clarity',
  description: 'Description Quality',
  acceptance_criteria: 'Acceptance Criteria',
  sizing: 'Sizing (Fibonacci)',
  context: 'Context / Structure',
};

const DIM_WEIGHT_KEY = {
  title: 'T',
  description: 'D',
  acceptance_criteria: 'A',
  sizing: 'S',
  context: 'C',
};

// ──────────────────────────────────────────────────────────
//  Drawing helpers
// ──────────────────────────────────────────────────────────

function ensureSpace(doc, needed) {
  if (doc.y + needed > doc.page.height - 55) {
    doc.addPage();
  }
}

function sectionTitle(doc, title) {
  ensureSpace(doc, 60);
  doc.moveDown(0.2);
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(COLORS.muted)
    .text(title.toUpperCase(), PAGE_MARGIN, doc.y, { characterSpacing: 1 });
  const y = doc.y + 2;
  doc
    .moveTo(PAGE_MARGIN, y)
    .lineTo(doc.page.width - PAGE_MARGIN, y)
    .strokeColor(COLORS.borderLite)
    .lineWidth(0.5)
    .stroke();
  doc.moveDown(0.3);
  doc.fillColor(COLORS.text).font('Helvetica');
}

function drawHeader(doc, report) {
  // Navy band
  doc.rect(0, 0, doc.page.width, 90).fill(COLORS.accent);

  // Title
  doc
    .fillColor(COLORS.white)
    .font('Helvetica-Bold')
    .fontSize(20)
    .text('Backlog Quality Report', PAGE_MARGIN, 28);

  // Subtitle / timestamp
  const ts = new Date(report.generated_at);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#cbd5e1')
    .text(
      `Generated ${ts.toLocaleString()} - AI-Driven Backlog Quality Gate (MCP)`,
      PAGE_MARGIN,
      56
    );

  // Grade badge
  const bhi = report.backlog_health_index;
  if (bhi) {
    const badgeW = 80, badgeH = 48;
    const badgeX = doc.page.width - PAGE_MARGIN - badgeW;
    const badgeY = 21;
    doc.rect(badgeX, badgeY, badgeW, badgeH).fill(gradeBgColor(bhi.grade));
    doc
      .fillColor(COLORS.white)
      .font('Helvetica-Bold')
      .fontSize(24)
      .text(bhi.grade, badgeX, badgeY + 6, { width: badgeW, align: 'center' });
    doc
      .fontSize(8)
      .font('Helvetica')
      .text(bhi.grade_label, badgeX, badgeY + 32, { width: badgeW, align: 'center' });
  }

  doc.fillColor(COLORS.text);
  doc.y = 110;
}

function drawSummary(doc, report) {
  sectionTitle(doc, 'Executive Summary');

  const bhi = report.backlog_health_index || {};
  const cards = [
    {
      label: 'BHI Score',
      value: bhi.bhi != null ? bhi.bhi.toFixed(1) : '—',
      sub: 'out of 100',
      color: COLORS.accent,
    },
    {
      label: 'Total Stories',
      value: String(report.summary.total_stories),
      sub: 'in backlog',
      color: COLORS.text,
    },
    {
      label: 'Stories with Issues',
      value: String(report.summary.stories_with_issues || 0),
      sub: report.summary.analyzed_stories
        ? `of ${report.summary.analyzed_stories} analyzed`
        : 'not yet analyzed',
      color: COLORS.bad,
    },
    {
      label: 'Critical Defect Rate',
      value: bhi.penalty ? (bhi.penalty.rho * 100).toFixed(1) + '%' : '—',
      sub: bhi.penalty ? `${bhi.penalty.critical_stories} critical` : '',
      color: COLORS.warn,
    },
  ];

  const totalW = doc.page.width - PAGE_MARGIN * 2;
  const gap = 8;
  const cardW = (totalW - gap * (cards.length - 1)) / cards.length;
  const cardH = 58;
  const startY = doc.y;

  cards.forEach((card, i) => {
    const x = PAGE_MARGIN + i * (cardW + gap);
    doc
      .rect(x, startY, cardW, cardH)
      .fillAndStroke(COLORS.white, COLORS.borderLite);
    // top accent bar
    doc.rect(x, startY, cardW, 3).fill(card.color);
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .text(card.label.toUpperCase(), x + 10, startY + 11, {
        width: cardW - 20,
        characterSpacing: 0.4,
      });
    doc
      .fillColor(card.color)
      .font('Helvetica-Bold')
      .fontSize(18)
      .text(card.value, x + 10, startY + 23, { width: cardW - 20 });
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .fontSize(7.5)
      .text(card.sub, x + 10, startY + 45, { width: cardW - 20 });
  });

  doc.y = startY + cardH + 10;
  doc.fillColor(COLORS.text);
}

function drawBHI(doc, report) {
  const bhi = report.backlog_health_index;
  if (!bhi) return;

  sectionTitle(doc, 'Backlog Health Index');

  doc.font('Helvetica').fontSize(10).fillColor(COLORS.text);
  const startY = doc.y;

  // Score & grade summary line
  doc.text('Final Score: ', PAGE_MARGIN, startY, { continued: true });
  doc.font('Helvetica-Bold').text(`${bhi.bhi.toFixed(1)} / 100`, { continued: true });
  doc.font('Helvetica').text('     Grade: ', { continued: true });
  doc.font('Helvetica-Bold').text(`${bhi.grade} (${bhi.grade_label})`);

  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted);
  const bhiW = doc.page.width - PAGE_MARGIN * 2;
  doc.text(`Raw weighted aggregate (before penalty): ${bhi.bhi_raw.toFixed(1)}`, PAGE_MARGIN, doc.y, { width: bhiW, lineBreak: false });
  doc.y += 13;
  doc.text(
    `Critical-defect penalty: × ${bhi.penalty.multiplier}   ` +
      `(rho = ${(bhi.penalty.rho * 100).toFixed(1)}%, lambda = ${bhi.penalty.lambda}, ` +
      `${bhi.penalty.critical_stories} critical stories)`,
    PAGE_MARGIN, doc.y, { width: bhiW, lineBreak: false }
  );
  doc.y += 13;
  doc.text(
    `Consistency: sigma = ${bhi.consistency.stddev.toFixed(1)}   ` +
      `(${bhi.consistency.interpretation}) - mean Q = ${bhi.consistency.mean_quality.toFixed(1)}`,
    PAGE_MARGIN, doc.y, { width: bhiW, lineBreak: false }
  );
  doc.y += 13;

  // Formula in shaded box
  doc.moveDown(0.3);
  const formulaY = doc.y;
  const formulaH = 26;
  doc
    .rect(PAGE_MARGIN, formulaY, doc.page.width - PAGE_MARGIN * 2, formulaH)
    .fillAndStroke(COLORS.bg, COLORS.borderLite);
  doc
    .fillColor(COLORS.muted)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('FORMULA', PAGE_MARGIN + 10, formulaY + 6, { characterSpacing: 0.5 });
  doc
    .fillColor(COLORS.text)
    .font('Courier')
    .fontSize(10)
    .text(
      'BHI = (0.20*T + 0.10*D + 0.30*A + 0.25*S + 0.15*C) * (1 - 0.4*rho)',
      PAGE_MARGIN + 10,
      formulaY + 17
    );

  doc.y = formulaY + formulaH + 12;
  doc.fillColor(COLORS.text).font('Helvetica');
}

function drawDimensions(doc, report) {
  const bhi = report.backlog_health_index;
  if (!bhi || !bhi.dimensions) return;

  sectionTitle(doc, 'Quality Dimensions');

  const startX = PAGE_MARGIN;
  const colWidth = doc.page.width - PAGE_MARGIN * 2;

  // Header
  const headerY = doc.y;
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text('DIMENSION', startX, headerY, { width: 200, characterSpacing: 0.5 });
  doc.text('WEIGHT', startX + 200, headerY, { width: 50, align: 'right' });
  doc.text('SCORE', startX + 260, headerY, { width: 50, align: 'right' });
  doc.text('VISUAL', startX + 330, headerY, { width: 100 });
  doc.text('CONTRIB', startX + colWidth - 60, headerY, { width: 60, align: 'right' });

  doc.moveDown(0.4);
  doc.moveTo(startX, doc.y).lineTo(startX + colWidth, doc.y).strokeColor(COLORS.borderLite).stroke();
  doc.moveDown(0.3);

  Object.entries(DIM_LABEL).forEach(([key, label]) => {
    const score = bhi.dimensions[key] ?? 0;
    const wKey = DIM_WEIGHT_KEY[key];
    const weight = bhi.weights[wKey] || 0;
    const contrib = score * weight;

    const rowY = doc.y;
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(COLORS.text)
      .text(label, startX, rowY, { width: 200 });
    doc
      .fillColor(COLORS.muted)
      .text(weight.toFixed(2), startX + 200, rowY, { width: 50, align: 'right' });
    doc
      .fillColor(COLORS.text)
      .font('Helvetica-Bold')
      .text(score.toFixed(1), startX + 260, rowY, { width: 50, align: 'right' });

    // Bar
    const barX = startX + 330;
    const barW = colWidth - 330 - 70;
    const barY = rowY + 4;
    const barH = 6;
    doc.rect(barX, barY, barW, barH).fill(COLORS.borderLite);
    const fillW = Math.max(2, (score / 100) * barW);
    doc.rect(barX, barY, fillW, barH).fill(scoreColor(score));

    doc
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .fontSize(9)
      .text(`+${contrib.toFixed(1)}`, startX + colWidth - 60, rowY, { width: 60, align: 'right' });

    doc.y = rowY + 20;
  });

  doc.fillColor(COLORS.text);
  doc.moveDown(0.2);
}

function drawIssues(doc, report) {
  const breakdown = report.issue_breakdown || {};
  const total = Object.values(breakdown).reduce((s, n) => s + n, 0);
  if (total === 0) return;

  sectionTitle(doc, 'Issue Breakdown');

  const startX = PAGE_MARGIN;
  const colWidth = doc.page.width - PAGE_MARGIN * 2;
  const max = Math.max(...Object.values(breakdown));

  Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])
    .forEach(([key, count]) => {
      const rowY = doc.y;
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(COLORS.text)
        .text(ISSUE_LABEL[key] || key, startX, rowY, { width: 220 });

      const barX = startX + 230;
      const barW = colWidth - 230 - 50;
      const barY = rowY + 4;
      const barH = 8;
      doc.rect(barX, barY, barW, barH).fill(COLORS.borderLite);
      const fillW = Math.max(2, (count / max) * barW);
      doc.rect(barX, barY, fillW, barH).fill(COLORS.bad);

      doc
        .fillColor(COLORS.text)
        .font('Helvetica-Bold')
        .text(String(count), startX + colWidth - 50, rowY, { width: 50, align: 'right' });

      doc.y = rowY + 20;
    });

  doc.moveDown(0.2);
  doc.fillColor(COLORS.text).font('Helvetica');
}

function drawRecommendations(doc, report) {
  const recs = report.recommendations || [];
  if (recs.length === 0) return;

  sectionTitle(doc, 'Recommendations');

  doc.font('Helvetica').fontSize(10).fillColor(COLORS.text);

  const recTextWidth = doc.page.width - PAGE_MARGIN * 2 - 22;

  recs.forEach((rec, i) => {
    // Pre-measure the text height to avoid PDFKit auto-pagination
    doc.font('Helvetica').fontSize(9);
    const textH = doc.heightOfString(rec, { width: recTextWidth });
    const rowNeeded = Math.max(20, textH + 8);
    ensureSpace(doc, rowNeeded);

    const rowY = doc.y;
    // Number badge
    doc
      .rect(PAGE_MARGIN, rowY, 16, 16)
      .fillAndStroke(COLORS.accentSoft, COLORS.borderLite);
    doc
      .fillColor(COLORS.accent)
      .font('Helvetica-Bold')
      .fontSize(8)
      .text(String(i + 1), PAGE_MARGIN, rowY + 3, { width: 16, align: 'center' });

    doc
      .fillColor(COLORS.text)
      .font('Helvetica')
      .fontSize(9)
      .text(rec, PAGE_MARGIN + 22, rowY + 2, {
        width: recTextWidth,
        lineBreak: true,
      });

    // Advance y by the pre-measured height instead of letting doc.y drift
    doc.y = rowY + rowNeeded;
  });

  doc.moveDown(0.2);
}

function drawStoryTable(doc, report, backlog) {
  if (!backlog || backlog.length === 0) return;

  // Always start the story table on a fresh page for a clean 2-page layout
  doc.addPage();
  doc.y = PAGE_MARGIN + 4;
  // Draw section title inline (no ensureSpace needed — we're on a fresh page)
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(COLORS.muted)
    .text('STORY-LEVEL QUALITY', PAGE_MARGIN, doc.y, { characterSpacing: 1 });
  const titleLineY = doc.y + 2;
  doc
    .moveTo(PAGE_MARGIN, titleLineY)
    .lineTo(doc.page.width - PAGE_MARGIN, titleLineY)
    .strokeColor(COLORS.borderLite).lineWidth(0.5).stroke();
  doc.moveDown(0.3);
  doc.fillColor(COLORS.text).font('Helvetica');

  const startX = PAGE_MARGIN;
  const colWidth = doc.page.width - PAGE_MARGIN * 2;
  const cols = [
    { key: 'id',     label: 'ID',     width: 28,  align: 'left' },
    { key: 'title',  label: 'Title',  width: 220, align: 'left' },
    { key: 'pts',    label: 'Pts',    width: 30,  align: 'right' },
    { key: 'q',      label: 'Q',      width: 30,  align: 'right' },
    { key: 'issues', label: 'Issues', width: colWidth - 28 - 220 - 30 - 30, align: 'left' },
  ];

  // Build per-story map
  const perStoryQuality = {};
  if (report.backlog_health_index?.per_story) {
    report.backlog_health_index.per_story.forEach((p) => {
      perStoryQuality[p.story_id] = p.quality;
    });
  }
  const analysisMap = {};
  (report.story_details || []).forEach((a) => { analysisMap[a.story_id] = a; });

  // Header row
  const drawHeader = () => {
    let x = startX;
    const y = doc.y;
    doc.rect(startX, y - 2, colWidth, 16).fill(COLORS.bg);
    cols.forEach((c) => {
      doc
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .fillColor(COLORS.muted)
        .text(c.label.toUpperCase(), x + 4, y + 3, {
          width: c.width - 8,
          align: c.align,
          characterSpacing: 0.4,
        });
      x += c.width;
    });
    doc.y = y + 18;
  };

  drawHeader();

  backlog.forEach((story, idx) => {
    const quality = perStoryQuality[story.id];
    const analysis = analysisMap[story.id];
    const issues = analysis?.issues || [];
    const issuesText = issues.length === 0
      ? (analysis ? 'None' : '—')
      : issues.map((i) => ISSUE_SHORT[i] || i).join(', ');

    // Truncate long titles to guarantee single-line (220px col, 8.5pt ≈ 56 chars max)
    const rawTitle = story.title || '';
    const titleStr = rawTitle.length > 56 ? rawTitle.slice(0, 56) + '…' : rawTitle;

    // Pre-measure heights with truncated/abbreviated text
    const heightProbeWidth = cols[1].width - 8;
    const titleHeight = doc.heightOfString(titleStr, { width: heightProbeWidth, fontSize: 8.5 });
    const issuesHeight = doc.heightOfString(issuesText, { width: cols[4].width - 8, fontSize: 8 });
    const rowH = Math.max(18, Math.max(titleHeight, issuesHeight) + 6);

    if (doc.y + rowH > doc.page.height - 60) {
      doc.addPage();
      drawHeader();
    }

    const rowY = doc.y;

    // Alternating row stripe
    if (idx % 2 === 1) {
      doc.rect(startX, rowY, colWidth, rowH).fill('#fafbfc');
    }

    let x = startX;

    // ID
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(COLORS.muted)
      .text('#' + story.id, x + 2, rowY + 3, { width: cols[0].width - 4 });
    x += cols[0].width;

    // Title
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(COLORS.text)
      .text(titleStr, x + 4, rowY + 3, { width: cols[1].width - 8, lineGap: 0 });
    x += cols[1].width;

    // Points
    const ptsColor =
      story.story_points > 13 ? COLORS.bad :
      [1,2,3,5,8,13].includes(story.story_points) ? COLORS.good : COLORS.warn;
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(ptsColor)
      .text(String(story.story_points ?? '—'), x + 2, rowY + 3, {
        width: cols[2].width - 4,
        align: 'right',
      });
    x += cols[2].width;

    // Quality
    if (quality != null) {
      doc
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .fillColor(scoreColor(quality))
        .text(quality.toFixed(0), x + 2, rowY + 3, {
          width: cols[3].width - 4,
          align: 'right',
        });
    } else {
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(COLORS.soft)
        .text('—', x + 2, rowY + 3, { width: cols[3].width - 4, align: 'right' });
    }
    x += cols[3].width;

    // Issues
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(issues.length > 0 ? COLORS.bad : COLORS.muted)
      .text(issuesText, x + 4, rowY + 3, { width: cols[4].width - 8, lineGap: 0 });

    doc.y = rowY + rowH;

    // row separator
    doc
      .moveTo(startX, doc.y)
      .lineTo(startX + colWidth, doc.y)
      .strokeColor(COLORS.borderLite)
      .lineWidth(0.3)
      .stroke();
  });

  doc.fillColor(COLORS.text).font('Helvetica');
  doc.moveDown(0.2);
}

function drawExecutionLog(doc, report) {
  const log = report.execution_log || [];
  if (log.length === 0) return;

  sectionTitle(doc, 'MCP Execution Log');

  doc.font('Helvetica').fontSize(9).fillColor(COLORS.text);

  log.slice(-15).forEach((entry) => {
    ensureSpace(doc, 24);
    const rowY = doc.y;

    // Status dot
    doc
      .circle(PAGE_MARGIN + 6, rowY + 6, 4)
      .fill(entry.status === 'success' ? COLORS.good : COLORS.bad);

    doc
      .fillColor(COLORS.text)
      .font('Helvetica')
      .fontSize(9)
      .text(entry.message || '', PAGE_MARGIN + 18, rowY, {
        width: doc.page.width - PAGE_MARGIN * 2 - 100,
      });

    doc
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .fontSize(8)
      .text(
        new Date(entry.timestamp).toLocaleString(),
        doc.page.width - PAGE_MARGIN - 100,
        rowY + 2,
        { width: 100, align: 'right' }
      );

    doc.moveDown(0.4);
  });

  doc.fillColor(COLORS.text);
}

function drawPageFooter(doc, pageNum) {
  // footerY + textHeight must stay < maxY (page.height - margin = 801).
  // At 8pt, line height ≈ 11px. So footerY must be < 801 - 11 = 790.
  const footerY = doc.page.height - PAGE_MARGIN - 20; // 841 - 40 - 20 = 781
  const savedY = doc.y;

  // Separator line above footer
  doc
    .moveTo(PAGE_MARGIN, footerY - 4)
    .lineTo(doc.page.width - PAGE_MARGIN, footerY - 4)
    .strokeColor(COLORS.borderLite)
    .lineWidth(0.4)
    .stroke();

  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(
      `Page ${pageNum}  ·  Backlog Quality Gate`,
      PAGE_MARGIN,
      footerY,
      { width: doc.page.width - PAGE_MARGIN * 2, align: 'center', lineBreak: false }
    );

  // Restore y so drawing continues where it was (not at footer position)
  doc.y = savedY;
}

// ──────────────────────────────────────────────────────────
//  Main entry
// ──────────────────────────────────────────────────────────

function generatePDF({ report, backlog }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: PAGE_MARGIN,
        bufferPages: false,
        autoFirstPage: true,
        info: {
          Title: 'Backlog Quality Report',
          Author: 'Backlog Quality Gate',
          Subject: 'AI-driven backlog analysis with MCP-controlled updates',
          Creator: 'Backlog Quality Gate',
          CreationDate: new Date(),
        },
      });

      const buffers = [];
      doc.on('data', (b) => buffers.push(b));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // ── Page 1: summary sections ──
      drawHeader(doc, report);
      drawSummary(doc, report);
      drawBHI(doc, report);
      drawDimensions(doc, report);
      drawIssues(doc, report);
      drawRecommendations(doc, report);
      drawPageFooter(doc, 1);

      // ── Page 2: story table + execution log ──
      drawStoryTable(doc, report, backlog);   // calls doc.addPage() internally
      drawExecutionLog(doc, report);
      drawPageFooter(doc, 2);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generatePDF };
