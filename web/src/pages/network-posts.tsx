import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CircleAlert, Clapperboard, ExternalLink, Link2, Loader2, MessageSquarePlus, Pencil, Search, Sparkles, Type, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { agentLabel, api, postJson, postNetwork, safeLink, timeAgo, uploadMedia, type Post, type RedditDetails, type RedditSubreddit, type SlackChannel } from '@/lib/api'
import { useAppState } from '@/lib/app-state'
import { SLOT_CLASSES, networkState, type NetworkMeta } from '@/lib/networks'
import { cn } from '@/lib/utils'

function EditVideoDialog({ post, onClose }: { post: Post; onClose: () => void }) {
  const { refreshPosts } = useAppState()
  const [title, setTitle] = useState(post.title || '')
  const [description, setDescription] = useState(post.description || '')
  const [tags, setTags] = useState((post.tags || []).join(', '))
  const [privacy, setPrivacy] = useState(post.privacyStatus || 'unlisted')
  const [saving, setSaving] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      await postJson('/api/youtube/update', { videoId: post.youtubeId, title, description, tags, privacyStatus: privacy })
      toast.success('Video updated on YouTube.')
      await refreshPosts()
      onClose()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Edit video</DialogTitle>
            <DialogDescription>Changes go straight to YouTube.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="edit-title">Title</Label>
            <Input id="edit-title" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-description">Description</Label>
            <Textarea id="edit-description" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="edit-tags">Tags</Label>
              <Input id="edit-tags" value={tags} placeholder="coffee, cozy" onChange={(e) => setTags(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Privacy</Label>
              <Select value={privacy} onValueChange={setPrivacy}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public</SelectItem>
                  <SelectItem value="unlisted">Unlisted</SelectItem>
                  <SelectItem value="private">Private</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />} Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// X counts every link as 23 characters regardless of its real length.
function xLength(text: string) {
  return Array.from(text.replace(/https?:\/\/\S+/g, 'x'.repeat(23))).length
}

function redditSubmitUrl(subreddit: string, title: string, text: string, url: string) {
  const sr = subreddit.trim().replace(/^\/?r\//i, '').replace(/\/.*$/, '')
  const params = new URLSearchParams({ type: url ? 'LINK' : 'TEXT', title: title.trim().slice(0, 300) })
  if (url) params.set('url', url)
  else if (text.trim()) params.set('text', text.trim())
  return `https://www.reddit.com/r/${encodeURIComponent(sr)}/submit?${params}`
}

function TrackRedditPost({ title, text, onDone }: { title: string; text: string; onDone: () => void }) {
  const { refreshPosts } = useAppState()
  const [link, setLink] = useState('')
  const [saving, setSaving] = useState(false)
  async function save() {
    setSaving(true)
    try {
      await postJson('/api/reddit/track', { link, title, text })
      toast.success('Saved to your Reddit posts.')
      await refreshPosts()
      onDone()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="space-y-2 rounded-2xl bg-p3-soft/60 p-3">
      <Label htmlFor="track-link">Posted it? Paste the link to track it here</Label>
      <div className="flex gap-2">
        <Input id="track-link" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.reddit.com/r/…/comments/…" />
        <Button type="button" variant="secondary" disabled={saving || !link.trim()} onClick={save}>
          {saving && <Loader2 className="animate-spin" />} Save
        </Button>
      </div>
    </div>
  )
}

function CommentDialog({ post, onClose }: { post: Post; onClose: () => void }) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const isX = postNetwork(post) === 'x'
  const isSlack = postNetwork(post) === 'slack'
  const isReddit = postNetwork(post) === 'reddit'
  const max = isX ? 280 : isSlack ? 4000 : isReddit ? 10000 : 1250
  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      if (isX) {
        await postJson('/api/x/reply', { post: post.xId, text })
        toast.success('Reply posted on X.')
      } else if (isSlack) {
        await postJson('/api/slack/reply', { post: post.url || `${post.slackChannel}:${post.slackTs}`, text })
        toast.success('Replied in the Slack thread.')
      } else if (isReddit) {
        await postJson('/api/reddit/comment', { post: post.redditId, text })
        toast.success('Comment posted on Reddit.')
      } else {
        await postJson('/api/linkedin/comment', { post: post.linkedinId, text })
        toast.success('Comment added on LinkedIn.')
      }
      onClose()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{isX || isSlack ? 'Reply in thread' : 'Add a comment'}</DialogTitle>
            <DialogDescription>Posted under “{(post.title || '').slice(0, 60)}” as you. Great for links.</DialogDescription>
          </DialogHeader>
          <Textarea rows={4} maxLength={isX ? undefined : max} value={text} onChange={(e) => setText(e.target.value)} placeholder="Links and follow-ups…" autoFocus />
          {isX && (
            <p className={cn('text-right text-xs tabular-nums text-muted-foreground', xLength(text) > max && 'text-destructive')}>
              {xLength(text)}/{max}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !text.trim()}>
              {saving && <Loader2 className="animate-spin" />} {isX || isSlack ? 'Reply' : 'Comment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PostCard({ post, network, onEdit, onComment }: { post: Post; network: NetworkMeta; onEdit?: () => void; onComment?: () => void }) {
  const [open, setOpen] = useState(false)
  const link = safeLink(post.url)
  const body = post.description || ''
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <div className="flex items-start gap-3">
          <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', SLOT_CLASSES[network.slot].chip)}>
            <network.icon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <CardTitle className="line-clamp-2 text-sm leading-snug">{post.title || body.slice(0, 90) || 'Untitled'}</CardTitle>
            <CardDescription className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
              <span>{timeAgo(post.createdAt)}</span>
              {post.privacyStatus && <Badge variant="secondary">{post.privacyStatus}</Badge>}
              {post.slackChannelName && <Badge variant="secondary">#{post.slackChannelName}</Badge>}
              {post.subreddit && <Badge variant="secondary">r/{post.subreddit}</Badge>}
              <Badge variant="outline">{post.source || 'manual'}</Badge>
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      {body && (
        <CardContent className="px-4">
          <p className={cn('text-sm whitespace-pre-wrap text-muted-foreground', !open && 'line-clamp-3')}>{body}</p>
          {body.length > 180 && (
            <button type="button" className="mt-1 text-xs font-medium text-p1-ink hover:underline" onClick={() => setOpen(!open)}>
              {open ? 'Show less' : 'Show more'}
            </button>
          )}
        </CardContent>
      )}
      <CardFooter className="gap-2 px-4">
        {link && (
          <Button asChild size="sm" variant="secondary">
            <a href={link} target="_blank" rel="noreferrer">
              Open <ExternalLink />
            </a>
          </Button>
        )}
        {onEdit && (
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <Pencil /> Edit
          </Button>
        )}
        {onComment && (
          <Button size="sm" variant="ghost" onClick={onComment}>
            <MessageSquarePlus /> {network.id === 'x' || network.id === 'slack' ? 'Reply' : 'Comment'}
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}

export function NetworkPosts({ network }: { network: NetworkMeta }) {
  const { posts, health, connectors } = useAppState()
  const apiConnected = networkState(network.id, health, connectors).connected
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Post | null>(null)
  const [commenting, setCommenting] = useState<Post | null>(null)
  const mine = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (posts || [])
      .filter((p) => postNetwork(p) === network.id)
      .filter((p) => !q || `${p.title} ${p.description}`.toLowerCase().includes(q))
  }, [posts, network.id, query])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${network.name} posts`} className="pl-9" />
        </div>
        <Button asChild>
          <Link to={`/connectors/${network.id}/compose`}>New {network.noun}</Link>
        </Button>
      </div>
      {mine.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {mine.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              network={network}
              onEdit={network.id === 'youtube' && post.youtubeId ? () => setEditing(post) : undefined}
              onComment={
                (network.id === 'linkedin' && post.linkedinId) || (network.id === 'x' && post.xId) || (network.id === 'slack' && post.slackTs) ||
                (network.id === 'reddit' && post.redditId && apiConnected)
                  ? () => setCommenting(post)
                  : undefined
              }
            />
          ))}
        </div>
      ) : (
        <EmptyState icon={network.icon} title={query ? 'No matching posts' : `No ${network.name} posts yet`}>
          {query ? 'Try a different search.' : 'Posts you publish from Socialbrewery, Grok, or Claude show up here.'}
        </EmptyState>
      )}
      {editing && <EditVideoDialog post={editing} onClose={() => setEditing(null)} />}
      {commenting && <CommentDialog post={commenting} onClose={() => setCommenting(null)} />}
    </div>
  )
}

export function NetworkCompose({ network }: { network: NetworkMeta }) {
  const { health, connectors, refreshPosts } = useAppState()
  const navigate = useNavigate()
  const state = networkState(network.id, health, connectors)
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [privacy, setPrivacy] = useState('unlisted')
  const [kids, setKids] = useState(false)
  const [subtitle, setSubtitle] = useState('')
  const [cover, setCover] = useState('')
  const [draft, setDraft] = useState(true)
  const [channel, setChannel] = useState('')
  const [channels, setChannels] = useState<SlackChannel[] | null>(null)
  const [busy, setBusy] = useState(false)
  const isSlack = network.id === 'slack'
  const isReddit = network.id === 'reddit'
  const [subreddit, setSubreddit] = useState('')
  const [subreddits, setSubreddits] = useState<RedditSubreddit[]>([])
  const [details, setDetails] = useState<RedditDetails | null>(null)
  const [detailsError, setDetailsError] = useState('')
  const [kind, setKind] = useState<'self' | 'link'>('self')
  const [link, setLink] = useState('')
  const [linkTitle, setLinkTitle] = useState('')
  const [flairId, setFlairId] = useState('')
  const [nsfw, setNsfw] = useState(false)
  const [spoiler, setSpoiler] = useState(false)
  const [opened, setOpened] = useState(false)
  const manualReddit = isReddit && !state.loading && !state.connected
  useEffect(() => {
    if (!isReddit || !state.connected) return
    api<{ subreddits: RedditSubreddit[] }>('/api/reddit/subreddits')
      .then(({ subreddits: list }) => setSubreddits(list))
      .catch(() => setSubreddits([]))
  }, [isReddit, state.connected])
  useEffect(() => {
    const name = subreddit.trim().replace(/^\/?r\//i, '')
    setDetails(null)
    setDetailsError('')
    setFlairId('')
    if (!isReddit || !state.connected || !/^[A-Za-z0-9_]{2,21}$/.test(name)) return
    const timer = setTimeout(() => {
      api<{ subreddit: RedditDetails }>(`/api/reddit/subreddit?name=${encodeURIComponent(name)}`)
        .then(({ subreddit: info }) => {
          setDetails(info)
          if (info.submissionType === 'self') setKind('self')
          if (info.submissionType === 'link') setKind('link')
        })
        .catch((err) => setDetailsError((err as Error).message))
    }, 500)
    return () => clearTimeout(timer)
  }, [isReddit, state.connected, subreddit])
  useEffect(() => {
    if (!isSlack || !state.connected) return
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
  }, [isSlack, state.connected, connectors?.slack?.defaultChannel])
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file])
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  const article = network.id === 'hashnode'
  const linkCard = network.id === 'linkedin' && !file
  const textOnly = network.id === 'linkedin' || network.id === 'x' || article || isSlack || isReddit
  const needsVideo = !textOnly
  const textLabel =
    network.id === 'youtube' ? 'Description' : article ? 'Article (Markdown)' : isReddit ? 'Body (Markdown, optional)' : isSlack ? 'Message' : textOnly ? 'Post text' : 'Caption'
  const limit = { youtube: 5000, linkedin: 3000, instagram: 2200, x: 280, hashnode: 0, slack: 4000, reddit: 40000 }[network.id]
  const length = network.id === 'x' ? xLength(description) : description.length
  const words = description.trim() ? description.trim().split(/\s+/).length : 0

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (needsVideo && !file) {
      toast.error(`${network.name} needs a video.`)
      return
    }
    if (isReddit) {
      if (!subreddit.trim()) return void toast.error('Pick a subreddit.')
      if (!title.trim()) return void toast.error('Reddit needs a title.')
      if (kind === 'link' && !link.trim()) return void toast.error('Add the link to share.')
      if (details?.flairs.length && !flairId && details.rules.some((r) => /flair/i.test(`${r.title} ${r.description}`))) {
        return void toast.error(`r/${details.name} asks for a post flair.`)
      }
    } else if (textOnly && !description.trim()) {
      toast.error(`${network.name} needs ${article ? 'the article body' : 'post text'}.`)
      return
    }
    if (article && title.trim().length < 6) {
      toast.error('Hashnode needs a title of at least 6 characters.')
      return
    }
    if (manualReddit) {
      window.open(redditSubmitUrl(subreddit, title, description, kind === 'link' ? link.trim() : ''), '_blank', 'noopener,noreferrer')
      setOpened(true)
      return
    }
    setBusy(true)
    try {
      const media = file && !article ? await uploadMedia(file) : null
      const result = await postJson<{ post?: { thumbnailError?: string } }>('/api/posts', {
        network: network.id,
        mediaId: media?.id,
        title: title || description.slice(0, 100),
        description,
        tags,
        privacyStatus: privacy,
        madeForKids: kids,
        ...(article ? { subtitle, coverImageUrl: cover, draft } : {}),
        ...(isSlack ? { channel } : {}),
        ...(linkCard && link.trim() ? { linkUrl: link.trim(), linkTitle: linkTitle.trim() } : {}),
        ...(isReddit
          ? {
              subreddit,
              url: kind === 'link' ? link : '',
              description: kind === 'link' ? '' : description,
              flairId,
              flairText: details?.flairs.find((f) => f.id === flairId)?.text || '',
              nsfw,
              spoiler,
            }
          : {}),
      })
      const channelName = channels?.find((c) => c.id === channel)?.name
      toast.success(
        article && draft
          ? 'Saved as a Hashnode draft.'
          : isReddit
            ? `Posted to r/${details?.name || subreddit.replace(/^\/?r\//i, '')}.`
            : isSlack && channelName ? `Posted to #${channelName}.` : `Posted to ${network.name}.`,
      )
      if (result?.post?.thumbnailError) toast.warning(result.post.thumbnailError)
      setFile(null)
      setTitle('')
      setDescription('')
      setTags('')
      setSubtitle('')
      setCover('')
      setLink('')
      setLinkTitle('')
      await refreshPosts()
      navigate(`/connectors/${network.id}/posts`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function askGrok() {
    const prompt =
      network.id === 'youtube'
        ? 'Write a title, description, and tags for the attached video, then post it as an unlisted YouTube Short.'
        : network.id === 'linkedin'
          ? `Write a LinkedIn post about: ${description || '…'}`
          : network.id === 'x'
            ? `Write an X post under 280 characters about: ${description || '…'}`
            : isReddit
              ? `Read the rules of r/${subreddit.replace(/^\/?r\//i, '') || '…'} first, then draft a genuine Reddit post (plain title, no hashtags, not an ad) about: ${description || title || '…'}. Show me the draft before posting.`
              : isSlack
              ? `Write a short Slack message for my team in Slack mrkdwn about: ${description || '…'}`
              : article
              ? `Write a Hashnode article${title ? ` titled “${title}”` : ''} with an intro, a few headed sections, and a short conclusion, then save it as a draft. Topic: ${description.slice(0, 400) || '…'}`
              : 'Write a caption with a few hashtags for the attached video and post it as an Instagram Reel.'
    navigate('/brew', { state: { prompt, target: network.id } })
  }

  return (
    <form onSubmit={submit} className="grid gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>New {network.noun}</CardTitle>
          <CardDescription>
            {state.connected
              ? `Posts as ${state.accountName || 'your account'}.`
              : manualReddit
                ? 'No API keys needed: Reddit opens its own submit page with this filled in, and you click Post.'
                : `Connect ${network.name} first — posting will fail until you do.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(!textOnly || article || isReddit) && (
            <div className="space-y-2">
              <Label htmlFor="compose-title">Title</Label>
              <Input
                id="compose-title"
                value={title}
                maxLength={article ? 250 : isReddit ? 300 : 100}
                required={network.id === 'youtube' || article || isReddit}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={article ? 'A clear, specific headline' : isReddit ? 'Plain and specific — no clickbait' : 'Up to 100 characters'}
              />
            </div>
          )}
          {isSlack && (
            <div className="space-y-2">
              <Label>Channel</Label>
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
          {isReddit && (
            <>
              <div className="space-y-2">
                <Label htmlFor="compose-subreddit">Subreddit</Label>
                <Input
                  id="compose-subreddit"
                  list="joined-subreddits"
                  value={subreddit}
                  onChange={(e) => setSubreddit(e.target.value)}
                  placeholder="r/selfhosted"
                  autoComplete="off"
                />
                <datalist id="joined-subreddits">
                  {subreddits.map((sr) => (
                    <option key={sr.name} value={`r/${sr.name}`}>
                      {sr.title}
                    </option>
                  ))}
                </datalist>
                {detailsError && <p className="text-xs text-destructive">{detailsError}</p>}
              </div>
              <div className="flex gap-2">
                {(['self', 'link'] as const).map((value) => {
                  const blocked = details && details.submissionType !== 'any' && details.submissionType !== value
                  return (
                    <Button
                      key={value}
                      type="button"
                      size="sm"
                      variant={kind === value ? 'secondary' : 'ghost'}
                      disabled={Boolean(blocked)}
                      onClick={() => setKind(value)}
                    >
                      {value === 'self' ? <Type /> : <Link2 />} {value === 'self' ? 'Text' : 'Link'}
                    </Button>
                  )
                })}
              </div>
              {kind === 'link' && (
                <div className="space-y-2">
                  <Label htmlFor="compose-link">Link</Label>
                  <Input id="compose-link" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
                </div>
              )}
            </>
          )}
          {article && (
            <div className="space-y-2">
              <Label htmlFor="compose-subtitle">Subtitle</Label>
              <Input id="compose-subtitle" value={subtitle} maxLength={150} onChange={(e) => setSubtitle(e.target.value)} placeholder="Optional one-line summary" />
            </div>
          )}
          {!(isReddit && kind === 'link') && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="compose-text">{textLabel}</Label>
              <span className={cn('text-xs tabular-nums text-muted-foreground', limit > 0 && length > limit && 'text-destructive')}>
                {article ? `${words} words` : `${length}/${limit}`}
              </span>
            </div>
            <Textarea
              id="compose-text"
              className={cn(article && 'font-mono text-[13px]')}
              rows={article ? 16 : network.id === 'linkedin' ? 9 : 5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                network.id === 'youtube'
                  ? '#Shorts is added for you if you leave it out.'
                  : network.id === 'linkedin'
                    ? 'What do you want to share? Hashtags stay clickable; brackets and parentheses are escaped for you.'
                    : network.id === 'x'
                      ? 'What’s happening? Links count as 23 characters. X Premium accounts can go past 280.'
                      : isReddit
                        ? 'Write like a community member. Markdown works: **bold**, lists, `code`, [links](https://…).'
                        : isSlack
                        ? 'Slack mrkdwn works: *bold*, _italic_, `code`, and <https://example.com|links>.'
                        : article
                        ? '## Introduction\n\nWrite in Markdown: headings, lists, code blocks, and links all work.'
                        : 'Caption and hashtags'
              }
            />
          </div>
          )}
          {linkCard && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="compose-link-card">Link preview (optional)</Label>
                <Input id="compose-link-card" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://youtu.be/… or an article" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="compose-link-title">Card title</Label>
                <Input
                  id="compose-link-title"
                  value={linkTitle}
                  maxLength={400}
                  disabled={!link.trim()}
                  onChange={(e) => setLinkTitle(e.target.value)}
                  placeholder="Shown on the card; YouTube links get their thumbnail"
                />
              </div>
            </div>
          )}
          {isReddit && !manualReddit && (
            <div className="flex flex-wrap items-center gap-4">
              {Boolean(details?.flairs.length) && (
                <Select value={flairId} onValueChange={setFlairId}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Post flair" />
                  </SelectTrigger>
                  <SelectContent>
                    {details?.flairs.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.text || 'Untitled flair'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className="flex items-center gap-2">
                <Switch id="compose-nsfw" checked={nsfw} onCheckedChange={setNsfw} />
                <Label htmlFor="compose-nsfw">NSFW</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="compose-spoiler" checked={spoiler} onCheckedChange={setSpoiler} />
                <Label htmlFor="compose-spoiler">Spoiler</Label>
              </div>
            </div>
          )}
          {manualReddit && opened && <TrackRedditPost title={title} text={kind === 'link' ? link : description} onDone={() => navigate('/connectors/reddit/posts')} />}
          {article && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="compose-tags">Tags</Label>
                  <Input id="compose-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="AI, JavaScript (up to 5)" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="compose-cover">Cover image URL</Label>
                  <Input id="compose-cover" type="url" value={cover} onChange={(e) => setCover(e.target.value)} placeholder="https://…" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="compose-draft" checked={draft} onCheckedChange={setDraft} />
                <Label htmlFor="compose-draft">Save as draft</Label>
                <span className="text-xs text-muted-foreground">{draft ? 'Review it on Hashnode before publishing.' : 'Publishes to your blog right away.'}</span>
              </div>
            </>
          )}
          {network.id === 'youtube' && (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2 sm:col-span-1">
                <Label htmlFor="compose-tags">Tags</Label>
                <Input id="compose-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="kettle, rain" />
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
                <Switch id="compose-kids" checked={kids} onCheckedChange={setKids} />
                <Label htmlFor="compose-kids">Made for kids</Label>
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter className="justify-between gap-2">
          <Button type="button" variant="ghost" onClick={askGrok}>
            <Sparkles /> Let {agentLabel(health)} write it
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Upload />}{' '}
            {article ? (draft ? 'Save draft' : 'Publish article') : manualReddit ? 'Open Reddit to post' : `Post to ${network.name}`}
          </Button>
        </CardFooter>
      </Card>

      {isReddit ? (
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{details ? `r/${details.name}` : 'Subreddit rules'}</CardTitle>
            <CardDescription>
              {details
                ? `${details.subscribers != null ? `${new Intl.NumberFormat().format(details.subscribers)} members · ` : ''}${
                    details.submissionType === 'any' ? 'Text and link posts' : details.submissionType === 'self' ? 'Text posts only' : 'Link posts only'
                  }`
                : 'Pick a subreddit to see its rules before you post.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {details?.banned && (
              <p className="flex items-center gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <CircleAlert className="size-4" /> This account is banned from r/{details.name}.
              </p>
            )}
            {details?.restricted && !details.banned && (
              <p className="rounded-xl bg-muted/70 px-3 py-2 text-xs text-muted-foreground">Restricted subreddit: only approved users can post.</p>
            )}
            {manualReddit && /^\/?(r\/)?[A-Za-z0-9_]{2,21}$/.test(subreddit.trim()) && (
              <Button asChild size="sm" variant="secondary">
                <a href={`https://www.reddit.com/r/${subreddit.trim().replace(/^\/?r\//i, '')}/about/rules`} target="_blank" rel="noreferrer">
                  Read r/{subreddit.trim().replace(/^\/?r\//i, '')} rules <ExternalLink />
                </a>
              </Button>
            )}
            {details?.rules.length ? (
              <ol className="max-h-96 space-y-2 overflow-y-auto pr-1">
                {details.rules.map((rule, index) => (
                  <li key={index} className="rounded-xl bg-muted/70 px-3 py-2">
                    <p className="text-xs font-medium">
                      {index + 1}. {rule.title}
                    </p>
                    {rule.description && <p className="mt-0.5 line-clamp-3 text-[11px] text-muted-foreground">{rule.description}</p>}
                  </li>
                ))}
              </ol>
            ) : (
              <ul className="space-y-1.5 text-xs text-muted-foreground">
                <li>Post to one subreddit at a time. Reddit treats identical cross-posts as spam.</li>
                <li>Many communities limit self-promotion. Share something useful, not an ad.</li>
                <li>Video and image uploads are not supported here; share a link instead.</li>
              </ul>
            )}
          </CardContent>
        </Card>
      ) : article ? (
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Article</CardTitle>
            <CardDescription>
              {connectors?.hashnode?.account?.publication?.title
                ? `Goes to ${connectors.hashnode.account.publication.title}.`
                : 'Goes to your connected blog.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {safeImageUrl(cover) && <img src={cover} alt="" className="aspect-[1.9/1] w-full rounded-xl object-cover" referrerPolicy="no-referrer" />}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-muted/70 px-3 py-2">
                <p className="text-[11px] text-muted-foreground">Words</p>
                <p className="text-sm font-semibold tabular-nums">{words}</p>
              </div>
              <div className="rounded-xl bg-muted/70 px-3 py-2">
                <p className="text-[11px] text-muted-foreground">Read time</p>
                <p className="text-sm font-semibold tabular-nums">{Math.max(1, Math.round(words / 230))} min</p>
              </div>
            </div>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li>Start with an H2 (##); Hashnode shows the title as the H1.</li>
              <li>Tags help readers find it. Hashnode creates any tag that does not exist yet.</li>
              <li>Drafts appear in your Hashnode dashboard, ready to edit and publish.</li>
            </ul>
          </CardContent>
        </Card>
      ) : (
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Video</CardTitle>
          <CardDescription>{needsVideo ? 'Required. Vertical 9:16 works best.' : 'Optional. Add one to post a video.'}</CardDescription>
        </CardHeader>
        <CardContent>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          {file ? (
            <div className="space-y-3">
              <video src={preview} controls className="mx-auto aspect-[9/16] max-h-80 rounded-xl border bg-black/5 object-cover" />
              <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-xs">
                <Clapperboard className="size-4 shrink-0" />
                <span className="flex-1 truncate">{file.name}</span>
                <button type="button" onClick={() => setFile(null)} aria-label="Remove video" className="rounded p-0.5 hover:bg-background">
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
                const dropped = e.dataTransfer.files?.[0]
                if (dropped) setFile(dropped)
              }}
              className={cn(
                'flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed text-sm text-muted-foreground transition hover:border-p1 hover:bg-p1-soft/40',
              )}
            >
              <span className={cn('flex size-11 items-center justify-center rounded-2xl', SLOT_CLASSES[network.slot].chip)}>
                <Upload className="size-5" />
              </span>
              <span className="font-medium text-foreground">Drop a video or click to browse</span>
              <span className="text-xs">mp4, mov, or webm up to {health?.maxUploadMb ?? 200} MB</span>
            </button>
          )}
        </CardContent>
      </Card>
      )}
    </form>
  )
}

function safeImageUrl(url: string) {
  return /^https:\/\/\S+$/.test(url.trim())
}
