/* =================================================================
   Backlog Quality Gate — Frontend Application
   Orchestrates: BHI dashboard, existing-story flow, new-story flow,
   MCP preview, and human approval.
================================================================= */

const state = {
  backlog: [],
  analyses: {},
  bhi: null,
  currentStoryId: null,
  currentAnalysis: null,
  currentFix: null,
  currentMCP: null,
  currentDraftId: null,
  currentDraft: null,
};

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
  loadBacklog();
  bindEvents();
});

function bindEvents() {
  $('btn-analyze-all').addEventListener('click', analyzeAll);
  $('btn-new-story').addEventListener('click', openDraftModal);
  $('btn-download-pdf').addEventListener('click', downloadPDFReport);
  $('btn-download-report').addEventListener('click', downloadReport);
  $('btn-export-backlog').addEventListener('click', () => window.open('/report/export'));

  // Story-analysis modal
  $('modal-close-btn').addEventListener('click', closeModal);
  $('btn-close-after-exec').addEventListener('click', closeModal);
  $('modal-overlay').addEventListener('click', (e) => {
    if (e.target === $('modal-overlay')) closeModal();
  });
  $('btn-get-fix').addEventListener('click', () => runFix(state.currentStoryId));
  $('btn-gen-mcp').addEventListener('click', () => generateMCP(state.currentStoryId));
  $('btn-approve').addEventListener('click', () => executeMCP(state.currentStoryId, true));
  $('btn-reject').addEventListener('click', () => executeMCP(state.currentStoryId, false));
  $('fix-apply-edits-btn').addEventListener('click', applyExistingEdits);

  ['fix-json-before', 'fix-json-after', 'fix-decomp-json'].forEach((id) => {
    $(id).addEventListener('input', () => markFixEditsPending());
  });

  // Draft modal
  $('draft-close-btn').addEventListener('click', closeDraftModal);
  $('draft-cancel-btn').addEventListener('click', closeDraftModal);
  $('draft-done-btn').addEventListener('click', closeDraftModal);
  $('draft-overlay').addEventListener('click', (e) => {
    if (e.target === $('draft-overlay')) closeDraftModal();
  });
  $('draft-process-btn').addEventListener('click', processDraft);
  $('draft-edit-btn').addEventListener('click', backToDraftForm);
  $('draft-approve-btn').addEventListener('click', () => executeDraft(true));
  $('draft-reject-btn').addEventListener('click', () => executeDraft(false));
  $('draft-apply-edits-btn').addEventListener('click', applyDraftEdits);

  // Mark unsaved-edits state when user types in either pane
  ['draft-json-before', 'draft-json-after', 'draft-decomp-json'].forEach((id) => {
    $(id).addEventListener('input', () => markEditsPending());
  });
}

// ── API helper ──────────────────────────────────────────────────
async function api(method, endpoint, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(endpoint, opts);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Request failed');
  return data.data;
}

// ── Load backlog + BHI ──────────────────────────────────────────
async function loadBacklog() {
  try {
    const [backlog, bhi] = await Promise.all([
      api('GET', '/backlog'),
      api('GET', '/report/health'),
    ]);
    state.backlog = backlog;
    state.bhi = bhi;
    $('backlog-count').textContent = backlog.length;
    $('stat-total').textContent = backlog.length;
    renderBHI(bhi);
    renderBacklogTable();
    populateParentDropdown();
  } catch (err) {
    showToast('Failed to load backlog: ' + err.message, 'error');
  }
}

function populateParentDropdown() {
  const sel = $('draft-parent');
  sel.innerHTML = '<option value="">None</option>';
  state.backlog.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `#${s.id} — ${truncate(s.title, 60)}`;
    sel.appendChild(opt);
  });
}

// ── BHI Dashboard rendering ─────────────────────────────────────
function renderBHI(bhi) {
  if (!bhi) return;

  // Score ring
  const score = bhi.bhi || 0;
  const circumference = 2 * Math.PI * 52;
  const offset = circumference * (1 - score / 100);
  $('bhi-ring-fg').setAttribute('stroke-dashoffset', offset);
  $('bhi-ring-fg').setAttribute('stroke', colorForScore(score));
  $('bhi-score').textContent = score.toFixed(1);

  // Grade
  const gradeEl = $('bhi-grade');
  gradeEl.textContent = bhi.grade;
  gradeEl.className = 'bhi-grade grade-' + bhi.grade;
  $('bhi-grade-label').textContent = bhi.grade_label;

  // Dimensions
  Object.entries(bhi.dimensions).forEach(([key, val]) => {
    const fill = document.querySelector(`.bhi-dim-bar-fill[data-dim="${key}"]`);
    const num  = document.querySelector(`.bhi-dim-value[data-dim-val="${key}"]`);
    if (fill) {
      fill.style.width = val + '%';
      fill.className = 'bhi-dim-bar-fill ' + (val < 50 ? 'low' : val < 75 ? 'mid' : 'high');
    }
    if (num) num.textContent = val.toFixed(1);
  });

  // Stats
  $('stat-rho').textContent = (bhi.penalty.rho * 100).toFixed(1) + '%';
  $('stat-rho-sub').textContent = `${bhi.penalty.critical_stories} critical · ×${bhi.penalty.multiplier} penalty`;
  $('stat-sigma').textContent = bhi.consistency.stddev.toFixed(1);
  $('stat-sigma-sub').textContent = bhi.consistency.interpretation;
}

function colorForScore(score) {
  if (score >= 75) return '#047857';
  if (score >= 60) return '#1f3a68';
  if (score >= 40) return '#b45309';
  return '#b91c1c';
}

// ── Analyze all stories ─────────────────────────────────────────
async function analyzeAll() {
  const btn = $('btn-analyze-all');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Analyzing…';
  $('analyze-status').textContent = '';

  try {
    const results = await api('POST', '/analyze/all');
    results.forEach((r) => { state.analyses[r.story_id] = r; });

    const bhi = await api('GET', '/report/health');
    state.bhi = bhi;
    renderBHI(bhi);
    updateValidIssueStats();
    renderBacklogTable();
    renderRecommendations(results);

    $('analyze-status').textContent = `${results.length} stories analyzed · ${results.filter(r => r.issues.length).length} have issues`;
    showToast(`Analysis complete — ${results.filter(r => r.issues.length).length} issues found`, 'success');
  } catch (err) {
    showToast('Analysis failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Analyze All Stories';
  }
}

function updateValidIssueStats() {
  const analyses = Object.values(state.analyses);
  const withIssues = analyses.filter((a) => a.issues.length > 0).length;
  const valid = analyses.length - withIssues;
  const orphan = analyses.filter((a) => a.issues.includes('orphan_story')).length;
  $('stat-valid').textContent = valid;
  $('stat-issues').textContent = withIssues;
  $('stat-orphan').textContent = orphan;
}

function renderRecommendations(results) {
  // Build issue → [story_id, ...] map
  const issueStories = {};
  results.forEach((r) => {
    r.issues.forEach((issue) => {
      if (!issueStories[issue]) issueStories[issue] = [];
      issueStories[issue].push(r.story_id);
    });
  });

  // Format: "Story #1, #4, #7" or "Stories #1, #4, #7"
  function storyRef(ids) {
    const tags = ids.map((id) => `<strong>#${id}</strong>`).join(', ');
    return ids.length === 1 ? `Story ${tags}` : `Stories ${tags}`;
  }

  const recDefs = {
    missing_acceptance_criteria: (ids) =>
      `${storyRef(ids)} ${ids.length === 1 ? 'is' : 'are'} missing acceptance criteria — add 3-5 testable criteria before sprint planning.`,
    oversized_story: (ids) =>
      `${storyRef(ids)} ${ids.length === 1 ? 'is' : 'are'} oversized — decompose into sub-stories of ≤8 points each.`,
    invalid_story_points: (ids) =>
      `${storyRef(ids)} ${ids.length === 1 ? 'has' : 'have'} non-Fibonacci story points — re-estimate using 1, 2, 3, 5, 8, or 13.`,
    orphan_story: (ids) =>
      `${storyRef(ids)} ${ids.length === 1 ? 'is' : 'are'} orphaned — link to an epic and add a description.`,
    weak_title: (ids) =>
      `${storyRef(ids)} ${ids.length === 1 ? 'has a' : 'have'} vague title${ids.length === 1 ? '' : 's'} — rewrite in "As a [role], I want [action]" format.`,
  };

  // Preserve a consistent issue order
  const ORDER = ['missing_acceptance_criteria', 'oversized_story', 'invalid_story_points', 'orphan_story', 'weak_title'];
  const items = ORDER
    .filter((k) => issueStories[k])
    .map((k) => `<li>${recDefs[k](issueStories[k])}</li>`)
    .join('');

  if (items) {
    $('recommendations-list').innerHTML = items;
    $('recommendations-section').classList.remove('hidden');
  } else {
    $('recommendations-section').classList.add('hidden');
  }
}

// ── Backlog table ───────────────────────────────────────────────
function renderBacklogTable() {
  const FIBONACCI = new Set([1, 2, 3, 5, 8, 13]);
  const perStoryQuality = {};
  if (state.bhi && state.bhi.per_story) {
    state.bhi.per_story.forEach((p) => { perStoryQuality[p.story_id] = p.quality; });
  }

  const rows = state.backlog.map((story) => {
    const analysis = state.analyses[story.id];
    const hasIssues = analysis && analysis.issues.length > 0;
    const isAnalyzed = !!analysis;
    const quality = perStoryQuality[story.id];

    const spClass = story.story_points > 13 ? 'sp-bad' :
                    !FIBONACCI.has(story.story_points) ? 'sp-warn' : 'sp-good';

    const issueTags = isAnalyzed
      ? (analysis.issues.length === 0
          ? '<span class="issue-tag tag-none">Valid</span>'
          : analysis.issues.map((i) => `<span class="issue-tag tag-${i}">${formatIssueLabel(i)}</span>`).join(''))
      : '<span class="text-muted">Not analyzed</span>';

    const qBarClass = quality == null ? '' : quality < 50 ? 'low' : quality < 75 ? 'mid' : 'high';
    const qualityCell = quality == null
      ? '<span class="text-muted">—</span>'
      : `<div class="q-bar-row">
          <div class="q-bar-track"><div class="q-bar-fill ${qBarClass}" style="width:${quality}%"></div></div>
          <span class="q-bar-num">${quality.toFixed(0)}</span>
        </div>`;

    const titleClass = story.title.length > 80 ? 'story-title' : 'story-title';
    const meta = story.parent_id ? `<div class="story-meta">child of #${story.parent_id}</div>` : '';

    return `<tr data-id="${story.id}">
      <td class="td-id">
        <span class="status-dot ${isAnalyzed ? (hasIssues ? 'dot-issues' : 'dot-valid') : 'dot-pending'}"></span>${story.id}
      </td>
      <td class="td-title">
        <div class="${titleClass}" title="${escHtml(story.title)}">${truncate(escHtml(story.title), 95)}</div>
        ${meta}
      </td>
      <td class="td-points"><span class="sp-pill ${spClass}">${story.story_points}</span></td>
      <td class="td-quality">${qualityCell}</td>
      <td class="td-issues"><div class="issue-tags">${issueTags}</div></td>
      <td class="td-action">
        <button class="btn btn-sm btn-secondary" onclick="openModal(${story.id})">Analyze</button>
      </td>
    </tr>`;
  }).join('');

  $('backlog-tbody').innerHTML = rows || '<tr><td colspan="6" class="empty-state">No backlog items yet. Click "New Story" to add one.</td></tr>';
}

// ────────────────────────────────────────────────────────────────
//                 EXISTING-STORY ANALYZE/FIX FLOW
// ────────────────────────────────────────────────────────────────

async function openModal(storyId) {
  state.currentStoryId = storyId;
  state.currentAnalysis = null;
  state.currentFix = null;
  state.currentMCP = null;

  resetModal();
  $('modal-story-id').textContent = `#${storyId}`;
  $('modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';

  await runAnalysis(storyId);
}
window.openModal = openModal;

function closeModal() {
  $('modal-overlay').classList.remove('open');
  document.body.style.overflow = '';
  loadBacklog();
}

function resetModal() {
  setStep(1);
  ['section-fix','section-mcp','section-exec','section-decomp'].forEach((id) => $(id).classList.add('hidden'));
  ['analysis-result','analysis-loading','fix-result','fix-loading','btn-get-fix','btn-gen-mcp']
    .forEach((id) => $(id).classList.add('hidden'));
  $('btn-approve').disabled = false;
  $('btn-reject').disabled = false;
  $('btn-get-fix').disabled = false;
  $('btn-gen-mcp').disabled = false;
  $('analysis-issues').innerHTML = '';
  $('analysis-explanation').textContent = '';
  $('fix-json-before').value = '';
  $('fix-json-after').value = '';
  $('fix-decomp-json').value = '';
  $('mcp-actions-container').innerHTML = '';
  $('modal-exec-log').innerHTML = '';
  state.fixEditsPending = false;
  resetFixValidation();
}

async function runAnalysis(storyId) {
  $('analysis-loading').classList.remove('hidden');
  $('analysis-result').classList.add('hidden');
  $('btn-get-fix').classList.add('hidden');

  try {
    const result = await api('POST', '/analyze', { story_id: storyId });
    state.currentAnalysis = result;
    state.analyses[storyId] = result;

    $('analysis-severity').textContent = result.severity.toUpperCase();
    $('analysis-severity').className = `sev-${result.severity}`;
    $('analysis-explanation').textContent = result.explanation;

    if (result.issues.length === 0) {
      $('analysis-issues').innerHTML = '<span class="issue-tag tag-none">No issues detected — story looks good.</span>';
    } else {
      $('analysis-issues').innerHTML = result.issues
        .map((i) => `<span class="issue-tag tag-${i}">${formatIssueLabel(i)}</span>`).join('');
    }

    $('analysis-loading').classList.add('hidden');
    $('analysis-result').classList.remove('hidden');

    if (result.issues.length > 0) {
      $('btn-get-fix').classList.remove('hidden');
    }
  } catch (err) {
    $('analysis-loading').classList.add('hidden');
    showToast('Analysis error: ' + err.message, 'error');
  }
}

async function runFix(storyId) {
  $('section-fix').classList.remove('hidden');
  $('fix-loading').classList.remove('hidden');
  $('fix-result').classList.add('hidden');
  $('btn-get-fix').disabled = true;
  setStep(2);

  try {
    const result = await api('POST', '/fix', { story_id: storyId });
    state.currentFix = result;
    state.fixEditsPending = false;

    $('fix-explanation').textContent = result.explanation || '';

    const before = stripFields(result.original);
    const after = stripFields(result.updated_story || result.original);
    $('fix-json-before').value = JSON.stringify(before, null, 2);
    $('fix-json-after').value = JSON.stringify(after, null, 2);

    if (result.decomposition && result.decomposition.length > 0) {
      $('section-decomp').classList.remove('hidden');
      $('fix-decomp-json').value = JSON.stringify(
        result.decomposition.map(stripFields),
        null,
        2
      );
    } else {
      $('section-decomp').classList.add('hidden');
      $('fix-decomp-json').value = '';
    }

    resetFixValidation();
    $('fix-loading').classList.add('hidden');
    $('fix-result').classList.remove('hidden');
    $('btn-gen-mcp').classList.remove('hidden');
  } catch (err) {
    $('fix-loading').classList.add('hidden');
    $('btn-get-fix').disabled = false;
    showToast('Fix error: ' + err.message, 'error');
  }
}

function resetFixValidation() {
  state.fixEditsPending = false;
  const status = $('fix-validation-status');
  if (status) {
    status.className = 'status';
    status.textContent =
      'Tip: refine any pane, then click "Apply Edits" — the MCP action below will be regenerated to match your changes.';
  }
  ['fix-pane-before', 'fix-pane-after', 'fix-decomp-pane'].forEach((id) => {
    const el = $(id);
    if (el) el.classList.remove('invalid');
  });
}

function markFixEditsPending() {
  if (!state.currentStoryId || !state.currentFix) return;
  state.fixEditsPending = true;
  const status = $('fix-validation-status');
  if (status) {
    status.className = 'status';
    status.textContent =
      'You have unapplied edits. Click "Apply Edits & Refresh MCP" to sync them before approving.';
  }
}

/**
 * Validate parent + decomposition JSON, push edits to /mcp/refresh, and
 * update the MCP preview if it's already on screen.
 * Returns the refreshed payload on success, or null on failure.
 */
async function applyExistingEdits() {
  const status = $('fix-validation-status');
  const paneBefore = $('fix-pane-before');
  const paneAfter = $('fix-pane-after');
  const paneDecomp = $('fix-decomp-pane');

  paneBefore.classList.remove('invalid');
  paneAfter.classList.remove('invalid');
  paneDecomp.classList.remove('invalid');

  // Parse "AI Improved" pane (required)
  let afterObj;
  try {
    afterObj = JSON.parse($('fix-json-after').value);
  } catch (e) {
    paneAfter.classList.add('invalid');
    status.className = 'status bad';
    status.textContent = 'AI Improved pane: invalid JSON — ' + e.message;
    return null;
  }
  if (!afterObj.title || !String(afterObj.title).trim()) {
    paneAfter.classList.add('invalid');
    status.className = 'status bad';
    status.textContent = 'AI Improved pane: "title" is required.';
    return null;
  }

  // Parse "Original" pane only as a syntax check (we don't send it back —
  // the original story is immutable as a reference)
  try {
    JSON.parse($('fix-json-before').value);
  } catch (e) {
    paneBefore.classList.add('invalid');
    status.className = 'status bad';
    status.textContent = 'Original pane: invalid JSON — ' + e.message;
    return null;
  }

  // Parse decomposition (only if visible)
  let decompArr = null;
  const decompVisible = !$('section-decomp').classList.contains('hidden');
  if (decompVisible) {
    const txt = $('fix-decomp-json').value.trim();
    if (txt) {
      try {
        decompArr = JSON.parse(txt);
      } catch (e) {
        paneDecomp.classList.add('invalid');
        status.className = 'status bad';
        status.textContent = 'Decomposition pane: invalid JSON — ' + e.message;
        return null;
      }
      if (!Array.isArray(decompArr)) {
        paneDecomp.classList.add('invalid');
        status.className = 'status bad';
        status.textContent = 'Decomposition pane: must be a JSON array of child stories.';
        return null;
      }
      for (const [i, child] of decompArr.entries()) {
        if (!child || !child.title || !String(child.title).trim()) {
          paneDecomp.classList.add('invalid');
          status.className = 'status bad';
          status.textContent = `Decomposition pane: child #${i + 1} must have a "title".`;
          return null;
        }
      }
    } else {
      decompArr = [];
    }
  }

  const btn = $('fix-apply-edits-btn');
  btn.disabled = true;
  btn.textContent = 'Applying…';

  try {
    const body = { story_id: state.currentStoryId, edited_story: afterObj };
    if (decompArr !== null) body.edited_decomposition = decompArr;

    const result = await api('POST', '/mcp/refresh', body);
    state.currentFix.updated_story = result.updated_story;
    state.currentFix.decomposition = result.decomposition;
    state.currentMCP = result.mcp;
    state.fixEditsPending = false;

    // Live-update MCP preview if the user has already opened step 3
    if (!$('section-mcp').classList.contains('hidden')) {
      $('mcp-actions-container').innerHTML = renderMCPActions(result.mcp.actions);
    }

    status.className = 'status ok';
    status.textContent =
      'Edits applied. The MCP action has been regenerated to match your changes.';
    return result;
  } catch (err) {
    status.className = 'status bad';
    status.textContent = 'Failed to apply edits: ' + err.message;
    return null;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Apply Edits & Refresh MCP';
  }
}

async function generateMCP(storyId) {
  $('btn-gen-mcp').disabled = true;
  setStep(3);

  try {
    const result = await api('POST', '/mcp/generate', { story_id: storyId });
    state.currentMCP = result;

    $('mcp-actions-container').innerHTML = renderMCPActions(result.actions);
    $('section-mcp').classList.remove('hidden');
    $('section-mcp').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    $('btn-gen-mcp').disabled = false;
    showToast('MCP generation error: ' + err.message, 'error');
  }
}

async function executeMCP(storyId, approved) {
  // Sync any pending JSON edits through MCP before approving
  if (approved && state.fixEditsPending) {
    const refreshed = await applyExistingEdits();
    if (!refreshed) {
      showToast('Fix the JSON errors before approving.', 'error');
      return;
    }
  }

  $('btn-approve').disabled = true;
  $('btn-reject').disabled = true;

  try {
    const result = await api('POST', '/mcp/execute', { story_id: storyId, approved });

    setStep(4);
    $('section-exec').classList.remove('hidden');

    if (!approved || result.status === 'rejected') {
      $('exec-panel-head').textContent = 'Changes Rejected';
      $('modal-exec-log').innerHTML = `
        <li>
          <span class="exec-icon info">i</span>
          <span class="exec-msg">${escHtml(result.message || 'Changes rejected by reviewer.')}</span>
          <span class="exec-ts">${new Date().toLocaleTimeString()}</span>
        </li>`;
      showToast('Changes rejected. Backlog unchanged.', 'error');
    } else {
      $('exec-panel-head').textContent = 'MCP Execution Log';
      $('modal-exec-log').innerHTML = result.log.map(renderLogEntry).join('');
      appendGlobalLog(result.log);
      showToast('Changes applied via MCP.', 'success');
    }

    $('section-exec').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    $('btn-approve').disabled = false;
    $('btn-reject').disabled = false;
    showToast('Execution error: ' + err.message, 'error');
  }
}

// ────────────────────────────────────────────────────────────────
//                NEW-STORY DRAFT FLOW (user-typed)
// ────────────────────────────────────────────────────────────────

function openDraftModal() {
  resetDraftModal();
  $('draft-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeDraftModal() {
  $('draft-overlay').classList.remove('open');
  document.body.style.overflow = '';
  loadBacklog();
}

function resetDraftModal() {
  $('draft-form-section').classList.remove('hidden');
  $('draft-loading-section').classList.add('hidden');
  $('draft-result-section').classList.add('hidden');
  $('draft-done-section').classList.add('hidden');
  $('draft-decomp-panel').classList.add('hidden');
  $('draft-approve-btn').disabled = false;
  $('draft-reject-btn').disabled = false;
  // Don't clear form fields here so user can come back to edit
}

function backToDraftForm() {
  $('draft-form-section').classList.remove('hidden');
  $('draft-result-section').classList.add('hidden');
  $('draft-loading-section').classList.add('hidden');
}

async function processDraft() {
  const title = $('draft-title').value.trim();
  if (!title) {
    showToast('Title is required', 'error');
    return;
  }

  const story = {
    title,
    description: $('draft-description').value.trim(),
    story_points: Number($('draft-points').value) || 0,
    acceptance_criteria: $('draft-ac').value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    parent_id: $('draft-parent').value ? Number($('draft-parent').value) : null,
  };

  $('draft-form-section').classList.add('hidden');
  $('draft-loading-section').classList.remove('hidden');

  try {
    const result = await api('POST', '/draft/process', { story });
    state.currentDraftId = result.draft_id;
    state.currentDraft = result;
    renderDraftResult(result);
  } catch (err) {
    $('draft-loading-section').classList.add('hidden');
    $('draft-form-section').classList.remove('hidden');
    showToast('Processing failed: ' + err.message, 'error');
  }
}

function renderDraftResult(result) {
  $('draft-loading-section').classList.add('hidden');
  $('draft-result-section').classList.remove('hidden');

  // Analysis
  $('draft-severity').textContent = result.analysis.severity.toUpperCase();
  $('draft-severity').className = `sev-${result.analysis.severity}`;
  $('draft-explanation').textContent = result.analysis.explanation;
  if (result.analysis.issues.length === 0) {
    $('draft-issues').innerHTML = '<span class="issue-tag tag-none">No issues detected</span>';
  } else {
    $('draft-issues').innerHTML = result.analysis.issues
      .map((i) => `<span class="issue-tag tag-${i}">${formatIssueLabel(i)}</span>`).join('');
  }

  // Fix explanation
  $('draft-fix-explanation').textContent = result.fix.explanation || 'No improvements needed.';

  // JSON before/after (both editable)
  const before = stripFields(result.original);
  const after = stripFields(result.fix.updated_story || result.original);
  $('draft-json-before').value = JSON.stringify(before, null, 2);
  $('draft-json-after').value  = JSON.stringify(after, null, 2);
  resetValidationStatus();

  // Decomposition (editable JSON array)
  if (result.fix.decomposition && result.fix.decomposition.length > 0) {
    $('draft-decomp-panel').classList.remove('hidden');
    $('draft-decomp-json').value = JSON.stringify(
      result.fix.decomposition.map(stripFields),
      null,
      2
    );
  } else {
    $('draft-decomp-panel').classList.add('hidden');
    $('draft-decomp-json').value = '';
  }

  // MCP actions
  $('draft-mcp-container').innerHTML = renderMCPActions(result.mcp.actions);
}

/**
 * Validate both panes parse as JSON, and if there are pending edits,
 * push the edited "after" story to the backend to regenerate the MCP action.
 */
async function applyDraftEdits() {
  const beforeText = $('draft-json-before').value;
  const afterText  = $('draft-json-after').value;
  const paneBefore = $('json-pane-before');
  const paneAfter  = $('json-pane-after');
  const paneDecomp = $('draft-decomp-pane');
  const status     = $('json-validation-status');

  let beforeObj, afterObj;
  paneBefore.classList.remove('invalid');
  paneAfter.classList.remove('invalid');
  if (paneDecomp) paneDecomp.classList.remove('invalid');

  try {
    beforeObj = JSON.parse(beforeText);
  } catch (e) {
    paneBefore.classList.add('invalid');
    status.className = 'status bad';
    status.textContent = 'Original pane: invalid JSON — ' + e.message;
    return null;
  }

  try {
    afterObj = JSON.parse(afterText);
  } catch (e) {
    paneAfter.classList.add('invalid');
    status.className = 'status bad';
    status.textContent = 'AI Improved pane: invalid JSON — ' + e.message;
    return null;
  }

  if (!afterObj.title || !String(afterObj.title).trim()) {
    paneAfter.classList.add('invalid');
    status.className = 'status bad';
    status.textContent = 'AI Improved pane: "title" is required.';
    return null;
  }

  // Decomposition (only if its panel is visible)
  let decompArr = null;
  const decompVisible = !$('draft-decomp-panel').classList.contains('hidden');
  if (decompVisible) {
    const txt = $('draft-decomp-json').value.trim();
    if (txt) {
      try {
        decompArr = JSON.parse(txt);
      } catch (e) {
        paneDecomp.classList.add('invalid');
        status.className = 'status bad';
        status.textContent = 'Decomposition pane: invalid JSON — ' + e.message;
        return null;
      }
      if (!Array.isArray(decompArr)) {
        paneDecomp.classList.add('invalid');
        status.className = 'status bad';
        status.textContent = 'Decomposition pane: must be a JSON array.';
        return null;
      }
      for (const [i, child] of decompArr.entries()) {
        if (!child || !child.title || !String(child.title).trim()) {
          paneDecomp.classList.add('invalid');
          status.className = 'status bad';
          status.textContent = `Decomposition pane: child #${i + 1} must have a "title".`;
          return null;
        }
      }
    } else {
      decompArr = [];
    }
  }

  const btn = $('draft-apply-edits-btn');
  btn.disabled = true;
  btn.textContent = 'Applying…';

  try {
    const body = { draft_id: state.currentDraftId, edited_story: afterObj };
    if (decompArr !== null) body.edited_decomposition = decompArr;

    const result = await api('POST', '/draft/refresh', body);

    state.currentDraft.fix.updated_story = result.updated_story;
    state.currentDraft.fix.decomposition = result.decomposition || [];
    state.currentDraft.mcp = result.mcp;

    $('draft-mcp-container').innerHTML = renderMCPActions(result.mcp.actions);

    status.className = 'status ok';
    status.textContent = 'Edits applied. MCP action regenerated to match your changes.';
    state.draftEditsPending = false;
    return result;
  } catch (err) {
    status.className = 'status bad';
    status.textContent = 'Failed to apply edits: ' + err.message;
    return null;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Apply Edits & Refresh MCP';
  }
}

function markEditsPending() {
  if (!state.currentDraftId) return;
  state.draftEditsPending = true;
  const status = $('json-validation-status');
  status.className = 'status';
  status.textContent = 'You have unapplied edits. Click "Apply Edits" to regenerate the MCP action below.';
}

function resetValidationStatus() {
  state.draftEditsPending = false;
  const status = $('json-validation-status');
  status.className = 'status';
  status.textContent = 'Tip: refine either side, then click "Apply Edits" — the MCP action below will be regenerated to match your changes.';
  $('json-pane-before').classList.remove('invalid');
  $('json-pane-after').classList.remove('invalid');
}

async function executeDraft(approved) {
  // If approving with unsaved edits, sync them through MCP refresh first
  if (approved && state.draftEditsPending) {
    const refreshed = await applyDraftEdits();
    if (!refreshed) {
      showToast('Fix the JSON errors before approving.', 'error');
      return;
    }
  }

  $('draft-approve-btn').disabled = true;
  $('draft-reject-btn').disabled = true;

  try {
    const result = await api('POST', '/draft/execute', {
      draft_id: state.currentDraftId,
      approved,
    });

    $('draft-result-section').classList.add('hidden');
    $('draft-done-section').classList.remove('hidden');

    if (!approved || result.status === 'rejected') {
      $('draft-done-head').textContent = 'Draft Rejected';
      $('draft-exec-log').innerHTML = `
        <li>
          <span class="exec-icon info">i</span>
          <span class="exec-msg">${escHtml(result.message || 'Draft rejected. Backlog unchanged.')}</span>
          <span class="exec-ts">${new Date().toLocaleTimeString()}</span>
        </li>`;
      showToast('Draft rejected.', 'error');
    } else {
      $('draft-done-head').textContent = 'New Story Added';
      $('draft-exec-log').innerHTML = result.log.map(renderLogEntry).join('');
      appendGlobalLog(result.log);
      showToast('New story added to backlog.', 'success');

      // Clear form
      $('draft-title').value = '';
      $('draft-description').value = '';
      $('draft-points').value = '';
      $('draft-ac').value = '';
      $('draft-parent').value = '';
    }
  } catch (err) {
    $('draft-approve-btn').disabled = false;
    $('draft-reject-btn').disabled = false;
    showToast('Execution error: ' + err.message, 'error');
  }
}

// ────────────────────────────────────────────────────────────────
//                       SHARED RENDERING
// ────────────────────────────────────────────────────────────────

function renderMCPActions(actions) {
  return actions.map((action) => {
    const labelClass =
      action.action === 'update_story'        ? 'label-update' :
      action.action === 'create_story'        ? 'label-create' :
      action.action === 'create_child_stories'? 'label-children' : '';
    const labelText = action.action.toUpperCase().replace(/_/g, ' ');

    return `
      <div class="mcp-action">
        <span class="action-type-label ${labelClass}">${labelText}</span>
<span class="json-key">"action_id"</span>: <span class="json-string">"${action.action_id}"</span>
<span class="json-key">"action"</span>:    <span class="json-string">"${action.action}"</span>
<span class="json-key">"description"</span>: <span class="json-string">"${escHtml(action.description)}"</span>
<span class="json-key">"payload"</span>: ${highlightJSON(JSON.stringify(action.payload, null, 2)).replace(/\n/g, '\n  ')}</div>`;
  }).join('');
}

async function downloadPDFReport() {
  const btn = $('btn-download-pdf');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Generating PDF…';

  try {
    const res = await fetch('/report/pdf');
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed' }));
      throw new Error(err.error || `Server returned ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `backlog-quality-report-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.pdf`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);

    showToast('PDF report downloaded.', 'success');
  } catch (err) {
    showToast('Failed to generate PDF: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function downloadReport() {
  const btn = $('btn-download-report');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Generating…';

  try {
    const report = await api('GET', '/report');
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `backlog-quality-report-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    // Defer cleanup so the browser actually starts the download
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);

    showToast('Quality report downloaded.', 'success');
  } catch (err) {
    showToast('Failed to generate report: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function setStep(n) {
  for (let i = 1; i <= 4; i++) {
    const el = $(`step-${i}`);
    el.className = 'step-item' + (i === n ? ' active' : i < n ? ' done' : '');
    const num = el.querySelector('.step-num');
    num.textContent = i < n ? '✓' : i;
  }
}

function renderStoryFields(story) {
  if (!story) return '<p class="text-muted">No data</p>';
  const acList = story.acceptance_criteria?.length
    ? story.acceptance_criteria.map((ac) => `<li>${escHtml(ac)}</li>`).join('')
    : '<li>None</li>';
  const acClass = story.acceptance_criteria?.length ? 'ac-list' : 'ac-list empty';

  return `
    <div class="story-field">
      <label>Title</label>
      <div class="value">${escHtml(story.title || '—')}</div>
    </div>
    <div class="story-field">
      <label>Story Points</label>
      <div class="value">${story.story_points ?? '—'}</div>
    </div>
    <div class="story-field">
      <label>Acceptance Criteria (${story.acceptance_criteria?.length || 0})</label>
      <ul class="${acClass}">${acList}</ul>
    </div>`;
}

function renderLogEntry(entry) {
  const cls = entry.status === 'success' ? 'ok' : 'bad';
  const icon = entry.status === 'success' ? '✓' : '!';
  return `
    <li>
      <span class="exec-icon ${cls}">${icon}</span>
      <span class="exec-msg">${escHtml(entry.message)}</span>
      <span class="exec-ts">${new Date(entry.timestamp).toLocaleTimeString()}</span>
    </li>`;
}

function appendGlobalLog(entries) {
  $('global-log-section').classList.remove('hidden');
  const ul = $('global-exec-log');
  entries.forEach((e) => {
    const li = document.createElement('li');
    li.innerHTML = renderLogEntry(e).replace(/^\s*<li>|<\/li>\s*$/g, '');
    ul.prepend(li);
  });
}

function formatIssueLabel(issue) {
  const map = {
    missing_acceptance_criteria: 'Missing AC',
    invalid_story_points: 'Invalid Points',
    oversized_story: 'Oversized',
    orphan_story: 'Orphan',
    weak_title: 'Weak Title',
  };
  return map[issue] || issue;
}

function stripFields(story) {
  const out = {};
  ['title','description','story_points','acceptance_criteria','parent_id','status','type'].forEach((k) => {
    if (story[k] !== undefined) out[k] = story[k];
  });
  return out;
}

function highlightJSON(json) {
  const escaped = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/("(?:[^"\\]|\\.)*")(\s*:)/g, '<span class="json-key">$1</span>$2')
    .replace(/:\s*("(?:[^"\\]|\\.)*")/g, ': <span class="json-string">$1</span>')
    .replace(/:\s*(-?\d+\.?\d*)([,\n}\]])/g, ': <span class="json-number">$1</span>$2')
    .replace(/:\s*(true|false|null)([,\n}\]])/g, ': <span class="json-bool">$1</span>$2');
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function showToast(message, type = '') {
  const container = $('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity .3s';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
