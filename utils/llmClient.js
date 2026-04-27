const OpenAI = require('openai');

let client = null;

function getClient() {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.GROK_API_KEY,
      baseURL: 'https://api.x.ai/v1',
    });
  }
  return client;
}

/**
 * Call the Grok LLM with a system + user prompt.
 * Returns a parsed JSON object when jsonMode is true.
 */
async function callLLM(systemPrompt, userPrompt, jsonMode = true) {
  const params = {
    model: process.env.GROK_MODEL || 'grok-3-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.1,
  };

  if (jsonMode) {
    params.response_format = { type: 'json_object' };
  }

  const response = await getClient().chat.completions.create(params);
  const content = response.choices[0].message.content;

  if (jsonMode) {
    try {
      return JSON.parse(content);
    } catch {
      // Fallback: extract first JSON object from the response
      const match = content.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      throw new Error(`LLM returned non-JSON content: ${content.slice(0, 200)}`);
    }
  }

  return content;
}

module.exports = { callLLM };
