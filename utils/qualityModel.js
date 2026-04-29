/**
 * Backlog Health Index (BHI) model I created while working on the Chevron use case.
 * The case study wanted a way to quantify how good the backlog was, so I came up with this weighted scoring system.
 * Acceptance criteria got the highest weight because bad ACs always caused problems in past sprints I've seen.
 * The penalty for critical issues (oversized or orphan stories) was added after running it on the sample data - it really brings the score down when the backlog is messy.
 * The letter grades and consistency stddev were added to make the report more useful for reviewers.
 */

const WEIGHTS = { T: 0.20, D: 0.10, A: 0.30, S: 0.25, C: 0.15 };
const FIBONACCI = new Set([1, 2, 3, 5, 8, 13]);
const USER_STORY_REGEX = /\bas\s+(?:a|an)\b[\s\S]*\bi\s+want\b[\s\S]*\bso\s+that\b/i;
const PARTIAL_STORY_REGEX = /\bas\s+(?:a|an)\b[\s\S]*\bi\s+want\b/i;
const VAGUE_KEYWORDS = /^(fix|do|update|handle|implement)\s+(the\s+)?(thing|bug|stuff|issue|item)\b/i;

function scoreTitle(title) {
  const t = (title || '').trim();
  if (t.length === 0) return 0;
  if (USER_STORY_REGEX.test(t)) return 100;
  if (PARTIAL_STORY_REGEX.test(t)) return 70;
  if (VAGUE_KEYWORDS.test(t) || t.split(/\s+/).length < 5) return 10;
  return 40;
}

function scoreDescription(desc) {
  const d = (desc || '').trim();
  if (d.length === 0) return 0;
  return Math.min(100, 2 * d.length);
}

function scoreAcceptanceCriteria(ac) {
  if (!Array.isArray(ac) || ac.length === 0) return 0;
  const n = ac.length;
  const countScore = Math.min(100, 25 * n);
  const avgLen = ac.reduce((s, x) => s + (x?.length || 0), 0) / n;
  const qualScore = avgLen > 25 ? 100 : 60;
  return Math.round(0.7 * countScore + 0.3 * qualScore);
}

function scoreSizing(points) {
  const p = Number(points);
  if (FIBONACCI.has(p) && p <= 8) return 100;
  if (p === 13) return 60;
  if (p > 0 && p <= 13) return 30;
  return 0;
}

function scoreContext(story) {
  let score = 0;
  if ((story.description || '').trim().length > 0) score += 30;
  if (story.parent_id || story.type === 'epic') score += 30;
  if (Array.isArray(story.acceptance_criteria) && story.acceptance_criteria.length > 0) score += 40;
  return score;
}

// Scores individual story on the 5 dimensions I defined. The weights are applied here to get the final quality number.
function scoreStory(story) {
  const T = scoreTitle(story.title);
  const D = scoreDescription(story.description);
  const A = scoreAcceptanceCriteria(story.acceptance_criteria);
  const S = scoreSizing(story.story_points);
  const C = scoreContext(story);
  const Q = WEIGHTS.T * T + WEIGHTS.D * D + WEIGHTS.A * A + WEIGHTS.S * S + WEIGHTS.C * C;
  return {
    story_id: story.id,
    sub_scores: { title: T, description: D, acceptance_criteria: A, sizing: S, context: C },
    quality: Math.round(Q * 10) / 10,
  };
}

function letterGrade(bhi) {
  if (bhi >= 90) return 'A';
  if (bhi >= 75) return 'B';
  if (bhi >= 60) return 'C';
  if (bhi >= 40) return 'D';
  return 'F';
}

function gradeLabel(grade) {
  return {
    A: 'Excellent',
    B: 'Good',
    C: 'Acceptable',
    D: 'Needs Work',
    F: 'Critical',
  }[grade];
}

// Main function that calculates the overall BHI score for the whole backlog. I tested this extensively with the 10 sample stories to make sure the penalty and consistency metrics made sense.
function computeBHI(backlog, analyses = []) {
  const N = backlog.length;
  if (N === 0) {
    return null;
  }

  const stories = backlog.map(scoreStory);

  // Per-dimension averages
  const avg = (key) => stories.reduce((s, x) => s + x.sub_scores[key], 0) / N;
  const dimensions = {
    title: Math.round(avg('title') * 10) / 10,
    description: Math.round(avg('description') * 10) / 10,
    acceptance_criteria: Math.round(avg('acceptance_criteria') * 10) / 10,
    sizing: Math.round(avg('sizing') * 10) / 10,
    context: Math.round(avg('context') * 10) / 10,
  };

  // Raw weighted aggregate
  const bhi_raw =
    WEIGHTS.T * dimensions.title +
    WEIGHTS.D * dimensions.description +
    WEIGHTS.A * dimensions.acceptance_criteria +
    WEIGHTS.S * dimensions.sizing +
    WEIGHTS.C * dimensions.context;

  // Critical-defect penalty: ρ = oversized+orphan / N
  let critical_count = backlog.filter((s) => s.story_points > 13).length;
  if (analyses.length > 0) {
    const orphanCount = analyses.filter((a) => a.issues.includes('orphan_story')).length;
    critical_count += orphanCount;
  }
  const rho = critical_count / N;
  const lambda = 0.4;
  const bhi = bhi_raw * (1 - lambda * rho);

  // Consistency: stddev of Q_i
  const meanQ = stories.reduce((s, x) => s + x.quality, 0) / N;
  const variance = stories.reduce((s, x) => s + (x.quality - meanQ) ** 2, 0) / N;
  const sigma = Math.sqrt(variance);

  const grade = letterGrade(bhi);

  return {
    bhi: Math.round(bhi * 10) / 10,
    bhi_raw: Math.round(bhi_raw * 10) / 10,
    grade,
    grade_label: gradeLabel(grade),
    weights: WEIGHTS,
    dimensions,
    penalty: {
      rho: Math.round(rho * 1000) / 1000,
      lambda,
      multiplier: Math.round((1 - lambda * rho) * 1000) / 1000,
      critical_stories: critical_count,
    },
    consistency: {
      mean_quality: Math.round(meanQ * 10) / 10,
      stddev: Math.round(sigma * 10) / 10,
      interpretation:
        sigma < 10 ? 'highly consistent' : sigma < 25 ? 'moderately consistent' : 'high variance',
    },
    per_story: stories,
    formula:
      'BHI = (0.20·T̄ + 0.10·D̄ + 0.30·Ā + 0.25·S̄ + 0.15·C̄) · (1 − 0.4·ρ)',
  };
}

module.exports = { computeBHI, scoreStory, WEIGHTS };
