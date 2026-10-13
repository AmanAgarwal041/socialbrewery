import { grokChat } from './grok.js';
import { openaiChat } from './openai.js';
import { videoPerformance } from './youtube.js';
import { saveAnalysis } from './store.js';
import { cfg } from './context.js';

const SYSTEM = `You review one YouTube video for the person who owns the channel.
Use only the numbers in the JSON. If a metric is null or missing, say it is unavailable. Do not invent a score.
Write three short parts:
1. How it performed, using the lifetime counts and the last 28 days.
2. What is working.
3. What to change on the next video: title, first line, length, description, and when to post.
Stay under 220 words.`;

export function analysisProvider(value) {
  const name = String(value || cfg.ANALYSIS_PROVIDER || 'grok').trim().toLowerCase();
  if (name !== 'grok' && name !== 'openai') throw new Error('Analysis provider must be grok or openai.');
  return name;
}

export async function analyzeVideo(videoId, options = {}) {
  const provider = analysisProvider(options.provider);
  const performance = await videoPerformance(videoId);
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: JSON.stringify(performance) },
  ];
  const message = provider === 'openai' ? await openaiChat({ messages }) : await grokChat({ messages });
  const analysis = String(message.content || '').trim();
  if (!analysis) throw new Error(provider === 'openai' ? 'OpenAI returned an empty review.' : 'Grok returned an empty review.');
  const record = {
    videoId: performance.video.id,
    title: performance.video.title,
    analysis,
    provider,
    performance,
    createdAt: new Date().toISOString(),
  };
  await saveAnalysis(record);
  return record;
}
