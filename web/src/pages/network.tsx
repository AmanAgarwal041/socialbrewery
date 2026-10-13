import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { CircleAlert, Download, ExternalLink, KeyRound, LineChart, Loader2, Lock, PenSquare, Plug, RefreshCw, Send, Sparkles, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import { CopyField, EmptyState, PageHeader, Stat, StatusBadge } from '@/components/common'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, postJson, postNetwork, safeImage, timeAgo, type InstagramEvent, type NetworkId } from '@/lib/api'
import { useAppState } from '@/lib/app-state'
import { SLOT_CLASSES, networkById, networkState, type NetworkMeta } from '@/lib/networks'
import { cn } from '@/lib/utils'
import { PostRow } from '@/pages/overview'
import { NetworkAnalysis } from '@/pages/network-analysis'
import { NetworkCompose, NetworkPosts } from '@/pages/network-posts'

const TABS = ['overview', 'posts', 'compose', 'analysis', 'connection'] as const
type Tab = (typeof TABS)[number]

const SETUP: Record<NetworkId, { steps: React.ReactNode[]; docs: { label: string; href: string } }> = {
  youtube: {
    docs: { label: 'Google Cloud console', href: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com' },
    steps: [
      'In Google Cloud, enable YouTube Data API v3 and YouTube Analytics API.',
      'Create an OAuth client of type Web and add the redirect URI below.',
      'On the consent screen, add your Google account as a test user.',
      'Paste the client ID and secret in Settings, save, then connect. In Google’s account list, pick the channel that has the videos. A brand channel is its own account there.',
    ],
  },
  linkedin: {
    docs: { label: 'LinkedIn Developers', href: 'https://www.linkedin.com/developers/apps' },
    steps: [
      'Create a LinkedIn app and add the products “Sign In with LinkedIn using OpenID Connect” and “Share on LinkedIn”.',
      'Under Auth, add the redirect URI below.',
      'Paste the client ID and secret in Settings, save, then connect.',
      'Posting to a company page needs a separate app approved for the Community Management API.',
    ],
  },
  instagram: {
    docs: { label: 'Meta App Dashboard', href: 'https://developers.facebook.com/apps' },
    steps: [
      'Create a Meta app with “Instagram API with Instagram Login” and use a professional (business or creator) account.',
      'Add the redirect URI below to the app’s Instagram login settings.',
      'Paste the Instagram app ID and secret in Settings, save, then connect.',
      'Instagram downloads the video from your tunnel, so set the Grok connector public URL in Settings before posting Reels.',
    ],
  },
  x: {
    docs: { label: 'X Developer Console', href: 'https://console.x.com' },
    steps: [
      'Create an app in the X Developer Console. Posting through the X API uses paid API credits, so add some to your account.',
      'Under User authentication settings, turn on OAuth 2.0, set app permissions to “Read and write”, and pick type “Web App”.',
      'Add the redirect URI below as a Callback URI, exactly as shown.',
      'Copy the OAuth 2.0 Client ID and Client Secret (not the API key) into Settings, save, then connect.',
    ],
  },
  hashnode: {
    docs: { label: 'Hashnode developer settings', href: 'https://hashnode.com/settings/developer' },
    steps: [
      'Hashnode only allows API access for blogs on the Pro plan. Upgrade under your blog dashboard → Billing.',
      'In Account settings → Developer, generate a personal access token.',
      'Paste it in Settings as the Hashnode access token. Add your blog host if you have more than one blog, then save.',
      'Click Connect. Socialbrewery checks the token and remembers which blog to post to. There is no redirect to approve.',
    ],
  },
  slack: {
    docs: { label: 'Slack apps', href: 'https://api.slack.com/apps?new_app=1' },
    steps: [
      'Copy the app manifest on the left. At api.slack.com/apps choose Create New App → From a manifest, pick your workspace, and paste it.',
      'Click Install to Workspace and allow the permissions.',
      'Under OAuth & Permissions, copy the Bot User OAuth Token (starts with xoxb-) into Settings, optionally set a default channel, and save.',
      'Click Connect. Public channels work right away; for a private channel, run /invite @Socialbrewery in it first.',
    ],
  },
  reddit: {
    docs: { label: 'Reddit API access request', href: 'https://support.reddithelp.com/hc/en-us/requests/new?ticket_form_id=14868593862164&tf_42139884615700=api_request_type_developer_clone' },
    steps: [
      'Nothing to set up to start. Compose (or Grok in Brew) drafts the post, then opens Reddit’s own submit page with the subreddit, title, and text filled in. You click Post, then paste the link back to track it.',
      'Reddit stopped handing out API keys in November 2025: reddit.com/prefs/apps now just loops back to its Responsible Builder Policy. Postiz and every other tool need the same keys, so this is not something an app can work around.',
      'For one-click posting, comments, and stats, request access with Reddit’s form (link above). Use the request text on this page. One honest request per use case; approvals are rare and can take weeks.',
      'If Reddit approves you, or you already have an app from before November 2025: create a “web app” at reddit.com/prefs/apps with the redirect URI on this page, paste the client ID (under the app name) and secret in Settings, save, then Connect.',
    ],
  },
}

function useNetworkState(network: NetworkMeta) {
  const { health, connectors } = useAppState()
  return { ...networkState(network.id, health, connectors), connectors }
}

function AccountHeader({ network }: { network: NetworkMeta }) {
  const state = useNetworkState(network)
  const picture = safeImage(state.picture)
  return (
    <PageHeader
      eyebrow="Connector"
      title={network.name}
      icon={network.icon}
      iconClass={SLOT_CLASSES[network.slot].chip}
      description={
        <span className="inline-flex flex-wrap items-center gap-2">
          <StatusBadge on={state.connected} loading={state.loading} />
          {state.connected && (
            <span className="inline-flex items-center gap-1.5">
              {picture && <img src={picture} alt="" className="size-4 rounded-full" referrerPolicy="no-referrer" />}
              {state.accountName || 'Connected account'}
            </span>
          )}
          {!state.connected && !state.loading && <span>{network.blurb}</span>}
        </span>
      }
      actions={
        <>
          <Button asChild variant="outline">
            <Link to="/brew" state={{ target: network.id, prompt: '' }}>
              <Sparkles /> Brew for {network.name}
            </Link>
          </Button>
          <Button asChild>
            <Link to={`/connectors/${network.id}/compose`}>
              <PenSquare /> New {network.noun}
            </Link>
          </Button>
        </>
      }
    />
  )
}

function NetworkOverview({ network }: { network: NetworkMeta }) {
  const { posts } = useAppState()
  const state = useNetworkState(network)
  const mine = posts?.filter((p) => postNetwork(p) === network.id) ?? []
  const week = mine.filter((p) => Date.now() - new Date(p.createdAt).getTime() < 7 * 86400000).length
  const byGrok = mine.filter((p) => ['agent', 'grok', 'connector'].includes(p.source || '')).length

  return (
    <div className="space-y-4">
      {!state.connected && !state.loading && (
        <Alert className={cn('border-0', SLOT_CLASSES[network.slot].soft)}>
          <Plug />
          <AlertTitle>
            {network.id === 'reddit' && !state.ready
              ? 'Reddit works without API keys'
              : state.ready
                ? `Connect ${network.name} to start posting`
                : `Add ${network.name} keys first`}
          </AlertTitle>
          <AlertDescription>
            {network.id === 'reddit' && !state.ready
              ? 'Compose drafts the post and opens Reddit’s submit page pre-filled; you click Post. Approved API keys add one-click posting and stats.'
              : state.ready
                ? 'Your app keys are saved. Sign in to link an account.'
                : 'Paste the app credentials in Settings, then connect.'}
            <Button asChild size="sm" variant="secondary" className="mt-2">
              <Link to={`/connectors/${network.id}/connection`}>Open connection</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`${network.name} posts`} value={mine.length} icon={Send} tone={network.slot} />
        <Stat label="This week" value={week} icon={RefreshCw} tone="p3" hint="Last 7 days" />
        <Stat label="By Grok" value={byGrok} icon={Sparkles} tone="p2" hint="Brew and grok.com" />
        <Stat label="Last post" value={mine[0] ? timeAgo(mine[0].createdAt) : '—'} icon={LineChart} tone="p4" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent {network.name} posts</CardTitle>
            <CardDescription>
              <Link to={`/connectors/${network.id}/posts`} className="underline-offset-2 hover:underline">
                See all posts
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {mine.length ? (
              <div className="divide-y">
                {mine.slice(0, 5).map((post) => (
                  <PostRow key={post.id} post={post} />
                ))}
              </div>
            ) : (
              <EmptyState icon={network.icon} title={`No ${network.name} posts yet`}>
                Compose one here or ask Grok in Brew.
              </EmptyState>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Shortcuts</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {[
              { to: 'compose', label: `Compose a ${network.noun}`, icon: PenSquare },
              {
                to: 'analysis',
                label: { youtube: 'Review video performance', hashnode: 'Article stats', slack: 'Reactions and replies', reddit: 'Scores and comments' }[network.id as string] || 'Posting activity',
                icon: LineChart,
              },
              { to: 'connection', label: 'Connection and setup', icon: Plug },
            ].map((item) => (
              <Button key={item.to} asChild variant="outline" className="justify-start">
                <Link to={`/connectors/${network.id}/${item.to}`}>
                  <item.icon /> {item.label}
                </Link>
              </Button>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function NetworkConnection({ network }: { network: NetworkMeta }) {
  const { refresh, canManage } = useAppState()
  const navigate = useNavigate()
  const state = useNetworkState(network)
  const info = state.connectors?.[network.id]
  const setup = SETUP[network.id]
  const picture = safeImage(state.picture)

  async function disconnect() {
    try {
      await api(`/api/${network.id}/disconnect`, { method: 'POST' })
      toast.success(`${network.name} disconnected.`)
      await refresh()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>
            {state.connected ? 'Socialbrewery posts as this account.' : 'Link the account Socialbrewery should post as.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className={cn('flex items-center gap-4 rounded-2xl p-4', SLOT_CLASSES[network.slot].soft)}>
            {picture ? (
              <img src={picture} alt="" className="size-12 rounded-full ring-2 ring-white" referrerPolicy="no-referrer" />
            ) : (
              <span className="flex size-12 items-center justify-center rounded-full bg-white/70">
                <network.icon className="size-6" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{state.connected ? state.accountName || 'Connected account' : 'Not connected'}</p>
              <StatusBadge on={state.connected} loading={state.loading} offLabel={state.ready ? 'Ready to connect' : 'Needs app keys'} />
            </div>
          </div>

          {network.id === 'instagram' && state.connectors?.instagram.needsPublicUrl && (
            <Alert>
              <CircleAlert />
              <AlertTitle>Set a public tunnel URL</AlertTitle>
              <AlertDescription>
                Instagram fetches the video from your computer through a tunnel. Add it as the Grok connector public URL in Settings.
              </AlertDescription>
            </Alert>
          )}

          {!canManage && (
            <Alert>
              <Lock />
              <AlertTitle>Managed by your organisation</AlertTitle>
              <AlertDescription>Only owners and admins connect, reconnect, or disconnect accounts. You can still post with the connected account.</AlertDescription>
            </Alert>
          )}

          <div className={cn('flex flex-wrap gap-2', !canManage && 'hidden')}>
            {!state.ready ? (
              <Button onClick={() => navigate('/settings')} variant={network.id === 'reddit' ? 'outline' : 'default'}>
                <KeyRound /> {network.id === 'reddit' ? 'Add approved keys (optional)' : 'Add keys in Settings'}
              </Button>
            ) : (
              <Button asChild>
                <a href={`/api/${network.id}/connect`}>
                  <Plug /> {state.connected ? 'Reconnect' : `Connect ${network.name}`}
                </a>
              </Button>
            )}
            {state.connected && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline">
                    <Unplug /> Disconnect
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Disconnect {network.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Grok and Socialbrewery stop posting to {state.accountName || 'this account'}. Past posts stay online.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={disconnect}>
                      Disconnect
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
          {network.id === 'reddit' && !state.connected && !state.loading && (
            <Alert>
              <CircleAlert />
              <AlertTitle>Manual mode: works without API keys</AlertTitle>
              <AlertDescription>
                <p>
                  Reddit no longer gives out API keys without approval, so Socialbrewery drafts the post and opens Reddit’s submit page pre-filled. You click
                  Post. Comments and stats need approved keys.
                </p>
                <Button asChild size="sm" variant="secondary" className="mt-2">
                  <Link to="/connectors/reddit/compose">Compose a Reddit post</Link>
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {network.id === 'slack' ? (
            <div className="space-y-3">
              {state.connectors?.slack.account?.url && <CopyField label="Workspace" value={state.connectors.slack.account.url} />}
              {state.connectors?.slack.defaultChannel && <CopyField label="Default channel" value={state.connectors.slack.defaultChannel} />}
              <CopyField label="App manifest (paste into Create New App → From a manifest)" value={state.connectors?.slack.manifest || ''} />
              <div className="flex items-center gap-3 rounded-xl border bg-muted/60 p-2 pr-3">
                <img src="/socialbrewery-icon.png" alt="" className="size-12 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">App icon</p>
                  <p className="text-xs text-muted-foreground">1024 × 1024 PNG. Upload it under Basic Information → Display Information.</p>
                </div>
                <Button asChild size="sm" variant="secondary">
                  <a href="/socialbrewery-icon.png" download="socialbrewery-icon.png">
                    <Download /> Download
                  </a>
                </Button>
              </div>
            </div>
          ) : network.id === 'reddit' && !state.connected ? (
            <div className="space-y-3">
              <CopyField
                label="Request text for Reddit's API access form"
                value={`Personal, self-hosted posting tool for my own account (u/<your username>). I write each post myself and submit it to one subreddit I choose, after reading that subreddit's rules. No scraping, no data resale, no AI training, no cross-posting or bulk posting, no voting or DMs. Expected volume: a few posts and comments per week. Scopes: identity, submit, read, mysubreddits, flair. Redirect URI: ${info?.redirectUri || ''}`}
              />
              <CopyField label="Redirect URI (only if you get approved keys)" value={info?.redirectUri || ''} />
            </div>
          ) : network.id === 'hashnode' ? (
            state.connectors?.hashnode.account?.publication?.url && (
              <CopyField label="Blog" value={state.connectors.hashnode.account.publication.url} />
            )
          ) : (
            <CopyField label="Redirect URI" value={info?.redirectUri || ''} />
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Setup steps</CardTitle>
          <CardDescription>
            <a href={setup.docs.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
              {setup.docs.label} <ExternalLink className="size-3" />
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {setup.steps.map((step, index) => (
              <li key={index} className="flex gap-3 text-sm">
                <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold', SLOT_CLASSES[network.slot].chip)}>
                  {index + 1}
                </span>
                <span className="text-muted-foreground">{step}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      {network.id === 'instagram' && <InstagramWebhooks />}
    </div>
  )
}

const WEBHOOK_FIELD_LABELS: Record<string, string> = {
  comments: 'Comment',
  live_comments: 'Live comment',
  messages: 'Message',
  message_reactions: 'Reaction',
  messaging_seen: 'Seen',
}

function InstagramWebhooks() {
  const { connectors, canManage } = useAppState()
  const info = connectors?.instagram
  const webhook = info?.webhook
  const [events, setEvents] = useState<InstagramEvent[] | null>(null)
  const [enabling, setEnabling] = useState(false)

  const load = useCallback(() => {
    api<{ events: InstagramEvent[] }>('/api/instagram/events')
      .then((data) => setEvents(data.events))
      .catch(() => setEvents([]))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function enable() {
    setEnabling(true)
    try {
      const data = await postJson<{ fields: string[] }>('/api/instagram/webhooks/subscribe', { fields: ['comments', 'messages'] })
      toast.success(`Instagram will notify this organisation about ${data.fields.join(' and ')}.`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setEnabling(false)
    }
  }

  return (
    <Card className="lg:col-span-5">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Webhooks</CardTitle>
            <CardDescription>Optional. Posting Reels does not need them. They deliver new comments and messages here as they happen.</CardDescription>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={load}>
            <RefreshCw /> Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        {canManage && webhook ? (
          <div className="space-y-3">
            {webhook.url ? (
              <CopyField label="Callback URL" value={webhook.url} />
            ) : (
              <Alert>
                <CircleAlert />
                <AlertTitle>Meta needs an https callback URL</AlertTitle>
                <AlertDescription>
                  Set the Grok connector public URL in Settings to your tunnel (for example cloudflared), or serve the app on https. The callback URL appears here then.
                </AlertDescription>
              </Alert>
            )}
            <CopyField label="Verify token" value={webhook.verifyToken} secret />
            <ol className="space-y-2 text-sm text-muted-foreground">
              <li>1. Meta App Dashboard → Instagram → API setup with Instagram login → Configure webhooks. Paste the callback URL and verify token, then Verify and save.</li>
              <li>2. Subscribe the app to the comments and messages fields there.</li>
              <li>3. Reconnect Instagram above so it grants comment and message access, then click Enable notifications.</li>
              <li>4. Meta only sends webhooks once the app is Live with Advanced Access, and the account must be public for comment notifications.</li>
            </ol>
            <Button type="button" onClick={enable} disabled={enabling || !info?.connected}>
              {enabling ? <Loader2 className="animate-spin" /> : <Send />} Enable notifications
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">An owner or admin sets up webhooks. New comments and messages show up here once they do.</p>
        )}
        <div className="space-y-2">
          <p className="text-sm font-medium">Recent notifications</p>
          {!events ? (
            <Skeleton className="h-24 rounded-xl" />
          ) : !events.length ? (
            <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nothing yet. Use Test in the Meta dashboard, or comment on one of your posts.</p>
          ) : (
            <ul className="max-h-80 divide-y overflow-y-auto rounded-xl border">
              {events.map((event) => (
                <li key={event.id} className="space-y-0.5 px-3 py-2 text-sm">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">{WEBHOOK_FIELD_LABELS[event.field] || event.field}</Badge>
                    {event.from && <span className="truncate">{event.echo ? 'You' : event.from}</span>}
                    <span className="ml-auto shrink-0">{timeAgo(event.receivedAt)}</span>
                  </div>
                  {event.text && <p className="break-words">{event.text}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function NetworkPage() {
  const { network: id, tab } = useParams()
  const navigate = useNavigate()
  const network = networkById[id as NetworkId]
  if (!network) return <Navigate to="/connectors" replace />
  const active: Tab = TABS.includes(tab as Tab) ? (tab as Tab) : 'overview'

  return (
    <div>
      <AccountHeader network={network} />
      <Tabs value={active} onValueChange={(value) => navigate(`/connectors/${network.id}/${value}`)}>
        <TabsList className="mb-4 w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="posts">Posts</TabsTrigger>
          <TabsTrigger value="compose">Compose</TabsTrigger>
          <TabsTrigger value="analysis">Analysis</TabsTrigger>
          <TabsTrigger value="connection">Connection</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <NetworkOverview network={network} />
        </TabsContent>
        <TabsContent value="posts">
          <NetworkPosts network={network} />
        </TabsContent>
        <TabsContent value="compose">
          <NetworkCompose network={network} />
        </TabsContent>
        <TabsContent value="analysis">
          <NetworkAnalysis network={network} />
        </TabsContent>
        <TabsContent value="connection">
          <NetworkConnection network={network} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
