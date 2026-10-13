import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, ArrowUp, CircleCheck, CircleDashed, ExternalLink, Layers, Plug, Send, Sparkles } from 'lucide-react'
import { EmptyState, Stat } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { postNetwork, safeImage, safeLink, timeAgo, type Post } from '@/lib/api'
import { useAppState } from '@/lib/app-state'
import { NETWORKS, SLOT_CLASSES, networkById, networkState } from '@/lib/networks'
import { cn } from '@/lib/utils'

export function PostRow({ post }: { post: Post }) {
  const network = networkById[postNetwork(post)]
  const link = safeLink(post.url)
  return (
    <div className="flex items-center gap-3 py-3">
      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', SLOT_CLASSES[network.slot].chip)}>
        <network.icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{post.title || post.description || 'Untitled'}</p>
        <p className="text-xs text-muted-foreground">
          {network.name}
          {post.privacyStatus ? ` · ${post.privacyStatus}` : ''} · {post.source || 'manual'} · {timeAgo(post.createdAt)}
        </p>
      </div>
      {link && (
        <Button asChild size="icon-sm" variant="ghost" aria-label="Open post">
          <a href={link} target="_blank" rel="noreferrer">
            <ExternalLink />
          </a>
        </Button>
      )}
    </div>
  )
}

function QuickBrew() {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  return (
    <Card className="bg-palette relative overflow-hidden border-0 shadow-md">
      <CardContent className="relative p-6 md:p-8">
        <div className="flex items-center gap-2 text-sm font-medium text-ink/80">
          <Sparkles className="size-4" /> Brew with Grok
        </div>
        <h2 className="mt-2 max-w-xl text-2xl font-semibold tracking-tight text-ink md:text-3xl">
          Tell Grok what to make. It writes, generates, and posts.
        </h2>
        <form
          className="mt-5 flex max-w-2xl items-center gap-2 rounded-2xl bg-white/80 p-1.5 shadow-sm backdrop-blur focus-within:ring-4 focus-within:ring-white/60"
          onSubmit={(e) => {
            e.preventDefault()
            navigate('/brew', { state: { prompt: text.trim() } })
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. An 8s Short of steam rising from coffee, posted unlisted to YouTube"
            className="min-w-0 flex-1 bg-transparent px-3 text-sm text-ink outline-none placeholder:text-ink/50"
            aria-label="Describe what to brew"
          />
          <Button type="submit" size="icon" className="shrink-0 rounded-xl bg-ink text-white hover:bg-ink/85" aria-label="Open in Brew">
            <ArrowUp />
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

export function OverviewPage() {
  const { health, connectors, posts } = useAppState()
  const connected = NETWORKS.filter((n) => networkState(n.id, health, connectors).connected).length
  const week = posts?.filter((p) => Date.now() - new Date(p.createdAt).getTime() < 7 * 86400000).length ?? 0
  const byGrok = posts?.filter((p) => ['agent', 'grok', 'connector'].includes(p.source || '')).length ?? 0

  const setup = [
    { done: Boolean(health?.xai), label: 'Add your xAI API key', to: '/settings' },
    { done: Boolean(health?.youtubeConnected), label: 'Connect YouTube', to: '/connectors/youtube/connection' },
    { done: Boolean(health?.linkedinConnected), label: 'Connect LinkedIn', to: '/connectors/linkedin/connection' },
    { done: Boolean(health?.instagramConnected), label: 'Connect Instagram', to: '/connectors/instagram/connection' },
    { done: Boolean(health?.xConnected), label: 'Connect X', to: '/connectors/x/connection' },
    { done: Boolean(health?.hashnodeConnected), label: 'Connect Hashnode', to: '/connectors/hashnode/connection' },
    { done: Boolean(health?.slackConnected), label: 'Connect Slack', to: '/connectors/slack/connection' },
    { done: Boolean(health?.redditConnected), label: 'Connect Reddit', to: '/connectors/reddit/connection' },
    { done: Boolean(connectors && !connectors.grok.localOnly), label: 'Expose the Grok connector with a tunnel', to: '/connectors/grok' },
  ]
  const remaining = setup.filter((s) => !s.done)

  return (
    <div className="space-y-6">
      <QuickBrew />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total posts" value={posts ? posts.length : <Skeleton className="h-7 w-10" />} icon={Layers} tone="p1" hint="Across every network" />
        <Stat label="This week" value={posts ? week : <Skeleton className="h-7 w-10" />} icon={Send} tone="p3" hint="Last 7 days" />
        <Stat label="Posted by Grok" value={posts ? byGrok : <Skeleton className="h-7 w-10" />} icon={Sparkles} tone="p2" hint="Brew and grok.com" />
        <Stat label="Connectors" value={health ? `${connected}/3` : <Skeleton className="h-7 w-10" />} icon={Plug} tone="p4" hint="Networks connected" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {NETWORKS.map((network) => {
          const state = networkState(network.id, health, connectors)
          const count = posts?.filter((p) => postNetwork(p) === network.id).length ?? 0
          const picture = safeImage(state.picture)
          return (
            <Link
              key={network.id}
              to={`/connectors/${network.id}`}
              className="group rounded-2xl border bg-card p-5 shadow-xs transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <span className={cn('flex size-10 items-center justify-center rounded-2xl', SLOT_CLASSES[network.slot].chip)}>
                  <network.icon className="size-5" />
                </span>
                <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
              </div>
              <h3 className="mt-4 font-semibold">{network.name}</h3>
              <p className="text-sm text-muted-foreground">{network.blurb}</p>
              <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3 text-xs">
                <span className="flex min-w-0 items-center gap-2">
                  {picture ? (
                    <img src={picture} alt="" className="size-5 rounded-full" referrerPolicy="no-referrer" />
                  ) : (
                    <span className={cn('size-2 rounded-full', state.connected ? 'bg-p4-ink' : 'bg-muted-foreground/40')} />
                  )}
                  <span className="truncate text-muted-foreground">
                    {state.loading ? 'Checking…' : state.connected ? state.accountName || 'Connected' : state.ready ? 'Ready to connect' : 'Needs keys'}
                  </span>
                </span>
                <span className="shrink-0 font-medium tabular-nums">{count} posts</span>
              </div>
            </Link>
          )
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Recent posts</CardTitle>
            <CardDescription>The latest things Socialbrewery published.</CardDescription>
          </CardHeader>
          <CardContent>
            {posts === null ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : posts.length ? (
              <div className="divide-y">
                {posts.slice(0, 6).map((post) => (
                  <PostRow key={post.id} post={post} />
                ))}
              </div>
            ) : (
              <EmptyState icon={Send} title="Nothing posted yet" action={<Button asChild><Link to="/brew">Brew your first post</Link></Button>}>
                Ask Grok in Brew, or compose a post from any connector page.
              </EmptyState>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Setup</CardTitle>
            <CardDescription>
              {remaining.length ? `${setup.length - remaining.length} of ${setup.length} done` : 'Everything is connected.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="mb-3 h-2 overflow-hidden rounded-full bg-muted">
              <div className="bg-palette h-full rounded-full transition-all" style={{ width: `${((setup.length - remaining.length) / setup.length) * 100}%` }} />
            </div>
            {setup.map((step) => (
              <Link
                key={step.label}
                to={step.to}
                className="flex items-center gap-3 rounded-xl px-2 py-2 text-sm transition hover:bg-muted"
              >
                {step.done ? <CircleCheck className="size-4 text-p4-ink" /> : <CircleDashed className="size-4 text-muted-foreground" />}
                <span className={cn('flex-1', step.done && 'text-muted-foreground line-through decoration-p4-ink/40')}>{step.label}</span>
                {!step.done && <ArrowRight className="size-3.5 text-muted-foreground" />}
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
