const express = require('express');
const { generateUpdateActions } = require('../mcp/actionGenerator');
const { executeActions } = require('../mcp/executor');
const state = require('../utils/state');

const router = express.Router();

// POST /mcp/generate — convert fix result into structured MCP actions (simulation preview)
// Body: { story_id: number }
router.post('/generate', (req, res) => {
  try {
    const { story_id } = req.body;
    if (!story_id) return res.status(400).json({ success: false, error: 'story_id is required' });

    const fixResult = state.fixCache[story_id];
    if (!fixResult) {
      return res.status(400).json({
        success: false,
        error: 'Fix not found. Run POST /fix first.',
      });
    }

    const mcpPayload = generateUpdateActions(fixResult);
    state.mcpCache[story_id] = mcpPayload;

    res.json({ success: true, data: mcpPayload });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /mcp/refresh — re-run MCP generation with human-edited fix data
// Body: { story_id, edited_story?, edited_decomposition? }
router.post('/refresh', (req, res) => {
  try {
    const { story_id, edited_story, edited_decomposition } = req.body;
    if (!story_id) return res.status(400).json({ success: false, error: 'story_id is required' });

    const fixResult = state.fixCache[story_id];
    if (!fixResult) {
      return res.status(400).json({ success: false, error: 'Fix not found. Run /fix first.' });
    }

    if (edited_story && typeof edited_story === 'object') {
      if (!edited_story.title || !String(edited_story.title).trim()) {
        return res.status(400).json({ success: false, error: '"title" is required in edited_story.' });
      }
      const FIB = [1, 2, 3, 5, 8, 13];
      let pts = Number(edited_story.story_points);
      if (!FIB.includes(pts)) {
        pts = FIB.reduce((p, c) => Math.abs(c - pts) < Math.abs(p - pts) ? c : p);
      }
      fixResult.updated_story = {
        ...edited_story,
        story_points: pts,
        acceptance_criteria: Array.isArray(edited_story.acceptance_criteria) ? edited_story.acceptance_criteria : [],
      };
    }

    if (Array.isArray(edited_decomposition)) {
      const FIB = [1, 2, 3, 5, 8, 13];
      fixResult.decomposition = edited_decomposition.map((child) => {
        let pts = Number(child.story_points);
        if (!FIB.includes(pts)) {
          pts = FIB.reduce((p, c) => Math.abs(c - pts) < Math.abs(p - pts) ? c : p);
        }
        return {
          title: child.title || '',
          description: child.description || '',
          story_points: pts,
          acceptance_criteria: Array.isArray(child.acceptance_criteria) ? child.acceptance_criteria : [],
        };
      });
    }

    state.fixCache[story_id] = fixResult;
    const mcpPayload = generateUpdateActions(fixResult);
    state.mcpCache[story_id] = mcpPayload;

    res.json({
      success: true,
      data: {
        updated_story: fixResult.updated_story,
        decomposition: fixResult.decomposition || [],
        mcp: mcpPayload,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /mcp/execute — apply or reject pending MCP actions
// Body: { story_id: number, approved: boolean }
router.post('/execute', (req, res) => {
  try {
    const { story_id, approved } = req.body;
    if (!story_id) return res.status(400).json({ success: false, error: 'story_id is required' });

    if (!approved) {
      delete state.mcpCache[story_id];
      return res.json({
        success: true,
        status: 'rejected',
        message: 'Changes rejected by human reviewer. Backlog unchanged.',
      });
    }

    const mcpPayload = state.mcpCache[story_id];
    if (!mcpPayload) {
      return res.status(400).json({
        success: false,
        error: 'No pending MCP actions for this story. Generate actions first.',
      });
    }

    const result = executeActions(mcpPayload);

    // Archive to execution log and clear pending cache
    state.executionLog.push(...result.log);
    delete state.mcpCache[story_id];

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /mcp/log — return all executed actions history
router.get('/log', (req, res) => {
  res.json({ success: true, data: state.executionLog, count: state.executionLog.length });
});

module.exports = router;
