// Everything the extension keeps, all in this browser: settings and API keys (chrome.storage.local,
// never synced anywhere), runs, and attached or generated media (IndexedDB). Signing in only copies
// runs to Socialbrewery (src/sync.ts); keys and media stay here.

export type Provider = 'claude' | 'grok'

export type Settings = {
  provider: Provider
  anthropicKey: string
  xaiKey: string
  claudeModel: string
  claudeEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  grokModel: string
  grokVideoModel: string
  /** The Socialbrewery app this extension signs in to and saves to. */
  serverUrl: string
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'claude',
  anthropicKey: '',
  xaiKey: '',
  claudeModel: 'claude-opus-5-5',
  claudeEffort: 'medium',
  grokModel: 'grok-4.6',
  grokVideoModel: 'grok-imagine-video-1.5',
  serverUrl: 'https://socialbrewery.agarwal-aman041.workers.dev',
}

export async function loadSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings')
  return { ...DEFAULT_SETTINGS, ...(settings as Partial<Settings> | undefined) }
}

export async function saveSettings(next: Settings) {
  await chrome.storage.local.set({ settings: next })
}

// ---------- runs: what was asked, what the agent did, and what got posted ----------

export type Step =
  | { kind: 'user'; text: string; at: number }
  | { kind: 'assistant'; text: string; at: number }
  | { kind: 'action'; text: string; at: number; error?: boolean }
  | { kind: 'approval'; text: string; at: number; approved: boolean }

export type PostRecord = { network: string; url: string; title: string; at: number }

export type Run = {
  id: string
  title: string
  provider: Provider
  status: 'running' | 'done' | 'stopped' | 'error'
  createdAt: number
  updatedAt: number
  steps: Step[]
  posts: PostRecord[]
}

const MAX_RUNS = 100
const MAX_STEPS = 300

export async function listRuns(): Promise<Run[]> {
  const { runs } = await chrome.storage.local.get('runs')
  return Array.isArray(runs) ? (runs as Run[]) : []
}

export async function saveRun(run: Run) {
  const runs = await listRuns()
  const trimmed = { ...run, steps: run.steps.slice(-MAX_STEPS) }
  const next = [trimmed, ...runs.filter((r) => r.id !== run.id)].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_RUNS)
  await chrome.storage.local.set({ runs: next })
}

export async function replaceRuns(runs: Run[]) {
  await chrome.storage.local.set({ runs: runs.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_RUNS) })
}

export async function deleteRun(id: string) {
  await chrome.storage.local.set({ runs: (await listRuns()).filter((r) => r.id !== id) })
  const { deletedRuns } = await chrome.storage.local.get('deletedRuns')
  await chrome.storage.local.set({ deletedRuns: [...((deletedRuns as string[]) || []), id].slice(-500) })
}

// ---------- Reddit leads found by research ----------

export type LeadStatus = 'new' | 'engaged' | 'won' | 'dismissed'
export const LEAD_STATUSES: LeadStatus[] = ['new', 'engaged', 'won', 'dismissed']

export type Lead = {
  /** username|postId, lowercased: the same person and post is one lead everywhere. */
  key: string
  /** The server's id once synced. */
  id?: string
  username: string
  subreddit: string
  postUrl: string
  postTitle: string
  excerpt: string
  fit: 'high' | 'medium' | 'low'
  reason: string
  signals: string[]
  status: LeadStatus
  notes: string
  createdAt: number
  updatedAt: number
}

const MAX_LEADS = 2000

export function leadKey(username: string, postUrl: string) {
  return `${username.toLowerCase()}|${postUrl.match(/\/comments\/([a-z0-9]+)/i)?.[1]?.toLowerCase() || ''}`
}

export async function listLeads(): Promise<Lead[]> {
  const { leads } = await chrome.storage.local.get('leads')
  return Array.isArray(leads) ? (leads as Lead[]) : []
}

export async function replaceLeads(leads: Lead[]) {
  await chrome.storage.local.set({ leads: leads.sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_LEADS) })
}

/** Adds leads or updates the saved one with the same key. Saving again never moves a lead back to "new". */
export type LeadInput = Pick<Lead, 'username' | 'subreddit' | 'postUrl' | 'postTitle' | 'excerpt' | 'fit' | 'reason' | 'signals'> & Partial<Pick<Lead, 'status' | 'notes'>>

export async function upsertLeads(items: LeadInput[]) {
  const byKey = new Map((await listLeads()).map((l) => [l.key, l]))
  let added = 0
  for (const item of items) {
    const key = leadKey(item.username, item.postUrl)
    const existing = byKey.get(key)
    const now = Date.now()
    if (existing) {
      byKey.set(key, { ...existing, ...item, key, status: item.status && item.status !== 'new' ? item.status : existing.status, notes: item.notes || existing.notes, reason: item.reason || existing.reason, updatedAt: now })
    } else {
      byKey.set(key, { status: 'new', notes: '', ...item, key, createdAt: now, updatedAt: now })
      added++
    }
  }
  await replaceLeads([...byKey.values()])
  return { added, updated: items.length - added }
}

export async function updateLead(key: string, patch: Partial<Pick<Lead, 'status' | 'fit' | 'reason' | 'notes'>>) {
  const leads = await listLeads()
  const lead = leads.find((l) => l.key === key || l.id === key)
  if (!lead) return null
  Object.assign(lead, patch, { updatedAt: Date.now() })
  await replaceLeads(leads)
  return lead
}

export async function removeLeads(keys: string[]) {
  const gone = new Set(keys)
  await replaceLeads((await listLeads()).filter((l) => !gone.has(l.key)))
}

// ---------- media ----------

export type MediaFile = { id: string; name: string; mime: string; size: number; source: 'upload' | 'grok'; createdAt: number }

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('socialbrewery', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await db()
  return new Promise((resolve, reject) => {
    const req = fn(database.transaction('files', mode).objectStore('files'))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function addFile(blob: Blob, name: string, source: MediaFile['source']): Promise<MediaFile> {
  const meta: MediaFile = { id: crypto.randomUUID(), name, mime: blob.type || 'application/octet-stream', size: blob.size, source, createdAt: Date.now() }
  await tx('readwrite', (s) => s.put({ ...meta, blob }))
  return meta
}

export async function getFile(id: string): Promise<(MediaFile & { blob: Blob }) | undefined> {
  return tx('readonly', (s) => s.get(id))
}

export async function listFiles(): Promise<MediaFile[]> {
  const rows = (await tx('readonly', (s) => s.getAll())) as (MediaFile & { blob: Blob })[]
  return rows.map(({ blob: _blob, ...meta }) => meta).sort((a, b) => b.createdAt - a.createdAt)
}

export async function removeFile(id: string) {
  await tx('readwrite', (s) => s.delete(id))
}
