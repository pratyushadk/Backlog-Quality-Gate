/**
 * Shared in-memory state store.
 * Avoids duplicating state across route modules.
 */
const state = {
  /** story_id -> analysis result from analyzerAgent */
  analysisCache: {},

  /** story_id -> fix result from fixAgent */
  fixCache: {},

  /** story_id -> pending MCP action payload (awaiting approval) */
  mcpCache: {},

  /** Append-only log of all executed MCP actions */
  executionLog: [],
};

module.exports = state;
