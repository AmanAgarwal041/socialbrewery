import { useSyncExternalStore } from 'react'
import type { Health } from './api'

// Which assistant Brew talks to: the Grok/Claude tabs under Brew's text area (and the Overview
// prompt). Shared across the page so every label follows the selected tab. The choice is kept per
// browser; until someone picks a tab, the organisation's default from Settings applies.

export type Assistant = 'grok' | 'claude'
export const ASSISTANTS: { id: Assistant; label: string; keyName: string }[] = [
  { id: 'grok', label: 'Grok', keyName: 'xAI' },
  { id: 'claude', label: 'Claude', keyName: 'Anthropic' },
]

const KEY = 'socialbrewery:assistant'
const listeners = new Set<() => void>()

function read(): Assistant | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'grok' || v === 'claude' ? v : null
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
  const id: Assistant = picked ?? (health?.agent === 'claude' ? 'claude' : 'grok')
  const meta = ASSISTANTS.find((a) => a.id === id)!
  const ready = health?.agents ? health.agents[id] : id === (health?.agent ?? 'grok') ? Boolean(health?.agentReady) : false
  return { id, label: meta.label, keyName: meta.keyName, ready, set: setAssistant }
}
