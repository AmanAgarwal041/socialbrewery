import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowBigUp, BarChart3, Eye, Heart, Info, Loader2, MessageCircle, Percent, RefreshCw, Sparkles, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState, Stat } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { api, formatCount, navigateSignedIn, postJson, postNetwork, safeImage, safeLink, timeAgo, type HashnodeArticle, type RedditStat, type Review, type SlackStat, type Video } from '@/lib/api'
import { useAppState } from '@/lib/app-state'
import { SLOT_CLASSES, networkState, type NetworkMeta } from '@/lib/networks'
import { cn } from '@/lib/utils'

const METRIC_LABELS: Record<string, string> = {
  views: 'Views',
  estimatedMinutesWatched: 'Minutes watched',
  averageViewDuration: 'Avg view (s)',
  averageViewPercentage: 'Avg % viewed',
  likes: 'Likes',
  comments: 'Comments',
  shares: 'Shares',
  subscribersGained: 'Subs gained',
}

function Bars({ items }: { items: { label: string; value: number; hint?: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <div className="flex h-44 items-end gap-2">
      {items.map((item, index) => (
        <div key={index} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5" title={`${item.label}: ${item.value}`}>
          <span className="text-[10px] tabular-nums text-muted-foreground opacity-0 transition group-hover:opacity-100">
            {formatCount(item.value)}
          </span>
          <div
            className="w-full rounded-t-lg bg-gradient-to-t from-p1 to-p3 transition-all group-hover:from-p1-ink/60"
            style={{ height: `${Math.max(3, (item.value / max) * 100)}%` }}
          />
          <span className="w-full truncate text-center text-[10px] text-muted-foreground">{item.hint || item.label}</span>
        </div>
      ))}
    </div>
  )
}

function VideoReview({ video, provider, onReviewed }: { video: Video; provider: string; onReviewed: (id: string, review: Review) => void }) {
  const [busy, setBusy] = useState(false)
  const [review, setReview] = useState<Review | null>(null)
  const thumb = safeImage(video.thumbnail)
  const link = safeLink(video.shortsUrl || video.url)
  const analysis = review?.analysis || video.analysis

  async function analyze() {
    setBusy(true)
    try {
      const { review: next } = await postJson<{ review: Review }>('/api/youtube/analyze', { videoId: video.id, provider })
      setReview(next)
      onReviewed(video.id, next)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="gap-4 py-4">
      <CardContent className="flex gap-4 px-4">
        {thumb ? (
          <img src={thumb} alt="" className="h-20 w-32 shrink-0 rounded-xl object-cover" referrerPolicy="no-referrer" />
        ) : (
          <div className="flex h-20 w-32 shrink-0 items-center justify-center rounded-xl bg-p1-soft text-p1-ink">
            <BarChart3 className="size-5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <a href={link || undefined} target="_blank" rel="noreferrer" className="line-clamp-2 flex-1 text-sm font-medium hover:underline">
              {video.title}
            </a>
            {video.privacyStatus && <Badge variant="secondary">{video.privacyStatus}</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{timeAgo(video.publishedAt)}</p>
          <div className="mt-2 flex flex-wrap gap-3 text-xs">
            <span className="inline-flex items-center gap-1"><Eye className="size-3.5 text-p1-ink" />{formatCount(video.views)}</span>
            <span className="inline-flex items-center gap-1"><Heart className="size-3.5 text-p2-ink" />{formatCount(video.likes)}</span>
            <span className="inline-flex items-center gap-1"><MessageCircle className="size-3.5 text-p3-ink" />{formatCount(video.comments)}</span>
          </div>
        </div>
        <div className="shrink-0">
          <Button size="sm" variant={analysis ? 'ghost' : 'secondary'} onClick={analyze} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Wand2 />}
            {busy ? 'Reviewing…' : analysis ? 'Re-run' : 'Analyze'}
          </Button>
        </div>
      </CardContent>
      {review?.performance?.last28Days && (
        <div className="grid grid-cols-2 gap-2 px-4 sm:grid-cols-4">
          {Object.entries(review.performance.last28Days).map(([key, value]) => (
            <div key={key} className="rounded-xl bg-muted/70 px-3 py-2">
              <p className="text-[11px] text-muted-foreground">{METRIC_LABELS[key] || key}</p>
              <p className="text-sm font-semibold tabular-nums">{value == null ? '—' : formatCount(Math.round(Number(value) * 10) / 10)}</p>
            </div>
          ))}
        </div>
      )}
      {analysis && (
        <div className="mx-4 rounded-2xl bg-gradient-to-br from-p2-soft to-p3-soft p-4">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-p1-ink">
            <Sparkles className="size-3.5" /> AI review{review ? ` · ${{ openai: 'OpenAI', claude: 'Claude' }[review.provider as string] || 'Grok'}` : ''}
          </p>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{analysis}</p>
        </div>
      )}
    </Card>
  )
}

function YoutubeAnalysis({ network }: { network: NetworkMeta }) {
  const { health, connectors } = useAppState()
  const state = networkState('youtube', health, connectors)
  const [videos, setVideos] = useState<Video[] | null>(null)
  const [error, setError] = useState('')
  const [provider, setProvider] = useState('grok')

  const load = useCallback(async () => {
    setError('')
    setVideos(null)
    try {
      const data = await api<{ videos: Video[] }>('/api/youtube/videos')
      setVideos(data.videos)
    } catch (err) {
      setError((err as Error).message)
      setVideos([])
    }
  }, [])

  useEffect(() => {
    if (state.connected) load()
  }, [state.connected, load])

  const totals = useMemo(() => {
    const list = videos || []
    const sum = (key: 'views' | 'likes' | 'comments') => list.reduce((acc, v) => acc + (v[key] || 0), 0)
    const views = sum('views')
    const likes = sum('likes')
    return { views, likes, comments: sum('comments'), rate: views ? (likes / views) * 100 : 0 }
  }, [videos])

  if (!state.connected) {
    return (
      <EmptyState icon={network.icon} title="Connect YouTube to see performance" action={<Button asChild><Link to="/connectors/youtube/connection">Connect</Link></Button>}>
        Channel stats and AI reviews appear here once a channel is connected.
      </EmptyState>
    )
  }

  if (error) {
    const expired = /expired|revoked|connect/i.test(error)
    return (
      <Alert variant="destructive">
        <Info />
        <AlertTitle>{expired ? 'YouTube needs you to sign in again' : 'Could not load videos'}</AlertTitle>
        <AlertDescription>
          <p>{error}</p>
          {expired && <p>Google test-mode logins expire after 7 days. Publish the consent screen to keep them longer.</p>}
          <div className="mt-2 flex gap-2">
            <Button asChild size="sm">
              <a
                href="/api/youtube/connect"
                onClick={(event) => {
                  event.preventDefault()
                  navigateSignedIn('/api/youtube/connect')
                }}
              >
                Reconnect YouTube
              </a>
            </Button>
            <Button size="sm" variant="outline" onClick={load}>
              <RefreshCw /> Try again
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Views" value={videos ? formatCount(totals.views) : <Skeleton className="h-7 w-14" />} icon={Eye} tone="p1" hint="Latest uploads" />
        <Stat label="Likes" value={videos ? formatCount(totals.likes) : <Skeleton className="h-7 w-14" />} icon={Heart} tone="p2" />
        <Stat label="Comments" value={videos ? formatCount(totals.comments) : <Skeleton className="h-7 w-14" />} icon={MessageCircle} tone="p3" />
        <Stat label="Like rate" value={videos ? `${totals.rate.toFixed(1)}%` : <Skeleton className="h-7 w-14" />} icon={Sparkles} tone="p4" hint="Likes per view" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Views by video</CardTitle>
          <CardDescription>Oldest to newest of the latest {videos?.length || 0} uploads.</CardDescription>
          <CardAction>
            <Button size="sm" variant="ghost" onClick={load}>
              <RefreshCw /> Refresh
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {videos === null ? (
            <Skeleton className="h-44 w-full" />
          ) : videos.length ? (
            <Bars
              items={[...videos].reverse().map((v, i) => ({ label: v.title, value: v.views || 0, hint: `#${i + 1}` }))}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{error || 'This channel has no uploads yet.'}</p>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">AI reviews</h2>
          <p className="text-sm text-muted-foreground">Last 28 days of analytics, reviewed with suggestions to improve.</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Reviewer</span>
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="grok">Grok</SelectItem>
              <SelectItem value="claude">Claude</SelectItem>
              <SelectItem value="openai">OpenAI</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-3">
        {videos === null
          ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full rounded-2xl" />)
          : videos.map((video) => (
              <VideoReview
                key={video.id}
                video={video}
                provider={provider}
                onReviewed={(id, review) => setVideos((prev) => prev?.map((v) => (v.id === id ? { ...v, analysis: review.analysis } : v)) || null)}
              />
            ))}
      </div>
    </div>
  )
}

function ActivityAnalysis({ network }: { network: NetworkMeta }) {
  const { posts } = useAppState()
  const mine = (posts || []).filter((p) => postNetwork(p) === network.id)
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const end = Date.now() - (7 - i) * 7 * 86400000
    const start = end - 7 * 86400000
    const value = mine.filter((p) => {
      const t = new Date(p.createdAt).getTime()
      return t > start && t <= end
    }).length
    return { label: new Date(end).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), value }
  })
  const bySource = mine.reduce<Record<string, number>>((acc, p) => {
    const key = p.source || 'manual'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
  const avgLength = mine.length ? Math.round(mine.reduce((a, p) => a + (p.description || '').length, 0) / mine.length) : 0

  return (
    <div className="space-y-4">
      <Alert className={cn('border-0', SLOT_CLASSES[network.slot].soft)}>
        <Info />
        <AlertTitle>Engagement numbers need extra permissions</AlertTitle>
        <AlertDescription>
          {network.id === 'linkedin'
            ? 'LinkedIn only shares post analytics with apps approved for the Community Management API. Until then, this page shows your posting activity from Socialbrewery.'
            : network.id === 'x'
              ? 'X post metrics are billed as extra API reads, so Socialbrewery does not fetch them yet. This page shows your posting activity from Socialbrewery.'
              : 'Instagram insights need the instagram_business_manage_insights permission on your Meta app. Until then, this page shows your posting activity from Socialbrewery.'}
        </AlertDescription>
      </Alert>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Posts" value={mine.length} icon={network.icon} tone={network.slot} />
        <Stat label="Last 4 weeks" value={weeks.slice(-4).reduce((a, w) => a + w.value, 0)} icon={BarChart3} tone="p3" />
        <Stat label="By AI" value={(bySource.agent || 0) + (bySource.grok || 0) + (bySource.claude || 0) + (bySource.connector || 0) + (bySource.extension || 0)} icon={Sparkles} tone="p2" />
        <Stat label="Avg length" value={`${avgLength}`} icon={MessageCircle} tone="p4" hint="Characters per post" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Posts per week</CardTitle>
          <CardDescription>The last 8 weeks.</CardDescription>
        </CardHeader>
        <CardContent>
          <Bars items={weeks.map((w) => ({ label: w.label, value: w.value }))} />
        </CardContent>
      </Card>
    </div>
  )
}

function HashnodeAnalysis({ network }: { network: NetworkMeta }) {
  const { health, connectors } = useAppState()
  const navigate = useNavigate()
  const state = networkState('hashnode', health, connectors)
  const [articles, setArticles] = useState<HashnodeArticle[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    setArticles(null)
    try {
      const data = await api<{ posts: HashnodeArticle[] }>('/api/hashnode/posts?limit=20')
      setArticles(data.posts)
    } catch (err) {
      setError((err as Error).message)
      setArticles([])
    }
  }, [])

  useEffect(() => {
    if (state.connected) load()
  }, [state.connected, load])

  const totals = useMemo(() => {
    const list = articles || []
    const sum = (key: 'views' | 'reactions' | 'comments') => list.reduce((acc, a) => acc + (a[key] || 0), 0)
    const views = sum('views')
    return { views, reactions: sum('reactions'), comments: sum('comments'), avg: list.length ? Math.round(views / list.length) : 0 }
  }, [articles])

  if (!state.connected) {
    return (
      <EmptyState icon={network.icon} title="Connect Hashnode to see article stats" action={<Button asChild><Link to="/connectors/hashnode/connection">Connect</Link></Button>}>
        Views, reactions, and comments for your blog appear here.
      </EmptyState>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <Info />
        <AlertTitle>Could not load articles</AlertTitle>
        <AlertDescription>
          <p>{error}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={load}>
            <RefreshCw /> Try again
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  function review() {
    navigate('/brew', {
      state: {
        target: 'hashnode',
        prompt: 'List my recent Hashnode articles, compare the best and worst by views and reactions, and suggest three article ideas and title changes based on what worked.',
      },
    })
  }

  const loading = <Skeleton className="h-7 w-14" />
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Views" value={articles ? formatCount(totals.views) : loading} icon={Eye} tone="p1" hint="Latest articles" />
        <Stat label="Reactions" value={articles ? formatCount(totals.reactions) : loading} icon={Heart} tone="p2" />
        <Stat label="Comments" value={articles ? formatCount(totals.comments) : loading} icon={MessageCircle} tone="p3" />
        <Stat label="Avg views" value={articles ? formatCount(totals.avg) : loading} icon={BarChart3} tone="p4" hint="Per article" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Views by article</CardTitle>
          <CardDescription>Oldest to newest of the latest {articles?.length || 0} articles.</CardDescription>
          <CardAction className="flex gap-1">
            <Button size="sm" variant="secondary" onClick={review}>
              <Sparkles /> Ask Grok to review
            </Button>
            <Button size="sm" variant="ghost" onClick={load}>
              <RefreshCw /> Refresh
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {articles === null ? (
            <Skeleton className="h-44 w-full" />
          ) : articles.length ? (
            <Bars items={[...articles].reverse().map((a, i) => ({ label: a.title, value: a.views || 0, hint: `#${i + 1}` }))} />
          ) : (
            <p className="text-sm text-muted-foreground">This blog has no published articles yet.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {articles === null
          ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)
          : articles.map((a) => {
              const cover = safeImage(a.cover)
              const link = safeLink(a.url)
              return (
                <Card key={a.id} className="py-4">
                  <CardContent className="flex gap-4 px-4">
                    {cover ? (
                      <img src={cover} alt="" className="h-20 w-36 shrink-0 rounded-xl object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <div className={cn('flex h-20 w-36 shrink-0 items-center justify-center rounded-xl', SLOT_CLASSES[network.slot].chip)}>
                        <network.icon className="size-5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <a href={link || undefined} target="_blank" rel="noreferrer" className="line-clamp-2 text-sm font-medium hover:underline">
                        {a.title}
                      </a>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {timeAgo(a.publishedAt)}
                        {a.readTime ? ` · ${a.readTime} min read` : ''}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                        <span className="inline-flex items-center gap-1"><Eye className="size-3.5 text-p1-ink" />{formatCount(a.views)}</span>
                        <span className="inline-flex items-center gap-1"><Heart className="size-3.5 text-p2-ink" />{formatCount(a.reactions)}</span>
                        <span className="inline-flex items-center gap-1"><MessageCircle className="size-3.5 text-p3-ink" />{formatCount(a.comments)}</span>
                        {a.tags.slice(0, 3).map((tag) => (
                          <Badge key={tag} variant="outline">{tag}</Badge>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
      </div>
    </div>
  )
}

function SlackAnalysis({ network }: { network: NetworkMeta }) {
  const { health, connectors } = useAppState()
  const state = networkState('slack', health, connectors)
  const [rows, setRows] = useState<SlackStat[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    setRows(null)
    try {
      const data = await api<{ posts: SlackStat[] }>('/api/slack/stats')
      setRows(data.posts)
    } catch (err) {
      setError((err as Error).message)
      setRows([])
    }
  }, [])

  useEffect(() => {
    if (state.connected) load()
  }, [state.connected, load])

  const totals = useMemo(() => {
    const list = rows || []
    const reactions = list.reduce((a, r) => a + (r.reactions || 0), 0)
    const replies = list.reduce((a, r) => a + (r.replies || 0), 0)
    const byChannel = list.reduce<Record<string, number>>((acc, r) => {
      acc[r.channel] = (acc[r.channel] || 0) + (r.reactions || 0) + (r.replies || 0)
      return acc
    }, {})
    const best = Object.entries(byChannel).sort((a, b) => b[1] - a[1])[0]
    return { reactions, replies, avg: list.length ? (reactions + replies) / list.length : 0, best: best ? `#${best[0]}` : '—' }
  }, [rows])

  if (!state.connected) {
    return (
      <EmptyState icon={network.icon} title="Connect Slack to see engagement" action={<Button asChild><Link to="/connectors/slack/connection">Connect</Link></Button>}>
        Reactions and thread replies on messages Socialbrewery posted appear here.
      </EmptyState>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <Info />
        <AlertTitle>Could not load Slack engagement</AlertTitle>
        <AlertDescription>
          <p>{error}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={load}>
            <RefreshCw /> Try again
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const loading = <Skeleton className="h-7 w-14" />
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Reactions" value={rows ? formatCount(totals.reactions) : loading} icon={Heart} tone="p2" hint="Latest 20 messages" />
        <Stat label="Thread replies" value={rows ? formatCount(totals.replies) : loading} icon={MessageCircle} tone="p3" />
        <Stat label="Avg engagement" value={rows ? totals.avg.toFixed(1) : loading} icon={BarChart3} tone="p1" hint="Reactions + replies per message" />
        <Stat label="Best channel" value={rows ? totals.best : loading} icon={Sparkles} tone="p4" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Engagement by message</CardTitle>
          <CardDescription>Reactions plus thread replies, oldest to newest.</CardDescription>
          <CardAction>
            <Button size="sm" variant="ghost" onClick={load}>
              <RefreshCw /> Refresh
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {rows === null ? (
            <Skeleton className="h-44 w-full" />
          ) : rows.length ? (
            <Bars items={[...rows].reverse().map((r, i) => ({ label: r.title, value: (r.reactions || 0) + (r.replies || 0), hint: `#${i + 1}` }))} />
          ) : (
            <p className="text-sm text-muted-foreground">Post a message from Socialbrewery and its reactions show up here.</p>
          )}
        </CardContent>
      </Card>
      <div className="grid gap-3">
        {rows?.map((r) => {
          const link = safeLink(r.url)
          return (
            <Card key={r.id} className="py-4">
              <CardContent className="flex items-start gap-4 px-4">
                <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', SLOT_CLASSES[network.slot].chip)}>
                  <network.icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <a href={link || undefined} target="_blank" rel="noreferrer" className="line-clamp-2 text-sm font-medium hover:underline">
                    {r.title || 'Untitled message'}
                  </a>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    #{r.channel} · {timeAgo(r.createdAt)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                    <span className="inline-flex items-center gap-1"><Heart className="size-3.5 text-p2-ink" />{formatCount(r.reactions)}</span>
                    <span className="inline-flex items-center gap-1"><MessageCircle className="size-3.5 text-p3-ink" />{formatCount(r.replies)}</span>
                    {r.top.map((t) => (
                      <Badge key={t.name} variant="outline">:{t.name}: {t.count}</Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function RedditAnalysis({ network }: { network: NetworkMeta }) {
  const { health, connectors } = useAppState()
  const state = networkState('reddit', health, connectors)
  const [rows, setRows] = useState<RedditStat[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    setRows(null)
    try {
      const data = await api<{ posts: RedditStat[] }>('/api/reddit/stats')
      setRows(data.posts)
    } catch (err) {
      setError((err as Error).message)
      setRows([])
    }
  }, [])

  useEffect(() => {
    if (state.connected) load()
  }, [state.connected, load])

  const totals = useMemo(() => {
    const live = (rows || []).filter((r) => r.score != null)
    const score = live.reduce((a, r) => a + (r.score || 0), 0)
    const comments = live.reduce((a, r) => a + (r.comments || 0), 0)
    const ratios = live.filter((r) => r.upvoteRatio != null)
    const ratio = ratios.length ? ratios.reduce((a, r) => a + (r.upvoteRatio || 0), 0) / ratios.length : null
    const bySub = live.reduce<Record<string, number>>((acc, r) => {
      acc[r.subreddit] = (acc[r.subreddit] || 0) + (r.score || 0)
      return acc
    }, {})
    const best = Object.entries(bySub).sort((a, b) => b[1] - a[1])[0]
    return { score, comments, ratio, best: best ? `r/${best[0]}` : '—', removed: (rows || []).filter((r) => r.removed).length }
  }, [rows])

  if (!state.connected) {
    return (
      <EmptyState icon={network.icon} title="Reddit stats need API access" action={<Button asChild variant="outline"><Link to="/connectors/reddit/posts">See tracked posts</Link></Button>}>
        Scores, comments, and upvote ratios come from Reddit's API, which needs approved keys. Posts you track in manual mode are listed under Posts with links to Reddit.
      </EmptyState>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <Info />
        <AlertTitle>Could not load Reddit stats</AlertTitle>
        <AlertDescription>
          <p>{error}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={load}>
            <RefreshCw /> Try again
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const loading = <Skeleton className="h-7 w-14" />
  return (
    <div className="space-y-4">
      {totals.removed > 0 && (
        <Alert>
          <Info />
          <AlertTitle>{totals.removed === 1 ? 'One post was removed' : `${totals.removed} posts were removed`}</AlertTitle>
          <AlertDescription>Moderators or Reddit's filters took it down. Check the subreddit rules before posting there again.</AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total score" value={rows ? formatCount(totals.score) : loading} icon={ArrowBigUp} tone="p3" hint="Latest 25 posts" />
        <Stat label="Comments" value={rows ? formatCount(totals.comments) : loading} icon={MessageCircle} tone="p2" />
        <Stat
          label="Upvote ratio"
          value={rows ? (totals.ratio == null ? '—' : `${Math.round(totals.ratio * 100)}%`) : loading}
          icon={Percent}
          tone="p1"
          hint="Average across posts"
        />
        <Stat label="Best subreddit" value={rows ? totals.best : loading} icon={Sparkles} tone="p4" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Score by post</CardTitle>
          <CardDescription>Upvotes minus downvotes, oldest to newest.</CardDescription>
          <CardAction>
            <Button size="sm" variant="ghost" onClick={load}>
              <RefreshCw /> Refresh
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {rows === null ? (
            <Skeleton className="h-44 w-full" />
          ) : rows.length ? (
            <Bars items={[...rows].reverse().map((r, i) => ({ label: r.title, value: Math.max(0, r.score || 0), hint: `#${i + 1}` }))} />
          ) : (
            <p className="text-sm text-muted-foreground">Submit a post from Socialbrewery and its score shows up here.</p>
          )}
        </CardContent>
      </Card>
      <div className="grid gap-3">
        {rows?.map((r) => {
          const link = safeLink(r.url)
          return (
            <Card key={r.id} className="py-4">
              <CardContent className="flex items-start gap-4 px-4">
                <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', SLOT_CLASSES[network.slot].chip)}>
                  <network.icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <a href={link || undefined} target="_blank" rel="noreferrer" className="line-clamp-2 text-sm font-medium hover:underline">
                    {r.title || 'Untitled post'}
                  </a>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    r/{r.subreddit} · {timeAgo(r.createdAt)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                    <span className="inline-flex items-center gap-1"><ArrowBigUp className="size-3.5 text-p3-ink" />{formatCount(r.score)}</span>
                    <span className="inline-flex items-center gap-1"><MessageCircle className="size-3.5 text-p2-ink" />{formatCount(r.comments)}</span>
                    {r.upvoteRatio != null && <span className="text-muted-foreground">{Math.round(r.upvoteRatio * 100)}% upvoted</span>}
                    {r.deleted ? <Badge variant="outline">deleted</Badge> : r.removed && <Badge variant="destructive">removed</Badge>}
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

export function NetworkAnalysis({ network }: { network: NetworkMeta }) {
  if (network.id === 'youtube') return <YoutubeAnalysis network={network} />
  if (network.id === 'hashnode') return <HashnodeAnalysis network={network} />
  if (network.id === 'slack') return <SlackAnalysis network={network} />
  if (network.id === 'reddit') return <RedditAnalysis network={network} />
  return <ActivityAnalysis network={network} />
}
