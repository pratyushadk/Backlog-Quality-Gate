const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const BACKLOG_PATH = path.join(__dirname, '../data/backlog.json');

// GET /backlog — return full backlog
router.get('/', (req, res) => {
  try {
    const backlog = JSON.parse(fs.readFileSync(BACKLOG_PATH, 'utf8'));
    res.json({ success: true, data: backlog, count: backlog.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
