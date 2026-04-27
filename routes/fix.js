const express = require('express');
const fs = require('fs');
const path = require('path');
const { fixStory } = require('../agents/fixAgent');
const state = require('../utils/state');

const router = express.Router();
const BACKLOG_PATH = path.join(__dirname, '../data/backlog.json');

// POST /fix — generate AI fix for a story
// Body: { story_id: number }
// Requires analysis to have been run first (state.analysisCache[story_id])
router.post('/', async (req, res) => {
  try {
    const { story_id } = req.body;
    if (!story_id) return res.status(400).json({ success: false, error: 'story_id is required' });

    const backlog = JSON.parse(fs.readFileSync(BACKLOG_PATH, 'utf8'));
    const story = backlog.find((s) => s.id === story_id);
    if (!story) return res.status(404).json({ success: false, error: `Story #${story_id} not found` });

    const analysis = state.analysisCache[story_id];
    if (!analysis) {
      return res.status(400).json({
        success: false,
        error: 'Analysis not found. Run POST /analyze first.',
      });
    }

    const result = await fixStory(story, analysis);
    state.fixCache[story_id] = result;

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
