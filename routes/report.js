const express = require('express');
const fs = require('fs');
const path = require('path');
const state = require('../utils/state');
const { computeBHI } = require('../utils/qualityModel');
const { generatePDF } = require('../utils/pdfReport');

const router = express.Router();
const BACKLOG_PATH = path.join(__dirname, '../data/backlog.json');

function generateRecommendations(issueBreakdown, bhi) {
  const recs = [];

  if (bhi && bhi.dimensions) {
    const lowest = Object.entries(bhi.dimensions).sort((a, b) => a[1] - b[1])[0];
    if (lowest && lowest[1] < 60) {
      const labels = {
        title: 'Title clarity is the weakest dimension. Rewrite vague titles in user-story format.',
        description: 'Description quality is low. Add 2-3 sentence summaries to each story.',
        acceptance_criteria: 'Acceptance criteria coverage is the weakest dimension. Aim for 3-5 testable criteria per story.',
        sizing: 'Sizing accuracy is the weakest dimension. Re-estimate stories using Fibonacci (1, 2, 3, 5, 8).',
        context: 'Context is the weakest dimension. Link stories to epics and provide background.',
      };
      recs.push(labels[lowest[0]]);
    }
  }

  if (issueBreakdown.missing_acceptance_criteria > 0)
    recs.push(`Add acceptance criteria to ${issueBreakdown.missing_acceptance_criteria} stories before sprint planning - untestable stories slow delivery.`);
  if (issueBreakdown.oversized_story > 0)
    recs.push(`Decompose ${issueBreakdown.oversized_story} oversized stories. Stories above 13 points cannot reliably fit in a sprint.`);
  if (issueBreakdown.invalid_story_points > 0)
    recs.push(`Re-estimate ${issueBreakdown.invalid_story_points} stories using the Fibonacci sequence (1, 2, 3, 5, 8, 13).`);
  if (issueBreakdown.orphan_story > 0)
    recs.push(`Provide context for ${issueBreakdown.orphan_story} orphan stories - link to epics and add descriptions.`);
  if (issueBreakdown.weak_title > 0)
    recs.push(`Rewrite ${issueBreakdown.weak_title} vague story titles using the "As a [role], I want [action] so that [benefit]" format.`);

  return recs;
}

/**
 * Shared report builder. Returns the full report data + the source backlog
 * so consumers (JSON endpoint and PDF generator) can render consistently.
 */
function buildReport() {
  const backlog = JSON.parse(fs.readFileSync(BACKLOG_PATH, 'utf8'));
  const analyses = Object.values(state.analysisCache);

  const issueBreakdown = {};
  analyses.forEach((a) => {
    a.issues.forEach((issue) => {
      issueBreakdown[issue] = (issueBreakdown[issue] || 0) + 1;
    });
  });

  const bhi = computeBHI(backlog, analyses);
  const storiesWithIssues = analyses.filter((a) => a.issues.length > 0).length;

  return {
    backlog,
    report: {
      generated_at: new Date().toISOString(),
      summary: {
        total_stories: backlog.length,
        analyzed_stories: analyses.length,
        stories_with_issues: storiesWithIssues,
        valid_stories: analyses.length - storiesWithIssues,
      },
      backlog_health_index: bhi,
      issue_breakdown: issueBreakdown,
      recommendations: generateRecommendations(issueBreakdown, bhi),
      execution_log: state.executionLog,
      execution_log_count: state.executionLog.length,
      story_details: analyses,
    },
  };
}

// GET /report — JSON quality report
router.get('/', (req, res) => {
  try {
    const { report } = buildReport();
    res.json({ success: true, data: report });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /report/pdf — downloadable PDF quality report
router.get('/pdf', async (req, res) => {
  try {
    const { backlog, report } = buildReport();
    const pdfBuffer = await generatePDF({ report, backlog });

    const filename = `backlog-quality-report-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[report/pdf]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /report/health — lightweight BHI snapshot for the dashboard
router.get('/health', (req, res) => {
  try {
    const backlog = JSON.parse(fs.readFileSync(BACKLOG_PATH, 'utf8'));
    const analyses = Object.values(state.analysisCache);
    const bhi = computeBHI(backlog, analyses);
    res.json({ success: true, data: bhi });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /report/export — download the current backlog as a JSON file
router.get('/export', (req, res) => {
  try {
    const backlog = JSON.parse(fs.readFileSync(BACKLOG_PATH, 'utf8'));
    res.setHeader('Content-Disposition', 'attachment; filename="updated_backlog.json"');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(backlog, null, 2));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
