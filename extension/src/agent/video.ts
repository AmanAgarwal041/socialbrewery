// Grok Imagine clips, as in the server's generateShort (src/grok.js), with the user's own xAI key.
// The finished video is kept in this browser (IndexedDB) for upload_file.

import { addFile, type MediaFile } from '../storage'

async function xai<T>(apiKey: string, pathname: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://api.x.ai${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } | string }
  if (!res.ok) {
    const message = typeof data.error === 'string' ? data.error : data.error?.message
    throw new Error(message || `Grok request failed (${res.status}).`)
  }
  return data
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Stopped.'))
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(timer), reject(new Error('Stopped.'))), { once: true })
  })
}

export async function generateVideo({
  apiKey,
  model,
  prompt,
  seconds,
  signal,
  onProgress,
}: {
  apiKey: string
  model: string
  prompt: string
  seconds: number
  signal: AbortSignal
  onProgress: (text: string) => void
}): Promise<MediaFile> {
  const text = prompt.trim()
  if (!text) throw new Error('Describe the clip first.')
  const duration = Math.min(15, Math.max(1, Math.round(seconds)))
  const started = await xai<{ request_id?: string }>(apiKey, '/v1/videos/generations', {
    method: 'POST',
    body: JSON.stringify({ model, prompt: text.slice(0, 4000), duration, aspect_ratio: '9:16', resolution: '720p' }),
    signal,
  })
  if (!started.request_id) throw new Error('Grok video did not return a request id.')

  const deadline = Date.now() + 8 * 60 * 1000
  while (Date.now() < deadline) {
    await delay(4000, signal)
    onProgress('Grok is generating the clip…')
    const status = await xai<{ status?: string; video?: { url?: string }; error?: { message?: string } | string }>(apiKey, `/v1/videos/${started.request_id}`, { signal })
    if (status.status === 'done' && status.video?.url) {
      let res = await fetch(status.video.url, { signal })
      if (res.status === 401 || res.status === 403) res = await fetch(status.video.url, { headers: { Authorization: `Bearer ${apiKey}` }, signal })
      if (!res.ok) throw new Error(`Couldn't download the clip (${res.status}).`)
      const blob = await res.blob()
      return addFile(blob.type ? blob : new Blob([blob], { type: 'video/mp4' }), `grok-${Date.now()}.mp4`, 'grok')
    }
    if (status.status === 'failed' || status.status === 'expired') {
      const message = typeof status.error === 'string' ? status.error : status.error?.message
      throw new Error(message || `Video generation ${status.status}.`)
    }
  }
  throw new Error('Video generation timed out after 8 minutes.')
}
