const { v4: uuidv4 } = require('uuid');

/**
 * Turns the AI's suggested fixes into structured actions for the MCP layer.
 * This was the safety boundary I designed so that nothing gets written to the backlog without explicit human approval - exactly what the case study asked for.
 */

/**
 * Generate MCP actions for an UPDATE flow (fixing an existing story).
 */
function generateUpdateActions(fixResult) {
  const actions = [];
  const timestamp = new Date().toISOString();

  if (fixResult.updated_story) {
    actions.push({
      action_id: uuidv4(),
      action: 'update_story',
      timestamp,
      description: `Update story #${fixResult.story_id} with improved title, story_points=${fixResult.updated_story.story_points}, and ${fixResult.updated_story.acceptance_criteria?.length || 0} acceptance criteria`,
      payload: {
        story_id: fixResult.story_id,
        updates: {
          title: fixResult.updated_story.title,
          description: fixResult.updated_story.description,
          story_points: fixResult.updated_story.story_points,
          acceptance_criteria: fixResult.updated_story.acceptance_criteria,
          updated_at: timestamp,
        },
      },
    });
  }

  if (fixResult.decomposition && fixResult.decomposition.length > 0) {
    actions.push({
      action_id: uuidv4(),
      action: 'create_child_stories',
      timestamp,
      description: `Create ${fixResult.decomposition.length} child stories under story #${fixResult.story_id}`,
      payload: {
        parent_id: fixResult.story_id,
        children: fixResult.decomposition.map((child) => ({
          title: child.title,
          description: child.description || '',
          story_points: child.story_points,
          acceptance_criteria: child.acceptance_criteria || [],
          parent_id: fixResult.story_id,
          status: 'todo',
          type: 'story',
        })),
      },
    });
  }

  return {
    flow: 'update',
    story_id: fixResult.story_id,
    actions,
    generated_at: timestamp,
    requires_approval: true,
    status: 'pending',
    total_actions: actions.length,
  };
}

/**
 * Generate MCP actions for a CREATE flow (new draft story typed by the user).
 */
function generateCreateActions(draftId, fixResult) {
  const actions = [];
  const timestamp = new Date().toISOString();
  const finalStory = fixResult.updated_story || fixResult.original;

  actions.push({
    action_id: uuidv4(),
    action: 'create_story',
    timestamp,
    description: `Create new backlog story: "${finalStory.title.slice(0, 60)}${finalStory.title.length > 60 ? '...' : ''}"`,
    payload: {
      story: {
        title: finalStory.title,
        description: finalStory.description || '',
        story_points: finalStory.story_points,
        acceptance_criteria: finalStory.acceptance_criteria || [],
        parent_id: finalStory.parent_id || null,
        status: 'todo',
        type: 'story',
        created_at: timestamp,
      },
    },
  });

  if (fixResult.decomposition && fixResult.decomposition.length > 0) {
    actions.push({
      action_id: uuidv4(),
      action: 'create_child_stories',
      timestamp,
      description: `Create ${fixResult.decomposition.length} child stories under the newly created parent`,
      payload: {
        parent_id: '__new_story__',
        children: fixResult.decomposition.map((child) => ({
          title: child.title,
          description: child.description || '',
          story_points: child.story_points,
          acceptance_criteria: child.acceptance_criteria || [],
          status: 'todo',
          type: 'story',
        })),
      },
    });
  }

  return {
    flow: 'create',
    draft_id: draftId,
    actions,
    generated_at: timestamp,
    requires_approval: true,
    status: 'pending',
    total_actions: actions.length,
  };
}

module.exports = { generateUpdateActions, generateCreateActions };
