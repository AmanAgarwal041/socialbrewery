// Post one video to several networks from the side panel. The video is kept in this browser
// (IndexedDB, like any attachment); signed in, it can also come from the organisation's library in
// Socialbrewery. Starting builds one instruction for the agent, which then works through the networks
// in the user's own tabs. Every publish click still waits for the user's approval (tools.ts).

import { useEffect, useRef, useState } from 'react'
import { Clapperboard, CloudDownload, Loader2, Send, Upload } from 'lucide-react'
import { addFile, listFiles, type MediaFile } from '@/storage'
import { Button, cn, Field, inputClass } from './ui'

export type VideoNetwork = 'YouTube' | 'Instagram' | 'LinkedIn' | 'X' | 'Slack'
const NETWORKS: { id: VideoNetwork; note: string }[] = [
  { id: 'YouTube', note: 'Studio upload; vertical becomes a Short' },
  { id: 'Instagram', note: 'Reel' },
  { id: 'LinkedIn', note: 'Video post' },
  { id: 'X', note: '280 characters' },
  { id: 'Slack', note: 'Message with the clip' },
]

type LibraryItem = { id: string; name: string; mime: string; bytes: number; createdAt: string }

export type VideoPlan = {
  file: MediaFile
  networks: VideoNetwork[]
  title: string
  caption: string
  adapt: boolean
  privacy: 'unlisted' | 'private' | 'public'
  slackChannel: string
}

function megabytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1)} MB`
}

/** The instruction the agent gets. Plain text, so it also reads well in the run's history. */
export function videoPrompt(plan: VideoPlan) {
  const lines = [
    `Post the video "${plan.file.name}" (file id ${plan.file.id}) to ${plan.networks.join(', ')}, one network at a time, in that order.`,
    'For each network: open its posting page, add the video with upload_file (never the system file picker), wait for the upload to finish, fill in the text, then click the final publish button, which I approve on each site.',
    'If a network fails or I decline, say why in one line and move on to the next one. Do not post anywhere else and do not post the same network twice.',
  ]
  if (plan.networks.includes('YouTube')) {
    lines.push(`YouTube: title "${plan.title || plan.file.name.replace(/\.[^.]+$/, '')}", the caption as the description, visibility ${plan.privacy}, not made for kids.`)
  }
  if (plan.networks.includes('Slack')) lines.push(`Slack: post in ${plan.slackChannel ? `#${plan.slackChannel.replace(/^#/, '')}` : 'the channel I named'}.`)
  if (plan.networks.includes('X')) lines.push('X: the text must fit in 280 characters (a link counts as 23).')
  lines.push(
    plan.adapt
      ? 'Adapt the caption to each network (length, tone, hashtags) but keep its meaning, facts, and links. Do not invent claims.'
      : 'Use the caption exactly as written on every network' + (plan.networks.includes('X') ? ', except shorten it for X only if it does not fit.' : '.'),
  )
  lines.push('', 'Caption:', plan.caption.trim() || '(none: write a short, plain one from the title)', '', 'When you finish, list each network with its result and the post link if there is one.')
  return lines.join('\n')
}

export function PostVideoView({
  serverUrl,
  signedIn,
  getToken,
  blocked,
  onStart,
}: {
  serverUrl: string
  signedIn: boolean
  getToken: () => Promise<string | null>
  /** Why starting is not possible right now, or empty. */
  blocked: string
  onStart: (plan: VideoPlan) => void
}) {
  const picker = useRef<HTMLInputElement>(null)
  const [videos, setVideos] = useState<MediaFile[]>([])
  const [fileId, setFileId] = useState('')
  const [library, setLibrary] = useState<LibraryItem[] | null>(null)
  const [libraryError, setLibraryError] = useState('')
  const [fetching, setFetching] = useState('')
  const [networks, setNetworks] = useState<VideoNetwork[]>(['YouTube', 'Instagram', 'LinkedIn', 'X'])
  const [title, setTitle] = useState('')
  const [caption, setCaption] = useState('')
  const [adapt, setAdapt] = useState(true)
  const [privacy, setPrivacy] = useState<VideoPlan['privacy']>('unlisted')
  const [slackChannel, setSlackChannel] = useState('')
  const [error, setError] = useState('')

  async function refresh(select?: string) {
    const list = (await listFiles()).filter((f) => f.mime.startsWith('video/'))
    setVideos(list)
    setFileId((current) => select || (list.some((f) => f.id === current) ? current : list[0]?.id || ''))
  }

  useEffect(() => {
    void refresh()
  }, [])

  const base = serverUrl.replace(/\/$/, '')

  async function loadLibrary() {
    setLibraryError('')
    try {
      const token = await getToken()
      if (!token) throw new Error('Sign in to see your organisation’s videos.')
      const res = await fetch(`${base}/api/media`, { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409) throw new Error('Choose an organisation in Socialbrewery first.')
      if (!res.ok) throw new Error(data.error || `Could not load the library (${res.status}).`)
      setLibrary(data.media || [])
    } catch (err) {
      setLibraryError((err as Error).message)
      setLibrary([])
    }
  }

  async function useLibraryVideo(item: LibraryItem) {
    setFetching(item.id)
    setLibraryError('')
    try {
      const token = await getToken()
      if (!token) throw new Error('Sign in again to download it.')
      const res = await fetch(`${base}/api/media/${item.id}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`Download failed (${res.status}).`)
      const blob = await res.blob()
      const typed = blob.type.startsWith('video/') ? blob : new Blob([blob], { type: item.mime || 'video/mp4' })
      const saved = await addFile(typed, item.name, 'upload')
      await refresh(saved.id)
    } catch (err) {
      setLibraryError((err as Error).message)
    } finally {
      setFetching('')
    }
  }

  async function addLocal(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    if (!file.type.startsWith('video/')) {
      setError('Choose a video file (mp4, mov, or webm).')
      return
    }
    setError('')
    const saved = await addFile(file, file.name, 'upload')
    await refresh(saved.id)
  }

  function toggle(id: VideoNetwork) {
    setNetworks((list) => (list.includes(id) ? list.filter((n) => n !== id) : NETWORKS.map((n) => n.id).filter((n) => n === id || list.includes(n))))
  }

  function start() {
    const file = videos.find((f) => f.id === fileId)
    if (!file) return setError('Choose a video first.')
    if (!networks.length) return setError('Pick at least one network.')
    if (networks.includes('Slack') && !slackChannel.trim()) return setError('Name the Slack channel.')
    if (!caption.trim() && !title.trim()) return setError('Write a caption or a title.')
    setError('')
    onStart({ file, networks, title: title.trim(), caption, adapt, privacy, slackChannel: slackChannel.trim() })
  }

  return (
    <div className="space-y-4 p-3">
      <div>
        <p className="font-medium">Post a video to several networks</p>
        <p className="text-xs text-muted-foreground">The agent opens each site in this tab with the accounts you’re signed in to, uploads the video, and fills in the post. You approve every publish.</p>
      </div>

      <section className="space-y-2">
        <p className="text-xs font-medium">Video</p>
        <input ref={picker} type="file" accept="video/mp4,video/quicktime,video/webm,video/*" hidden onChange={(e) => void addLocal(e.target.files).then(() => (e.target.value = ''))} />
        {videos.length > 0 && (
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {videos.map((f) => (
              <li key={f.id}>
                <button
                  onClick={() => setFileId(f.id)}
                  className={cn('flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs', f.id === fileId ? 'border-p1 bg-p1-soft' : 'border-border hover:bg-muted')}
                >
                  <Clapperboard className="size-3.5 shrink-0" />
                  <span className="flex-1 truncate">{f.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{megabytes(f.size)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => picker.current?.click()}>
            <Upload /> Choose a video
          </Button>
          {signedIn && (
            <Button variant="outline" onClick={() => void loadLibrary()}>
              <CloudDownload /> From Socialbrewery
            </Button>
          )}
        </div>
        {library && (
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
            {library.length === 0 && !libraryError && <li className="px-2 py-1 text-xs text-muted-foreground">No videos in your organisation’s library yet.</li>}
            {library.map((item) => (
              <li key={item.id}>
                <button disabled={!!fetching} onClick={() => void useLibraryVideo(item)} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-muted disabled:opacity-60">
                  {fetching === item.id ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <CloudDownload className="size-3.5 shrink-0" />}
                  <span className="flex-1 truncate">{item.name}</span>
                  {item.bytes > 0 && <span className="shrink-0 tabular-nums text-muted-foreground">{megabytes(item.bytes)}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {libraryError && <p className="text-xs text-danger">{libraryError}</p>}
      </section>

      <section className="space-y-2">
        <p className="text-xs font-medium">Networks, in posting order</p>
        <div className="grid grid-cols-2 gap-1.5">
          {NETWORKS.map((n) => (
            <label key={n.id} className={cn('flex cursor-pointer items-start gap-2 rounded-lg border px-2 py-1.5', networks.includes(n.id) ? 'border-p1 bg-p1-soft' : 'border-border')}>
              <input type="checkbox" className="mt-0.5 accent-[var(--p1)]" checked={networks.includes(n.id)} onChange={() => toggle(n.id)} />
              <span>
                <span className="block text-xs font-medium">{n.id}</span>
                <span className="block text-[11px] text-muted-foreground">{n.note}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <Field label="Title" hint="YouTube uses it as the title.">
        <input className={inputClass} value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Caption">
        <textarea className={cn(inputClass, 'resize-y')} rows={5} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="What should people know about this video?" />
      </Field>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" className="accent-[var(--p1)]" checked={adapt} onChange={(e) => setAdapt(e.target.checked)} />
        Let the agent adapt the caption for each network
      </label>
      {networks.includes('YouTube') && (
        <Field label="YouTube visibility">
          <select className={inputClass} value={privacy} onChange={(e) => setPrivacy(e.target.value as VideoPlan['privacy'])}>
            <option value="unlisted">Unlisted</option>
            <option value="private">Private</option>
            <option value="public">Public</option>
          </select>
        </Field>
      )}
      {networks.includes('Slack') && (
        <Field label="Slack channel">
          <input className={inputClass} value={slackChannel} onChange={(e) => setSlackChannel(e.target.value)} placeholder="#launches" />
        </Field>
      )}

      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
      <Button className="w-full" disabled={!!blocked} onClick={start}>
        <Send /> {blocked || `Start posting to ${networks.length || 'no'} network${networks.length === 1 ? '' : 's'}`}
      </Button>
    </div>
  )
}
