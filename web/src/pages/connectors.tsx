import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ExternalLink, Globe, Loader2, Lock, Plug, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { CopyField, PageHeader, StatusBadge } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
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
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { safeImage, sendJson, type Connectors } from '@/lib/api'
import { useAppState } from '@/lib/app-state'
import { NETWORKS, SLOT_CLASSES, networkState } from '@/lib/networks'
import { cn } from '@/lib/utils'

const MCP_TOOLS = [
  'post_youtube_short',
  'generate_and_post_youtube_short',
  'list_youtube_videos',
  'analyze_youtube_video',
  'update_youtube_video',
  'post_linkedin',
  'comment_linkedin',
  'generate_and_post_linkedin',
  'post_instagram_reel',
  'generate_and_post_instagram_reel',
  'post_x',
  'reply_x',
  'delete_x_post',
  'generate_and_post_x',
  'publish_hashnode_article',
  'update_hashnode_article',
  'list_hashnode_articles',
  'post_slack',
  'reply_slack',
  'list_slack_channels',
  'reddit_subreddit_rules',
  'post_reddit',
  'comment_reddit',
  'list_reddit_subreddits',
  'delete_reddit_post',
]

export function ConnectorsPage() {
  const { health, connectors } = useAppState()
  return (
    <div>
      <PageHeader eyebrow="Connectors" title="Connectors" description="Link the networks Socialbrewery posts to, and expose it to Grok on grok.com." icon={Plug} iconClass="bg-palette text-ink" />
      <div className="grid gap-4 md:grid-cols-2">
        {NETWORKS.map((network) => {
          const state = networkState(network.id, health, connectors)
          const picture = safeImage(state.picture)
          return (
            <Card key={network.id}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <span className={cn('flex size-10 items-center justify-center rounded-2xl', SLOT_CLASSES[network.slot].chip)}>
                    <network.icon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <CardTitle>{network.name}</CardTitle>
                    <CardDescription>{network.blurb}</CardDescription>
                  </div>
                  <StatusBadge on={state.connected} loading={state.loading} offLabel={state.ready ? 'Ready' : 'Needs keys'} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-sm">
                  {picture && <img src={picture} alt="" className="size-5 rounded-full" referrerPolicy="no-referrer" />}
                  <span className="truncate text-muted-foreground">
                    {state.connected ? state.accountName || 'Connected account' : 'No account linked'}
                  </span>
                </div>
              </CardContent>
              <CardFooter className="gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link to={`/connectors/${network.id}/connection`}>Manage</Link>
                </Button>
                <Button asChild size="sm" variant="ghost" className="ml-auto">
                  <Link to={`/connectors/${network.id}`}>
                    Open <ArrowRight />
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          )
        })}
        <Card className="border-p4 bg-p4-soft/40">
          <CardHeader>
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-2xl bg-p4-soft text-p4-ink">
                <Plug className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <CardTitle>Grok connector</CardTitle>
                <CardDescription>Let Grok on grok.com post through Socialbrewery.</CardDescription>
              </div>
              <StatusBadge on={Boolean(connectors && !connectors.grok.localOnly)} loading={!connectors} onLabel="Public" offLabel="Local only" />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{MCP_TOOLS.length} tools for posting, editing, and reviewing.</p>
          </CardContent>
          <CardFooter>
            <Button asChild size="sm" variant="ghost" className="ml-auto">
              <Link to="/connectors/grok">
                Open <ArrowRight />
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}

export function GrokConnectorPage() {
  const { connectors, canManage, org, refresh } = useAppState()
  const grok = connectors?.grok
  const [rotating, setRotating] = useState(false)

  async function rotate() {
    setRotating(true)
    try {
      await sendJson<{ grok: Connectors['grok'] }>('/api/org/connector/rotate', 'POST')
      await refresh()
      toast.success('New connector URL created. Update it in grok.com; the old one stopped working.')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setRotating(false)
    }
  }
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Connector"
        title="Grok connector"
        description="A custom MCP connector so you can ask Grok on grok.com to post, edit, and review for you."
        icon={Plug}
        iconClass="bg-p4-soft text-p4-ink"
        actions={
          <Button asChild variant="outline">
            <a href={grok?.connectorsPage || 'https://grok.com/connectors'} target="_blank" rel="noreferrer">
              grok.com/connectors <ExternalLink />
            </a>
          </Button>
        }
      />
      {grok?.localOnly && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>This URL is still local</AlertTitle>
          <AlertDescription>
            grok.com cannot reach localhost. Run a tunnel (for example cloudflared), then paste its https origin as the Grok connector public URL in{' '}
            <Link to="/settings" className="font-medium underline">
              Settings
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Connect it in Grok</CardTitle>
            <CardDescription>
              The URL carries {org?.name ? `${org.name}'s` : 'your organisation’s'} connector token: anything Grok posts through it uses this organisation's
              keys and accounts. Treat it like a password.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {canManage ? (
              <div className="space-y-2">
                <CopyField label="Connector URL" value={grok?.mcpUrl || ''} secret />
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="outline" size="sm" disabled={rotating}>
                      {rotating ? <Loader2 className="animate-spin" /> : <RefreshCw />} Rotate token
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Rotate the connector token?</AlertDialogTitle>
                      <AlertDialogDescription>
                        The current URL stops working right away. Paste the new URL into grok.com afterwards.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={rotate}>Rotate</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ) : (
              <Alert>
                <Lock />
                <AlertTitle>Ask an owner or admin for the URL</AlertTitle>
                <AlertDescription>The connector URL works like a password for the whole organisation, so only owners and admins can see it.</AlertDescription>
              </Alert>
            )}
            <ol className="space-y-3 text-sm">
              {[
                'Open grok.com, then Connectors.',
                'Choose New Connector, then Custom.',
                'Paste the connector URL above and save.',
                'Ask Grok: “Post this to LinkedIn and put the links in the first comment.”',
              ].map((step, index) => (
                <li key={index} className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-p4-soft text-xs font-semibold text-p4-ink">
                    {index + 1}
                  </span>
                  <span className="text-muted-foreground">{step}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Tools Grok can use</CardTitle>
            <CardDescription>Every call needs the connector token.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {MCP_TOOLS.map((tool) => (
              <code key={tool} className="rounded-lg bg-muted px-2 py-1 font-mono text-[11px]">
                {tool}
              </code>
            ))}
          </CardContent>
          <CardFooter className="gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5" /> Token protected</span>
            <span className="inline-flex items-center gap-1.5"><Globe className="size-3.5" /> {grok?.localOnly ? 'Local only' : 'Public via tunnel'}</span>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
