// Claude and Grok behind one small interface, with the user's own keys, called straight from the
// extension. Each run keeps its provider's own message history (append-only, which Claude's
// thinking blocks require).

import Anthropic from '@anthropic-ai/sdk'
import type { Settings } from '../storage'
import type { ToolResult, ToolSpec } from './tools'

export type ToolCall = { id: string; name: string; input: Record<string, unknown> }
export type Turn = { text: string; calls: ToolCall[]; stop: 'tools' | 'done' | 'refused' | 'too_long' }

export interface Conversation {
  addUser(text: string): void
  next(signal: AbortSignal): Promise<Turn>
  addResults(results: { call: ToolCall; result: ToolResult }[]): void
}

// ---------- Claude ----------

export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
]

// Server-side fallback on a safety decline, available on these models.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-opus-5'])

class ClaudeConversation implements Conversation {
  private client: Anthropic
  private messages: Anthropic.Beta.BetaMessageParam[] = []
  private settings: Settings
  private system: string
  private tools: Anthropic.Beta.BetaTool[]

  constructor(settings: Settings, system: string, tools: ToolSpec[]) {
    this.settings = settings
    this.system = system
    // The key is the user's own and never leaves this browser except to Anthropic.
    this.client = new Anthropic({ apiKey: settings.anthropicKey, dangerouslyAllowBrowser: true, maxRetries: 3 })
    this.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema as Anthropic.Beta.BetaTool.InputSchema }))
  }

  addUser(text: string) {
    this.messages.push({ role: 'user', content: text })
  }

  async next(signal: AbortSignal): Promise<Turn> {
    const model = this.settings.claudeModel
    const haiku = model.startsWith('claude-haiku')
    const fallback = FALLBACK_MODELS.has(model)
    const response = await this.client.beta.messages.create(
      {
        model,
        max_tokens: 16000,
        system: [{ type: 'text', text: this.system }],
        tools: this.tools,
        messages: this.messages,
        // Caches the growing history between steps of a run.
        cache_control: { type: 'ephemeral' },
        ...(haiku ? {} : { thinking: { type: 'adaptive' as const }, output_config: { effort: this.settings.claudeEffort } }),
        ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal },
    )
    // Append the whole content (thinking blocks included), never just the text.
    this.messages.push({ role: 'assistant', content: response.content })
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()
    const calls = response.content
      .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, input: (b.input || {}) as Record<string, unknown> }))

    if (response.stop_reason === 'refusal') return { text: text || 'Claude declined this request.', calls: [], stop: 'refused' }
    if (response.stop_reason === 'max_tokens') return { text, calls: [], stop: 'too_long' }
    if (response.stop_reason === 'pause_turn') return { text, calls: [], stop: 'tools' }
    return { text, calls, stop: calls.length ? 'tools' : 'done' }
  }

  addResults(results: { call: ToolCall; result: ToolResult }[]) {
    if (!results.length) return
    // All results of one turn go back in a single user message.
    this.messages.push({
      role: 'user',
      content: results.map(({ call, result }) => ({
        type: 'tool_result' as const,
        tool_use_id: call.id,
        is_error: result.isError || undefined,
        content: result.image
          ? [
              { type: 'text' as const, text: result.text },
              { type: 'image' as const, source: { type: 'base64' as const, media_type: result.image.mime, data: result.image.data } },
            ]
          : result.text,
      })),
    })
  }
}

// ---------- Grok (xAI, OpenAI-style chat completions) ----------

type GrokMessage =
  | { role: 'system' | 'user'; content: string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[] }
  | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string }

class GrokConversation implements Conversation {
  private messages: GrokMessage[]
  private settings: Settings
  private tools: object[]

  constructor(settings: Settings, system: string, tools: ToolSpec[]) {
    this.settings = settings
    this.messages = [{ role: 'system', content: system }]
    this.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } }))
  }

  addUser(text: string) {
    this.messages.push({ role: 'user', content: text })
  }

  async next(signal: AbortSignal): Promise<Turn> {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.settings.xaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.settings.grokModel, messages: this.messages, tools: this.tools, temperature: 0.3 }),
      signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const error = data?.error
      throw new Error((typeof error === 'string' ? error : error?.message) || `Grok request failed (${res.status}).`)
    }
    const choice = data.choices?.[0]
    const message = choice?.message
    if (!message) throw new Error('Grok returned an empty reply.')
    this.messages.push({ role: 'assistant', content: message.content ?? null, ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) })
    const calls: ToolCall[] = (message.tool_calls || []).map((c: { id: string; function: { name: string; arguments: string } }) => {
      let input: Record<string, unknown> = {}
      try {
        input = JSON.parse(c.function.arguments || '{}')
      } catch {
        input = {}
      }
      return { id: c.id, name: c.function.name, input }
    })
    const text = String(message.content || '').trim()
    if (choice.finish_reason === 'length') return { text, calls: [], stop: 'too_long' }
    return { text, calls, stop: calls.length ? 'tools' : 'done' }
  }

  addResults(results: { call: ToolCall; result: ToolResult }[]) {
    const images: string[] = []
    for (const { call, result } of results) {
      this.messages.push({ role: 'tool', tool_call_id: call.id, content: result.isError ? `Error: ${result.text}` : result.text })
      if (result.image) images.push(`data:${result.image.mime};base64,${result.image.data}`)
    }
    // Tool messages are text only, so screenshots follow as a user message.
    if (images.length) {
      this.messages.push({
        role: 'user',
        content: [{ type: 'text', text: 'The screenshot you asked for:' }, ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } }))],
      })
    }
  }
}

export function startConversation(settings: Settings, system: string, tools: ToolSpec[]): Conversation {
  if (settings.provider === 'claude') {
    if (!settings.anthropicKey) throw new Error('Add your Anthropic API key in Settings to use Claude.')
    return new ClaudeConversation(settings, system, tools)
  }
  if (!settings.xaiKey) throw new Error('Add your xAI API key in Settings to use Grok.')
  return new GrokConversation(settings, system, tools)
}
