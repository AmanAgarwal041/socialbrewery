import { useSyncExternalStore } from 'react'
import type { Health } from './api'

// Which assistant Brew talks to: the Grok/Claude/OpenAI tabs under Brew's text area (and the Overview
// prompt). Shared across the page so every label follows the selected tab. The choice is kept per
// browser; until someone picks a tab, the organisation's default from Settings applies.

export type Assistant = 'grok' | 'claude' | 'openai'
export const ASSISTANTS: { id: Assistant; label: string; keyName: string }[] = [
  { id: 'grok', label: 'Grok', keyName: 'xAI' },
  { id: 'claude', label: 'Claude', keyName: 'Anthropic' },
  { id: 'openai', label: 'OpenAI', keyName: 'OpenAI' },
]

const isAssistant = (v: unknown): v is Assistant => ASSISTANTS.some((a) => a.id === v)

/** Display name and key name for an assistant id from the server. */
export function assistantMeta(id?: string | null) {
  return ASSISTANTS.find((a) => a.id === id) || ASSISTANTS[0]
}

const KEY = 'socialbrewery:assistant'
const listeners = new Set<() => void>()

function read(): Assistant | null {
  try {
    const v = localStorage.getItem(KEY)
    return isAssistant(v) ? v : null
  } catch {
    return null
  }
}

export function setAssistant(a: Assistant) {
  try {
    localStorage.setItem(KEY, a)
  } catch {
    /* storage blocked: the choice lasts for this page view */
    memory = a
  }
  listeners.forEach((l) => l())
}

let memory: Assistant | null = null

function subscribe(l: () => void) {
  listeners.add(l)
  const onStorage = (e: StorageEvent) => e.key === KEY && l()
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(l)
    window.removeEventListener('storage', onStorage)
  }
}

const snapshot = () => read() ?? memory

/** The selected assistant, its display name, and whether its API key is set. */
export function useAssistant(health?: Health | null) {
  const picked = useSyncExternalStore(subscribe, snapshot, () => null)
  const id: Assistant = picked ?? (isAssistant(health?.agent) ? health.agent : 'grok')
  const meta = ASSISTANTS.find((a) => a.id === id)!
  const ready = health?.agents ? Boolean(health.agents[id]) : id === (health?.agent ?? 'grok') ? Boolean(health?.agentReady) : false
  return { id, label: meta.label, keyName: meta.keyName, ready, set: setAssistant }
}
