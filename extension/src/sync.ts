// Signed in, runs are copied to the Socialbrewery organisation (PUT /api/extension/runs) and come
// back from it, so they follow the person to other browsers. Signed out, nothing leaves this browser.

import { listRuns, replaceRuns, type Run } from './storage'

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
