const fs = require('fs');
const path = require('path');

const BACKLOG_PATH = path.join(__dirname, '../data/backlog.json');

function loadBacklog() {
  return JSON.parse(fs.readFileSync(BACKLOG_PATH, 'utf8'));
}

function saveBacklog(backlog) {
  fs.writeFileSync(BACKLOG_PATH, JSON.stringify(backlog, null, 2));
}

function nextId(backlog) {
  return backlog.reduce((max, s) => Math.max(max, s.id), 0) + 1;
}

/**
 * MCP Executor - this is the only place that actually writes to backlog.json.
 * I made sure the AI agents (analyzer and fix) can only propose changes. The human approval step in the frontend gates everything. This was important to match the "human in the loop" requirement from Use_Case_2.pdf.
 */
function executeActions(mcpPayload) {
  const backlog = loadBacklog();
  const logEntries = [];
  let newlyCreatedParentId = null;

  for (const action of mcpPayload.actions) {
    const timestamp = new Date().toISOString();

    try {
      if (action.action === 'create_story') {
        const newId = nextId(backlog);
        const newStory = { id: newId, ...action.payload.story };
        backlog.push(newStory);
        newlyCreatedParentId = newId;

        logEntries.push({
          action_id: action.action_id,
          action: 'create_story',
          story_id: newId,
          status: 'success',
          timestamp,
          message: `New story #${newId} created: "${newStory.title.slice(0, 50)}${newStory.title.length > 50 ? '...' : ''}"`,
        });

      } else if (action.action === 'update_story') {
        const idx = backlog.findIndex((s) => s.id === action.payload.story_id);
        if (idx === -1) throw new Error(`Story #${action.payload.story_id} not found in backlog`);

        backlog[idx] = { ...backlog[idx], ...action.payload.updates };

        logEntries.push({
          action_id: action.action_id,
          action: 'update_story',
          story_id: action.payload.story_id,
          status: 'success',
          timestamp,
          message: `Story #${action.payload.story_id} updated — title, story_points, and acceptance_criteria applied`,
        });

      } else if (action.action === 'create_child_stories') {
        const parentId =
          action.payload.parent_id === '__new_story__'
            ? newlyCreatedParentId
            : action.payload.parent_id;

        if (!parentId) throw new Error('Parent story id not resolved for child stories');

        const startId = nextId(backlog);
        const children = action.payload.children.map((child, i) => ({
          id: startId + i,
          ...child,
          parent_id: parentId,
          created_at: timestamp,
        }));

        backlog.push(...children);

        logEntries.push({
          action_id: action.action_id,
          action: 'create_child_stories',
          story_id: parentId,
          status: 'success',
          timestamp,
          message: `Created ${children.length} child stories (IDs: ${children.map((c) => c.id).join(', ')}) under parent #${parentId}`,
          created_ids: children.map((c) => c.id),
        });

      } else {
        throw new Error(`Unknown action type: "${action.action}"`);
      }
    } catch (err) {
      logEntries.push({
        action_id: action.action_id,
        action: action.action,
        status: 'error',
        timestamp,
        message: err.message,
      });
    }
  }

  saveBacklog(backlog);

  return {
    success: true,
    flow: mcpPayload.flow,
    story_id: mcpPayload.story_id || newlyCreatedParentId,
    executed_at: new Date().toISOString(),
    actions_executed: mcpPayload.actions.length,
    log: logEntries,
  };
}

module.exports = { executeActions };
