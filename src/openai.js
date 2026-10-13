import { cfg } from './context.js';

export async function openaiChat({ messages }) {
  const key = cfg.OPENAI_API_KEY;
  if (!key) throw new Error('Add your OpenAI API key in Settings (an organisation admin can do this).');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.OPENAI_MODEL || 'gpt-5.6-terra',
      messages,
    }),
  });
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 400) };
    }
  }
  if (!res.ok) {
    const message = data.error?.message || data.error || data.message || `OpenAI request failed (${res.status}).`;
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
  }
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error('OpenAI returned an empty reply.');
  return message;
}
