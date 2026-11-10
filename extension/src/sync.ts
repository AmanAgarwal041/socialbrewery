// Signed in, runs are copied to the Socialbrewery organisation (PUT /api/extension/runs) and come
// back from it, so they follow the person to other browsers. Signed out, nothing leaves this browser.

import { leadKey, listLeads, listRuns, replaceLeads, replaceRuns, type Lead, type Run } from './storage'

const MAX_BATCH_BYTES = 800_000

type SyncState = { pushedAt: number }

async function state(): Promise<SyncState> {
  const { syncState } = await chrome.storage.local.get('syncState')
  return { pushedAt: 0, ...(syncState as Partial<SyncState> | undefined) }
}

/** GET without a body; PUT (merge) with one. */
async function call(serverUrl: string, token: string, body?: unknown) {
  const url = `${serverUrl.replace(/\/$/, '')}/api/extension/runs`
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  const res = body === undefined ? await fetch(url, { headers }) : await fetch(url, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (res.status === 409) throw new Error('Choose an organisation in Socialbrewery to save runs.')
  if (!res.ok) throw new Error(data.error || `Saving failed (${res.status}).`)
  return data as { runs: Run[]; deleted: string[] }
}

export async function syncRuns(serverUrl: string, getToken: () => Promise<string | null>): Promise<number> {
  const token = await getToken()
  if (!token) return 0
  const startedAt = Date.now()
  const { pushedAt } = await state()
  const { deletedRuns } = await chrome.storage.local.get('deletedRuns')
  const deleted = (deletedRuns as string[] | undefined) || []
  const changed = (await listRuns()).filter((r) => r.updatedAt > pushedAt && r.status !== 'running')

  // Send changed runs in batches under the server's body limit.
  let batch: Run[] = []
  let size = 0
  let merged: { runs: Run[]; deleted: string[] } | null = null
  const flush = async () => {
    merged = await call(serverUrl, (await getToken()) || token, { runs: batch, deleted })
    batch = []
    size = 0
  }
  for (const run of changed) {
    const bytes = JSON.stringify(run).length
    if (batch.length && size + bytes > MAX_BATCH_BYTES) await flush()
    batch.push(run)
    size += bytes
  }
  if (batch.length || deleted.length) await flush()
  const server = merged ?? (await call(serverUrl, token))

  // Take the newer copy of each run; runs deleted anywhere disappear here too.
  const gone = new Set(server.deleted)
  const byId = new Map((await listRuns()).filter((r) => !gone.has(r.id)).map((r) => [r.id, r]))
  for (const run of server.runs) {
    const local = byId.get(run.id)
    if (!local || (run.updatedAt > local.updatedAt && local.status !== 'running')) byId.set(run.id, run)
  }
  await replaceRuns([...byId.values()])
  await chrome.storage.local.set({ syncState: { pushedAt: startedAt }, deletedRuns: [] })
  return changed.length
}

// ---------- Reddit leads ----------
// Leads the agent saved here go to the organisation's Reddit lead list (POST /api/reddit/leads),
// and the organisation's list comes back, so the dashboard and every browser see the same leads.
// The newer copy of each lead wins; a lead an admin deleted in the dashboard disappears here too.

type ServerLead = Omit<Lead, 'key' | 'createdAt'> & { id: string; createdAt: string }

async function leadsCall(serverUrl: string, token: string, leads?: Lead[]) {
  const url = `${serverUrl.replace(/\/$/, '')}/api/reddit/leads`
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  const res = leads
    ? await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'extension', leads }) })
    : await fetch(url, { headers })
  const data = await res.json().catch(() => ({}))
  if (res.status === 409) throw new Error('Choose an organisation in Socialbrewery to save leads.')
  if (!res.ok) throw new Error(data.error || `Saving leads failed (${res.status}).`)
  return data as { leads?: ServerLead[] }
}

export async function syncLeads(serverUrl: string, getToken: () => Promise<string | null>): Promise<void> {
  const token = await getToken()
  if (!token) return
  const startedAt = Date.now()
  const { leadSyncAt } = await chrome.storage.local.get('leadSyncAt')
  const since = Number(leadSyncAt) || 0
  const changed = (await listLeads()).filter((l) => l.updatedAt > since)
  for (let i = 0; i < changed.length; i += 200) await leadsCall(serverUrl, (await getToken()) || token, changed.slice(i, i + 200))
  const server = (await leadsCall(serverUrl, (await getToken()) || token)).leads || []

  const onServer = new Set(server.map((l) => l.id))
  const byKey = new Map((await listLeads()).filter((l) => !l.id || onServer.has(l.id)).map((l) => [l.key, l]))
  for (const remote of server) {
    const key = leadKey(remote.username, remote.postUrl)
    const local = byKey.get(key)
    const updatedAt = Number(remote.updatedAt) || 0
    if (!local || updatedAt > local.updatedAt) {
      byKey.set(key, { ...remote, key, signals: remote.signals || [], createdAt: Date.parse(remote.createdAt) || updatedAt, updatedAt })
    } else if (!local.id) {
      byKey.set(key, { ...local, id: remote.id })
    }
  }
  await replaceLeads([...byKey.values()])
  await chrome.storage.local.set({ leadSyncAt: startedAt })
}
