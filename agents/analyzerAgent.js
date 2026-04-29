const { callLLM } = require('../utils/llmClient');

const FIBONACCI = new Set([0, 1, 2, 3, 5, 8, 13]);

/**
 * Rule based checks I put together early on. The case study stressed having reliable quality gates even if the LLM was down, so these act as a solid fallback. Tweaked the orphan story logic after testing with the sample data.
 */
function ruleBasedAnalysis(story) {
  const issues = [];

  if (!story.acceptance_criteria || story.acceptance_criteria.length === 0) {
    issues.push('missing_acceptance_criteria');
  }

  if (!FIBONACCI.has(story.story_points)) {
    issues.push('invalid_story_points');
  }

  if (story.story_points > 13) {
    if (!issues.includes('oversized_story')) {
      issues.push('oversized_story');
    }
  }

  const hasNoDescription = !story.description || story.description.trim().length < 10;
  const hasNoAC = !story.acceptance_criteria || story.acceptance_criteria.length === 0;
  if (!story.parent_id && hasNoDescription && hasNoAC) {
    issues.push('orphan_story');
  }

  return issues;
}

/**
 * Main analysis function. I combined the LLM call with the rules I wrote above. The prompt took some refining to get consistent JSON output from Grok.
 */
async function analyzeStory(story) {
  const systemPrompt = `You are a senior scrum master and backlog quality analyst.
Analyze the given user story and detect quality issues. Return ONLY a valid JSON object.

Valid issue types (use only these exact strings):
- "missing_acceptance_criteria"  — acceptance criteria are absent or too vague to test
- "invalid_story_points"         — story points are not in Fibonacci sequence (valid: 1,2,3,5,8,13)
- "oversized_story"              — story is too large (points > 13 OR semantically too broad for one sprint)
- "orphan_story"                 — story lacks purpose, has no description and no clear context
- "weak_title"                   — title is meaninglessly vague (e.g. "Fix the bug", "Do the thing")

Return this EXACT JSON structure:
{
  "story_id": <number>,
  "issues": ["issue_type_1", "issue_type_2"],
  "severity": "none|low|medium|high",
  "explanation": "<1-2 sentence plain-English summary of what is wrong>"
}

severity rules: none = 0 issues, low = 1 minor issue, medium = 1-2 issues, high = 3+ issues or oversized/orphan.
If the story is high quality, return an empty issues array and severity "none".`;

  const userPrompt = `Analyze this backlog story:\n${JSON.stringify(story, null, 2)}`;

  let llmResult = null;
  try {
    llmResult = await callLLM(systemPrompt, userPrompt);
  } catch (err) {
    console.warn(`[AnalyzerAgent] LLM unavailable for story #${story.id}: ${err.message}`);
  }

  const ruleIssues = ruleBasedAnalysis(story);
  const llmIssues = llmResult?.issues || [];

  // Merge: union of LLM + rule-based (deduplicated)
  const allIssues = [...new Set([...llmIssues, ...ruleIssues])];

  const severity =
    llmResult?.severity ||
    (allIssues.length >= 3 ? 'high' : allIssues.length >= 1 ? 'medium' : 'none');

  const explanation =
    llmResult?.explanation ||
    (allIssues.length > 0
      ? `Rule-based detection found: ${allIssues.join(', ')}`
      : 'No issues detected. Story appears well-formed.');

  return {
    story_id: story.id,
    issues: allIssues,
    severity,
    explanation,
  };
}

module.exports = { analyzeStory };
