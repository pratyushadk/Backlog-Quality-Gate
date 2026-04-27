const { callLLM } = require('../utils/llmClient');

/**
 * Generate AI-driven fixes and optional decomposition for a story.
 */
async function fixStory(story, analysis) {
  const needsDecomposition =
    analysis.issues.includes('oversized_story') || story.story_points > 13;

  const systemPrompt = `You are an expert scrum master and product owner who improves backlog quality.
Given a story and its detected issues, produce concrete improvements.

Rules:
1. Rewrite title in user story format: "As a [role], I want [action] so that [benefit]"
2. Story points MUST be a Fibonacci number: 1, 2, 3, 5, or 8 (max 13 for a single story — prefer ≤8)
3. Acceptance criteria must be specific and testable (3-5 items)
4. If the story is oversized, decompose it into 2-4 focused child stories (each ≤8 points)
5. Keep everything practical and clear for a development team

Return ONLY this exact JSON structure:
{
  "updated_story": {
    "title": "<improved user story title>",
    "description": "<clear 1-2 sentence description>",
    "story_points": <fibonacci number 1-13>,
    "acceptance_criteria": ["<criterion 1>", "<criterion 2>", "<criterion 3>"]
  },
  "decomposition": [
    {
      "title": "<child story title in user story format>",
      "description": "<brief description>",
      "story_points": <fibonacci number>,
      "acceptance_criteria": ["<criterion>"]
    }
  ],
  "explanation": "<2-3 sentences explaining what was improved and why>"
}

If no decomposition is needed, return an empty array for "decomposition".`;

  const userPrompt = `Fix this backlog story based on the detected issues.

Original Story:
${JSON.stringify(story, null, 2)}

Detected Issues: ${analysis.issues.join(', ')}
Analysis: ${analysis.explanation}
Needs decomposition: ${needsDecomposition}

Return the improved story as JSON.`;

  const result = await callLLM(systemPrompt, userPrompt);

  // Validate story_points is Fibonacci
  const FIBONACCI = [1, 2, 3, 5, 8, 13];
  if (result.updated_story && !FIBONACCI.includes(result.updated_story.story_points)) {
    // Snap to nearest valid Fibonacci value
    result.updated_story.story_points = FIBONACCI.reduce((prev, curr) =>
      Math.abs(curr - result.updated_story.story_points) <
      Math.abs(prev - result.updated_story.story_points)
        ? curr
        : prev
    );
  }

  return {
    story_id: story.id,
    original: story,
    updated_story: result.updated_story,
    decomposition: result.decomposition || [],
    explanation: result.explanation || 'Story improved by AI.',
  };
}

module.exports = { fixStory };
