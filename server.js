require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// Mounted all the route modules here. I organized the routes by feature (analysis, mcp, reports etc) to keep things clean while implementing the full flow from the case study.
app.use('/backlog', require('./routes/backlog'));
app.use('/analyze', require('./routes/analyze'));
app.use('/fix', require('./routes/fix'));
app.use('/mcp', require('./routes/mcp'));
app.use('/report', require('./routes/report'));
app.use('/draft', require('./routes/draft'));

// Catch-all to serve the frontend SPA. This was the easiest way to handle client routing without a separate build step.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.listen(PORT, () => {
  console.log('\n======================================');
  console.log('  AI Backlog Quality Gate — MCP Demo');
  console.log('======================================');
  console.log(`  Server : http://localhost:${PORT}`);
  console.log(`  Model  : ${process.env.GROK_MODEL || 'grok-3-mini'}`);
  console.log('======================================\n');
});
