import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CircleAlert, CircleCheck, Clapperboard, ExternalLink, Library, Loader2, RotateCcw, Send, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { api, mediaSrc, postJson, safeLink, timeAgo, uploadMedia, type SlackChannel } from '@/lib/api'
import { useAppState } from '@/lib/app-state'
import { SLOT_CLASSES, networkById, networkState } from '@/lib/networks'
import { cn } from '@/lib/utils'

// One video, many networks. The video is uploaded to the organisation's library once, then each
// network gets its own POST /api/posts with the same mediaId, one at a time, so a failure on one
// network never blocks the others and can be retried on its own.

type VideoTarget = 'youtube' | 'instagram' | 'linkedin' | 'x' | 'slack'
const TARGETS: VideoTarget[] = ['youtube', 'instagram', 'linkedin', 'x', 'slack']
const LIMITS: Record<VideoTarget, number> = { youtube: 5000, instagram: 2200, linkedin: 3000, x: 280, slack: 4000 }
const TEXT_LABEL: Record<VideoTarget, string> = { youtube: 'Description', instagram: 'Caption', linkedin: 'Post text', x: 'Post text', slack: 'Message' }

type LibraryItem = { id: string; name: string; mime: string; bytes: number; createdAt: string; source?: string }
type Status = { state: 'waiting' | 'posting' | 'done' | 'error'; url?: string; error?: string; warning?: string }

// X counts every link as 23 characters regardless of its real length.
function xLength(text: string) {
  return Array.from(text.replace(/https?:\/\/\S+/g, 'x'.repeat(23))).length
}

function textLength(target: VideoTarget, text: string) {
  return target === 'x' ? xLength(text) : text.length
}

function megabytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1)} MB`
}

export function PublishPage() {
  const { health, connectors, refreshPosts, guest } = useAppState()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [picked, setPicked] = useState<LibraryItem | null>(null)
  const [uploaded, setUploaded] = useState<{ id: string; name: string } | null>(null)
  const [library, setLibrary] = useState<LibraryItem[] | null>(null)
  const [showLibrary, setShowLibrary] = useState(false)

  const [selected, setSelected] = useState<Set<VideoTarget>>(new Set())
  const [title, setTitle] = useState('')
  const [caption, setCaption] = useState('')
  const [custom, setCustom] = useState<Partial<Record<VideoTarget, string>>>({})
  const [tags, setTags] = useState('')
  const [privacy, setPrivacy] = useState('unlisted')
  const [kids, setKids] = useState(false)
  const [channels, setChannels] = useState<SlackChannel[] | null>(null)
  const [channel, setChannel] = useState('')

  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [statuses, setStatuses] = useState<Partial<Record<VideoTarget, Status>>>({})

  const states = useMemo(
    () => Object.fromEntries(TARGETS.map((id) => [id, networkState(id, health, connectors)])) as Record<VideoTarget, ReturnType<typeof networkState>>,
    [health, connectors],
  )

  // Pre-select every network that is connected, once health has loaded.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || !health) return
    seeded.current = true
    setSelected(new Set(TARGETS.filter((id) => states[id].connected)))
  }, [health, states])

  useEffect(() => {
    api<{ media: LibraryItem[] }>('/api/media')
      .then(({ media }) => setLibrary(media))
      .catch(() => setLibrary([]))
  }, [])

  const wantsSlack = selected.has('slack') && states.slack.connected
  useEffect(() => {
    if (!wantsSlack || channels) return
    api<{ channels: SlackChannel[] }>('/api/slack/channels')
      .then(({ channels: list }) => {
        setChannels(list)
        const wanted = (connectors?.slack?.defaultChannel || '').replace(/^#/, '').toLowerCase()
        const preferred = list.find((c) => c.id === wanted || c.name.toLowerCase() === wanted) || list.find((c) => c.isMember) || list[0]
        if (preferred) setChannel((current) => current || preferred.id)
      })
      .catch((err) => {
        setChannels([])
        toast.error((err as Error).message)
      })
  }, [wantsSlack, channels, connectors?.slack?.defaultChannel])

  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file])
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])
  const videoSrc = preview || mediaSrc(picked?.id)
  const videoName = file?.name || picked?.name || ''
  const maxMb = health?.maxUploadMb ?? 200

  function chooseFile(next: File | null) {
    if (next && !/\.(mp4|mov|webm)$/i.test(next.name) && !/^video\/(mp4|quicktime|webm)$/.test(next.type)) {
      toast.error('Use an mp4, mov, or webm file.')
      return
    }
    if (next && next.size > maxMb * 1024 * 1024) {
      toast.error(`That video is over ${maxMb} MB.`)
      return
    }
    setFile(next)
    setPicked(null)
    setUploaded(null)
    setStatuses({})
  }

  function chooseLibrary(item: LibraryItem) {
    setFile(null)
    setPicked(item)
    setUploaded({ id: item.id, name: item.name })
    setShowLibrary(false)
    setStatuses({})
  }

  function clearVideo() {
    setFile(null)
    setPicked(null)
    setUploaded(null)
    setStatuses({})
  }

  function toggle(id: VideoTarget, on: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const textFor = (id: VideoTarget) => (custom[id] ?? caption)
  const chosen = TARGETS.filter((id) => selected.has(id))

  function problems(list: VideoTarget[]) {
    const out: string[] = []
    if (!file && !picked) out.push('Add a video.')
    if (!list.length) out.push('Pick at least one network.')
    for (const id of list) {
      const name = networkById[id].name
      if (!states[id].connected) out.push(`Connect ${name} first.`)
      const text = textFor(id).trim()
      if (id === 'youtube' && !title.trim()) out.push('YouTube needs a title.')
      if ((id === 'linkedin' || id === 'x' || id === 'slack') && !text) out.push(`${name} needs ${TEXT_LABEL[id].toLowerCase()}.`)
      if (textLength(id, text) > LIMITS[id]) out.push(`${name} allows ${LIMITS[id]} characters; this is ${textLength(id, text)}.`)
      if (id === 'slack' && !channel) out.push('Pick a Slack channel.')
    }
    return out
  }

  function review(event: FormEvent) {
    event.preventDefault()
    const issues = problems(chosen)
    if (issues.length) {
      toast.error(issues[0], issues.length > 1 ? { description: issues.slice(1).join(' ') } : undefined)
      return
    }
    setConfirming(true)
  }

  async function ensureUploaded() {
    if (uploaded) return uploaded
    if (!file) throw new Error('Add a video.')
    const media = await uploadMedia(file)
    setUploaded(media)
    setLibrary((list) => [{ id: media.id, name: media.name, mime: file.type, bytes: file.size, createdAt: new Date().toISOString(), source: 'upload' }, ...(list || [])])
    return media
  }

  async function publish(list: VideoTarget[]) {
    setConfirming(false)
    setBusy(true)
    setStatuses((s) => ({ ...s, ...Object.fromEntries(list.map((id) => [id, { state: 'waiting' } as Status])) }))
    let media: { id: string; name: string }
    try {
      media = await ensureUploaded()
    } catch (err) {
      const message = (err as Error).message
      setStatuses((s) => ({ ...s, ...Object.fromEntries(list.map((id) => [id, { state: 'error', error: message } as Status])) }))
      toast.error(message)
      setBusy(false)
      return
    }
    let posted = 0
    for (const id of list) {
      setStatuses((s) => ({ ...s, [id]: { state: 'posting' } }))
      const text = textFor(id).trim()
      try {
        const result = await postJson<{ post?: { url?: string; thumbnailError?: string } }>('/api/posts', {
          network: id,
          mediaId: media.id,
          title: id === 'youtube' ? title.trim() : title.trim() || text.slice(0, 100),
          description: text,
          ...(id === 'youtube' ? { tags, privacyStatus: privacy, madeForKids: kids } : {}),
          ...(id === 'slack' ? { channel } : {}),
        })
        posted += 1
        setStatuses((s) => ({ ...s, [id]: { state: 'done', url: safeLink(result?.post?.url), warning: result?.post?.thumbnailError } }))
      } catch (err) {
        setStatuses((s) => ({ ...s, [id]: { state: 'error', error: (err as Error).message } }))
      }
    }
    setBusy(false)
    const failed = list.length - posted
    if (!failed) toast.success(`Posted to ${list.length === 1 ? networkById[list[0]].name : `${list.length} networks`}.`)
    else if (posted) toast.warning(`Posted to ${posted} of ${list.length}. Retry the ones that failed.`)
    else toast.error('Nothing was posted. Check the errors below.')
    refreshPosts().catch(() => {})
  }

  const failed = chosen.filter((id) => statuses[id]?.state === 'error')
  const allDone = chosen.length > 0 && chosen.every((id) => statuses[id]?.state === 'done')

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Publish"
        title="One video, every network"
        icon={Send}
        iconClass="bg-palette text-ink"
        description="Upload a video once, write one caption (or a different one per network), and post it to YouTube, Instagram, LinkedIn, X, and Slack in one go. Each network is posted separately, so if one fails the others still go out and you can retry just that one."
      />
      <form onSubmit={review} className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle>Networks</CardTitle>
              <CardDescription>Connected networks are switched on. Connect the others from Connectors.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              {TARGETS.map((id) => {
                const network = networkById[id]
                const state = states[id]
                const status = statuses[id]
                return (
                  <div key={id} className={cn('flex items-center gap-3 rounded-xl border px-3 py-2', selected.has(id) && state.connected && 'border-foreground/20 bg-muted/40')}>
                    <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', SLOT_CLASSES[network.slot].chip)}>
                      <network.icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{network.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {state.loading ? 'Checking…' : state.connected ? state.accountName || 'Connected' : (
                          <Link to={`/connectors/${id}`} className="underline">
                            Connect {network.name}
                          </Link>
                        )}
                      </p>
                    </div>
                    {status && <StatusIcon status={status} />}
                    <Switch
                      aria-label={`Post to ${network.name}`}
                      checked={selected.has(id) && state.connected}
                      disabled={!state.connected || busy}
                      onCheckedChange={(on) => toggle(id, on)}
                    />
                  </div>
                )
              })}
              {TARGETS.filter((id) => statuses[id]?.state === 'error' || statuses[id]?.warning).map((id) => (
                <p key={id} className={cn('rounded-lg px-3 py-2 text-xs sm:col-span-2', statuses[id]?.state === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground')}>
                  {networkById[id].name}: {statuses[id]?.error || statuses[id]?.warning}
                </p>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Post</CardTitle>
              <CardDescription>The caption goes to every network. Customize it for a network to override it there.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="publish-title">Title</Label>
                <Input id="publish-title" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder="Used as the YouTube title, up to 100 characters" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="publish-caption">Caption</Label>
                <Textarea id="publish-caption" rows={5} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="What should people know about this video?" />
                <p className="text-right text-xs tabular-nums text-muted-foreground">{caption.length} characters</p>
              </div>
              {chosen.map((id) => (
                <NetworkText
                  key={id}
                  id={id}
                  caption={caption}
                  value={custom[id]}
                  onChange={(value) => setCustom((c) => ({ ...c, [id]: value }))}
                />
              ))}
              {selected.has('youtube') && (
                <div className="grid gap-4 rounded-xl border p-3 sm:grid-cols-3">
                  <p className="text-xs font-medium text-muted-foreground sm:col-span-3">YouTube</p>
                  <div className="space-y-2">
                    <Label htmlFor="publish-tags">Tags</Label>
                    <Input id="publish-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="ai, agents" />
                  </div>
                  <div className="space-y-2">
                    <Label>Privacy</Label>
                    <Select value={privacy} onValueChange={setPrivacy}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unlisted">Unlisted</SelectItem>
                        <SelectItem value="private">Private</SelectItem>
                        <SelectItem value="public">Public</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end gap-2 pb-2">
                    <Switch id="publish-kids" checked={kids} onCheckedChange={setKids} />
                    <Label htmlFor="publish-kids">Made for kids</Label>
                  </div>
                </div>
              )}
              {wantsSlack && (
                <div className="space-y-2 rounded-xl border p-3">
                  <Label>Slack channel</Label>
                  <Select value={channel} onValueChange={setChannel} disabled={!channels?.length}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={channels === null ? 'Loading channels…' : 'No channels the app can see'} />
                    </SelectTrigger>
                    <SelectContent>
                      {channels?.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.isPrivate ? '🔒' : '#'} {c.name}
                          {!c.isMember && <span className="text-xs text-muted-foreground"> · app joins on post</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardContent>
            <CardFooter className="flex-wrap justify-end gap-2">
              {failed.length > 0 && !busy && (
                <Button type="button" variant="secondary" onClick={() => void publish(failed)}>
                  <RotateCcw /> Retry {failed.length === 1 ? networkById[failed[0]].name : `${failed.length} failed`}
                </Button>
              )}
              <Button type="submit" disabled={busy || guest || allDone}>
                {busy ? <Loader2 className="animate-spin" /> : <Upload />}
                {allDone ? 'Posted' : chosen.length > 1 ? `Post to ${chosen.length} networks` : chosen.length === 1 ? `Post to ${networkById[chosen[0]].name}` : 'Post'}
              </Button>
            </CardFooter>
          </Card>
        </div>

        <Card className="lg:col-span-2 lg:self-start">
          <CardHeader>
            <CardTitle>Video</CardTitle>
            <CardDescription>Uploaded once and reused for every network. Vertical 9:16 suits Reels and Shorts; 16:9 suits LinkedIn and X.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              ref={fileRef}
              type="file"
              hidden
              accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
              onChange={(e) => {
                chooseFile(e.target.files?.[0] || null)
                e.target.value = ''
              }}
            />
            {videoSrc ? (
              <div className="space-y-3">
                <video src={videoSrc} controls className="mx-auto max-h-96 w-full rounded-xl border bg-black object-contain" />
                <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-xs">
                  <Clapperboard className="size-4 shrink-0" />
                  <span className="flex-1 truncate">{videoName}</span>
                  {uploaded ? <Badge variant="secondary">In library</Badge> : file && <span className="tabular-nums text-muted-foreground">{megabytes(file.size)}</span>}
                  <button type="button" disabled={busy} onClick={clearVideo} aria-label="Remove video" className="rounded p-0.5 hover:bg-background">
                    <X className="size-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  chooseFile(e.dataTransfer.files?.[0] || null)
                }}
                className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed text-sm text-muted-foreground transition hover:border-p1 hover:bg-p1-soft/40"
              >
                <span className="flex size-11 items-center justify-center rounded-2xl bg-p1-soft text-p1-ink">
                  <Upload className="size-5" />
                </span>
                <span className="font-medium text-foreground">Drop a video or click to browse</span>
                <span className="text-xs">mp4, mov, or webm up to {maxMb} MB</span>
              </button>
            )}
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setShowLibrary((v) => !v)}>
              <Library /> {showLibrary ? 'Hide library' : `Choose from library${library?.length ? ` (${library.length})` : ''}`}
            </Button>
            {showLibrary && (
              <ul className="max-h-72 space-y-1 overflow-y-auto">
                {library === null && <li className="text-xs text-muted-foreground">Loading…</li>}
                {library?.length === 0 && <li className="text-xs text-muted-foreground">No videos yet. Uploads and Grok clips appear here.</li>}
                {library?.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => chooseLibrary(item)}
                      className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted', picked?.id === item.id && 'bg-muted')}
                    >
                      <Clapperboard className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{item.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {item.bytes ? `${megabytes(item.bytes)} · ` : ''}
                        {timeAgo(item.createdAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              Want a browser to do it instead, with your own signed-in accounts? The <Link to="/extension" className="underline">Chrome extension</Link> can post the same video from its Post video tab.
            </p>
          </CardContent>
        </Card>
      </form>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Post to {chosen.length === 1 ? networkById[chosen[0]].name : `${chosen.length} networks`}?</DialogTitle>
            <DialogDescription>
              {videoName} goes out now, one network after another.{selected.has('youtube') ? ` YouTube: ${privacy}.` : ''}
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm">
            {chosen.map((id) => {
              const network = networkById[id]
              const text = textFor(id).trim()
              return (
                <li key={id} className="flex gap-2 rounded-lg bg-muted/60 px-3 py-2">
                  <network.icon className="mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium">
                      {network.name}
                      {id === 'slack' && channels ? ` · #${channels.find((c) => c.id === channel)?.name || channel}` : ''}
                    </p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{id === 'youtube' ? title : text || 'No caption'}</p>
                  </div>
                </li>
              )
            })}
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button onClick={() => void publish(chosen)}>
              <Send /> Post now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function NetworkText({ id, caption, value, onChange }: { id: VideoTarget; caption: string; value?: string; onChange: (value: string | undefined) => void }) {
  const network = networkById[id]
  const text = value ?? caption
  const length = textLength(id, text)
  const over = length > LIMITS[id]
  if (value === undefined && !over) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <network.icon className="size-3.5" />
        <span className="flex-1">
          {network.name} uses the caption{id === 'x' ? ` (${length}/280)` : ''}.
        </span>
        <button type="button" className="underline" onClick={() => onChange(caption)}>
          Customize
        </button>
      </div>
    )
  }
  return (
    <div className="space-y-2 rounded-xl border p-3">
      <div className="flex items-center gap-2">
        <network.icon className="size-3.5" />
        <Label htmlFor={`publish-${id}`} className="flex-1">
          {network.name} {TEXT_LABEL[id].toLowerCase()}
        </Label>
        {value !== undefined && (
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => onChange(undefined)}>
            Use the caption
          </button>
        )}
      </div>
      <Textarea id={`publish-${id}`} rows={id === 'x' ? 3 : 4} value={text} onChange={(e) => onChange(e.target.value)} />
      <p className={cn('text-right text-xs tabular-nums text-muted-foreground', over && 'text-destructive')}>
        {length}/{LIMITS[id]}
        {over && value === undefined ? ' · too long for ' + network.name + ', shorten it here' : ''}
      </p>
    </div>
  )
}

function StatusIcon({ status }: { status: Status }) {
  if (status.state === 'posting') return <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Posting" />
  if (status.state === 'waiting') return <span className="text-[11px] text-muted-foreground">Queued</span>
  if (status.state === 'error')
    return (
      <span title={status.error} className="flex items-center gap-1 text-[11px] text-destructive">
        <CircleAlert className="size-4" /> Failed
      </span>
    )
  return status.url ? (
    <a href={status.url} target="_blank" rel="noreferrer" title={status.warning || 'Open the post'} className="flex items-center gap-1 text-[11px] text-p4-ink">
      <CircleCheck className="size-4" /> View <ExternalLink className="size-3" />
    </a>
  ) : (
    <span className="flex items-center gap-1 text-[11px] text-p4-ink">
      <CircleCheck className="size-4" /> Posted
    </span>
  )
}

