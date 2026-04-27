const express = require('express');
const fs = require('fs');
const path = require('path');
const { analyzeStory } = require('../agents/analyzerAgent');
const state = require('../utils/state');

const router = express.Router();
const BACKLOG_PATH = path.join(__dirname, '../data/backlog.json');

function loadBacklog() {
  return JSON.parse(fs.readFileSync(BACKLOG_PATH, 'utf8'));
}

// POST /analyze — analyze a single story
// Body: { story_id: number }
router.post('/', async (req, res) => {
  try {
    const { story_id } = req.body;
    if (!story_id) return res.status(400).json({ success: false, error: 'story_id is required' });

    const story = loadBacklog().find((s) => s.id === story_id);
    if (!story) return res.status(404).json({ success: false, error: `Story #${story_id} not found` });

    const result = await analyzeStory(story);
    state.analysisCache[story_id] = result;

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /analyze/all — analyze every story in the backlog
router.post('/all', async (req, res) => {
  try {
    const backlog = loadBacklog();
    const results = await Promise.all(backlog.map((story) => analyzeStory(story)));
    results.forEach((r) => {
      state.analysisCache[r.story_id] = r;
    });
    res.json({ success: true, data: results, count: results.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
