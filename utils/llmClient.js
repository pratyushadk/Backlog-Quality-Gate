const OpenAI = require('openai');

let client = null;

function getClient() {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.GROK_API_KEY,
      baseURL: 'https://integrate.api.nvidia.com/v1',
    });
  }
  return client;
}

/**
 * Call the Grok LLM with a system + user prompt.
 * Returns a parsed JSON object when jsonMode is true.
 */
async function callLLM(systemPrompt, userPrompt, jsonMode = true) {
  // GLM-4.7 does not support response_format — enforce JSON via system prompt.
  const effectiveSystem = jsonMode
    ? `IMPORTANT: You must respond with ONLY a raw JSON object. No markdown, no code fences, no explanation text before or after. Start your response with { and end with }.\n\n${systemPrompt}`
    : systemPrompt;

  const effectiveUser = jsonMode
    ? `${userPrompt}\n\nRemember: respond with ONLY the JSON object, starting with {`
    : userPrompt;

  const params = {
    model: process.env.GROK_MODEL || 'grok-3-mini',
    messages: [
      { role: 'system', content: effectiveSystem },
      { role: 'user', content: effectiveUser },
    ],
    temperature: 0.1,
    top_p: 1,
    max_tokens: 4096,
    stream: false,  // NVIDIA GLM-4.7 defaults to stream:true — must explicitly set false
  };

  const response = await getClient().chat.completions.create(params);
  const message = response.choices[0].message;

  // reasoning_content fallback in case the model separates thinking from answer
  const content = message.content || message.reasoning_content;

  if (!content) {
    throw new Error('LLM returned an empty response (both content and reasoning_content are null).');
  }

  if (jsonMode) {
    const trimmed = content.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      // Strip markdown code fences if present (```json ... ```)
      const fenceStripped = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      try {
        return JSON.parse(fenceStripped);
      } catch { /* fall through */ }

      // Last resort: extract the outermost {...} block
      const match = trimmed.match(/\{[\s\S]*\}/);
      if (match) {
        try { return JSON.parse(match[0]); } catch { /* fall through */ }
      }
      throw new Error(`LLM returned non-JSON content: ${trimmed.slice(0, 200)}`);
    }
  }

  return content;
}

module.exports = { callLLM };
