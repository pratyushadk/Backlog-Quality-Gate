const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { analyzeStory } = require('../agents/analyzerAgent');
const { fixStory } = require('../agents/fixAgent');
const { generateCreateActions } = require('../mcp/actionGenerator');
const { executeActions } = require('../mcp/executor');
const state = require('../utils/state');

const router = express.Router();

/**
 * POST /draft/process
 *
 * Single-shot pipeline for user-typed backlog entries.
 * Runs analyze + fix + MCP-action generation in one call,
 * but DOES NOT mutate the backlog. The frontend then shows
 * the before/after preview and the user explicitly approves.
 *
 * Body: { story: { title, description, story_points, acceptance_criteria, parent_id? } }
 * Returns: { draft_id, original, analysis, fix, mcp }
 */
router.post('/process', async (req, res) => {
  try {
    const { story } = req.body;
    if (!story || !story.title) {
      return res.status(400).json({ success: false, error: 'A story object with at least a title is required' });
    }

    const draftStory = {
      id: 'draft',
      title: story.title || '',
      description: story.description || '',
      story_points: Number(story.story_points) || 0,
      acceptance_criteria: Array.isArray(story.acceptance_criteria)
        ? story.acceptance_criteria.filter((s) => s && s.trim())
        : [],
      parent_id: story.parent_id || null,
      status: 'draft',
      type: 'story',
    };

    const analysis = await analyzeStory(draftStory);

    let fix = null;
    if (analysis.issues.length > 0) {
      fix = await fixStory(draftStory, analysis);
    } else {
      fix = {
        story_id: 'draft',
        original: draftStory,
        updated_story: { ...draftStory },
        decomposition: [],
        explanation: 'No issues detected. The story will be added to the backlog as-is.',
      };
    }

    const draftId = uuidv4();
    const mcp = generateCreateActions(draftId, fix);

    state.draftCache = state.draftCache || {};
    state.draftCache[draftId] = { original: draftStory, analysis, fix, mcp };

    res.json({
      success: true,
      data: {
        draft_id: draftId,
        original: draftStory,
        analysis,
        fix,
        mcp,
      },
    });
  } catch (err) {
    console.error('[draft/process]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /draft/refresh
 *
 * Re-generate the MCP action preview from a hand-edited story.
 * Used when the human reviewer modifies the AI-improved JSON in the UI
 * before approving — the MCP layer must reflect their final edits.
 *
 * Body: { draft_id, edited_story: { title, description, story_points, acceptance_criteria, parent_id? } }
 */
router.post('/refresh', (req, res) => {
  try {
    const { draft_id, edited_story, edited_decomposition } = req.body;
    if (!draft_id) return res.status(400).json({ success: false, error: 'draft_id is required' });

    state.draftCache = state.draftCache || {};
    const draft = state.draftCache[draft_id];
    if (!draft) return res.status(404).json({ success: false, error: 'Draft not found or expired' });

    const FIB = [1, 2, 3, 5, 8, 13];
    const snapFib = (n) => {
      const num = Number(n) || 0;
      return FIB.includes(num) ? num : FIB.reduce((p, c) => Math.abs(c - num) < Math.abs(p - num) ? c : p);
    };

    const updatedFix = { ...draft.fix };

    if (edited_story && typeof edited_story === 'object') {
      if (!edited_story.title || !String(edited_story.title).trim()) {
        return res.status(400).json({ success: false, error: 'edited_story with at least a title is required' });
      }
      const sanitizedAC = Array.isArray(edited_story.acceptance_criteria)
        ? edited_story.acceptance_criteria.filter((s) => typeof s === 'string' && s.trim())
        : [];
      updatedFix.updated_story = {
        title: String(edited_story.title || '').trim(),
        description: String(edited_story.description || '').trim(),
        story_points: snapFib(edited_story.story_points),
        acceptance_criteria: sanitizedAC,
        parent_id:
          edited_story.parent_id !== undefined
            ? edited_story.parent_id
            : draft.fix.updated_story?.parent_id ?? null,
      };
    }

    if (Array.isArray(edited_decomposition)) {
      updatedFix.decomposition = edited_decomposition.map((child) => ({
        title: String(child.title || '').trim(),
        description: String(child.description || '').trim(),
        story_points: snapFib(child.story_points),
        acceptance_criteria: Array.isArray(child.acceptance_criteria)
          ? child.acceptance_criteria.filter((s) => typeof s === 'string' && s.trim())
          : [],
      }));
    }

    const newMcp = generateCreateActions(draft_id, updatedFix);
    state.draftCache[draft_id] = { ...draft, fix: updatedFix, mcp: newMcp };

    res.json({
      success: true,
      data: {
        mcp: newMcp,
        updated_story: updatedFix.updated_story,
        decomposition: updatedFix.decomposition || [],
        edited_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[draft/refresh]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /draft/execute
 * Body: { draft_id, approved: boolean }
 */
router.post('/execute', (req, res) => {
  try {
    const { draft_id, approved } = req.body;
    if (!draft_id) return res.status(400).json({ success: false, error: 'draft_id is required' });

    state.draftCache = state.draftCache || {};
    const draft = state.draftCache[draft_id];

    if (!draft) {
      return res.status(404).json({ success: false, error: 'Draft not found or expired' });
    }

    if (!approved) {
      delete state.draftCache[draft_id];
      return res.json({
        success: true,
        data: {
          status: 'rejected',
          message: 'Draft rejected. Backlog unchanged.',
        },
      });
    }

    const result = executeActions(draft.mcp);
    state.executionLog.push(...result.log);
    delete state.draftCache[draft_id];

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[draft/execute]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
