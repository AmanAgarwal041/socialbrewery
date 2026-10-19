import type { ComponentType, ReactNode, SVGProps } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Building2,
  Clapperboard,
  Cloud,
  KeyRound,
  LineChart,
  Lock,
  PenLine,
  Plug,
  Puzzle,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react'
import { BrewIcon } from '@/components/brand-icons'
import { Button } from '@/components/ui/button'
import { NETWORKS, SLOT_CLASSES, type Slot } from '@/lib/networks'
import { cn } from '@/lib/utils'

// Signed-out visitors land here. "Open the app" opens the same dashboard in exploring mode, with no
// sign-in; signing in is only needed to save keys, connect networks, and post.
const EXPLORE = '/overview'
const REPO = 'https://github.com/AmanAgarwal041/socialbrewery'

const MCP_TOOL_SAMPLE = [
  'generate_and_post_youtube_short',
  'post_linkedin',
  'post_instagram_reel',
  'post_x',
  'reply_x',
  'publish_hashnode_article',
  'post_slack',
  'reddit_subreddit_rules',
  'analyze_youtube_video',
  'update_youtube_video',
]

function Shot({ src, alt, className, priority }: { src: string; alt: string; className?: string; priority?: boolean }) {
  return (
    <div className={cn('overflow-hidden rounded-2xl border border-border/80 bg-card shadow-[0_24px_60px_-28px_color-mix(in_oklab,var(--p1)_60%,transparent)]', className)}>
      <img
        src={src}
        alt={alt}
        width={1600}
        height={1000}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        className="block h-auto w-full"
      />
    </div>
  )
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold tracking-[0.14em] text-p1-ink uppercase">{children}</p>
}

function SectionTitle({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="max-w-2xl">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
      {children && <p className="mt-3 text-base leading-relaxed text-muted-foreground text-pretty sm:text-lg">{children}</p>}
    </div>
  )
}

function Bullet({ icon: Icon, slot, title, children }: { icon: ComponentType<SVGProps<SVGSVGElement>>; slot: Slot; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg', SLOT_CLASSES[slot].chip)}>
        <Icon className="size-4" />
      </span>
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </li>
  )
}

function FeatureRow({
  eyebrow,
  title,
  body,
  bullets,
  shot,
  alt,
  flip,
}: {
  eyebrow: string
  title: string
  body: string
  bullets: ReactNode
  shot: string
  alt: string
  flip?: boolean
}) {
  return (
    <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
      <div className={cn(flip && 'lg:order-2')}>
        <SectionTitle eyebrow={eyebrow} title={title}>
          {body}
        </SectionTitle>
        <ul className="mt-6 space-y-4">{bullets}</ul>
      </div>
      <Shot src={shot} alt={alt} className={cn(flip && 'lg:order-1')} />
    </div>
  )
}

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
      <span className="bg-palette flex size-8 items-center justify-center rounded-xl text-ink shadow-sm">
        <BrewIcon className="size-5" />
      </span>
      Socialbrewery
    </Link>
  )
}

export function LandingPage() {
  return (
    <div className="bg-brew min-h-svh overflow-x-clip text-foreground">
      <header className="sticky top-0 z-20 border-b border-border/50 bg-background/75 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 md:px-8">
          <Logo />
          <nav className="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
            <a href="#brew" className="hover:text-foreground">Brew</a>
            <a href="#networks" className="hover:text-foreground">Networks</a>
            <a href="#agents" className="hover:text-foreground">For agents</a>
            <a href="#extension" className="hover:text-foreground">Extension</a>
            <a href="#security" className="hover:text-foreground">Security</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button asChild variant="ghost" size="lg" className="hidden px-3 sm:inline-flex">
              <Link to="/login">Sign in</Link>
            </Button>
            <Button asChild size="lg" className="px-3.5">
              <Link to={EXPLORE}>Open app</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 pt-14 pb-10 text-center md:px-8 md:pt-24">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1 text-xs font-medium text-p1-ink">
            <Sparkles className="size-3.5" /> A posting studio for Grok and Claude
          </span>
          <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl md:text-6xl">
            Tell Grok what to make.{' '}
            <span className="bg-gradient-to-r from-p1-ink via-p1 to-p3-ink bg-clip-text text-transparent">It writes, films, and posts.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground text-pretty sm:text-lg">
            Socialbrewery writes the caption, generates a vertical 9:16 clip, and posts it to YouTube Shorts, LinkedIn,
            Instagram Reels, X, Hashnode, Slack, and Reddit, for your whole team, from one dashboard.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-11 w-full px-5 text-base sm:w-auto">
              <Link to={EXPLORE}>
                Open the app <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="h-11 w-full bg-card/70 px-5 text-base sm:w-auto">
              <Link to="/extension">
                <Puzzle data-icon="inline-start" /> Get the Chrome extension
              </Link>
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            No sign-in needed to explore.{' '}
            <Link to="/login" className="font-medium text-foreground underline underline-offset-2">
              Sign in
            </Link>{' '}
            when you want to save your work and post.
          </p>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20 md:px-8">
          <div className="relative">
            <div className="bg-palette absolute -inset-x-6 -inset-y-6 -z-10 rounded-[2.5rem] opacity-40 blur-3xl" aria-hidden />
            <Shot src="/landing/overview.jpg" alt="The Socialbrewery overview: a Brew with Grok prompt, post counts, and every network." priority />
          </div>
        </section>

        {/* Brew with Grok */}
        <section id="brew" className="scroll-mt-20 border-y border-border/50 bg-card/50 py-20">
          <div className="mx-auto max-w-6xl px-4 md:px-8">
            <FeatureRow
              eyebrow="Brew with Grok"
              title="One sentence in, a finished post out"
              body="Brew is a chat with an agent that can act. Ask for a Short, a LinkedIn post, an X thread, or a review of your channel, and watch each step as it happens."
              shot="/landing/brew.jpg"
              alt="The Brew chat with ready-made prompts for every network and a target picker."
              bullets={
                <>
                  <Bullet icon={PenLine} slot="p1" title="Writes the copy">
                    Captions, titles, threads, articles, and announcements, shaped for each network's limits.
                  </Bullet>
                  <Bullet icon={Clapperboard} slot="p3" title="Generates the clip">
                    Vertical 9:16 video with Grok, or attach your own mp4, mov, or webm.
                  </Bullet>
                  <Bullet icon={Send} slot="p4" title="Posts it">
                    Uploads to the accounts you connected, with every step shown live. Stop a run at any time.
                  </Bullet>
                </>
              }
            />
          </div>
        </section>

        {/* Networks */}
        <section id="networks" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 md:px-8">
          <SectionTitle eyebrow="Seven networks" title="Everywhere your audience is">
            Each network has its own Overview, Posts, Compose, Analysis, and Connection tabs, so you can also post by hand.
          </SectionTitle>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {NETWORKS.map((network) => (
              <div key={network.id} className="rounded-2xl border border-border/80 bg-card p-5">
                <span className={cn('flex size-10 items-center justify-center rounded-xl', SLOT_CLASSES[network.slot].chip)}>
                  <network.icon className="size-5" />
                </span>
                <p className="mt-4 font-semibold">{network.id === 'youtube' ? 'YouTube Shorts' : network.id === 'instagram' ? 'Instagram Reels' : network.name}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {network.id === 'reddit' ? 'Drafts posts and opens Reddit’s own submit page, with no API keys needed.' : network.blurb}
                </p>
              </div>
            ))}
            <div className="bg-palette flex flex-col justify-between rounded-2xl p-5 text-ink">
              <Bot className="size-6" />
              <div>
                <p className="mt-4 font-semibold">Plus your agent</p>
                <p className="mt-1 text-sm leading-relaxed text-ink/75">Grok, Claude, or any MCP client can post through Socialbrewery.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Feature rows */}
        <section className="border-y border-border/50 bg-card/50 py-20">
          <div className="mx-auto max-w-6xl space-y-24 px-4 md:px-8">
            <FeatureRow
              eyebrow="Compose"
              title="Post by hand when you want to"
              body="Every connector has a Compose tab with the network's own fields, and a “Let Grok write it” button when you want a first draft."
              shot="/landing/compose.jpg"
              alt="The YouTube Compose tab with title, description, tags, privacy, and a video drop zone."
              flip
              bullets={
                <>
                  <Bullet icon={PenLine} slot="p2" title="The fields each network needs">
                    Shorts privacy and tags, LinkedIn link previews, X replies, Hashnode drafts, Slack threads.
                  </Bullet>
                  <Bullet icon={Sparkles} slot="p1" title="Grok on hand">
                    Draft with one click, then edit before it goes out.
                  </Bullet>
                </>
              }
            />
            <FeatureRow
              eyebrow="Reviews"
              title="Learn what worked"
              body="YouTube Analysis shows channel stats and asks AI to review each video: what landed, what didn't, and what to change next."
              shot="/landing/settings.jpg"
              alt="Settings with palette choices and AI model options, including Grok or OpenAI for reviews."
              bullets={
                <>
                  <Bullet icon={LineChart} slot="p3" title="Grok or OpenAI">
                    Pick the analysis provider per organisation. Posting always uses Grok.
                  </Bullet>
                  <Bullet icon={Sparkles} slot="p4" title="Network stats">
                    Hashnode views and reactions, Slack reactions, Reddit score and upvote ratio.
                  </Bullet>
                </>
              }
            />
            <FeatureRow
              eyebrow="Connect"
              title="Setup steps on every connector"
              body="Each Connection tab lists the exact steps for that network and the redirect URI to paste, so getting keys takes minutes."
              shot="/landing/connection.jpg"
              alt="The YouTube Connection tab with numbered setup steps and the redirect URI."
              flip
              bullets={
                <>
                  <Bullet icon={KeyRound} slot="p1" title="Your own apps">
                    You bring the network credentials; nothing posts through a shared account.
                  </Bullet>
                  <Bullet icon={Plug} slot="p2" title="Connect and go">
                    OAuth for YouTube, LinkedIn, Instagram, X, and Reddit; tokens for Slack and Hashnode.
                  </Bullet>
                </>
              }
            />
          </div>
        </section>

        {/* MCP */}
        <section id="agents" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 md:px-8">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <SectionTitle eyebrow="For agents" title="An MCP connector your agent can post through">
                Socialbrewery is a custom MCP server. Paste your organisation's connector URL into grok.com, claude.ai, Claude
                Desktop, Claude Code, or any MCP client, then ask it to post, reply, edit, or review.
              </SectionTitle>
              <div className="mt-6 overflow-hidden rounded-2xl border border-border/80 bg-ink text-sm text-white/90">
                <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
                  <span className="size-2.5 rounded-full bg-p1" />
                  <span className="size-2.5 rounded-full bg-p3" />
                  <span className="size-2.5 rounded-full bg-p4" />
                  <span className="ml-2 text-xs text-white/50">MCP · POST /mcp</span>
                </div>
                <div className="flex flex-wrap gap-1.5 p-4 font-mono text-xs">
                  {MCP_TOOL_SAMPLE.map((tool) => (
                    <span key={tool} className="rounded-md bg-white/10 px-2 py-1">
                      {tool}
                    </span>
                  ))}
                  <span className="rounded-md px-2 py-1 text-white/50">and more</span>
                </div>
              </div>
              <ul className="mt-6 space-y-4">
                <Bullet icon={Bot} slot="p2" title="Grok and Claude, the same way">
                  One connector, with setup steps for each. Posts are labelled with the assistant that made them.
                </Bullet>
                <Bullet icon={Lock} slot="p4" title="One token per organisation">
                  The token picks whose keys and accounts are used. Only admins see it, and Rotate replaces it at once.
                </Bullet>
              </ul>
            </div>
            <Shot src="/landing/mcp-connector.jpg" alt="The Grok connector page with setup steps and the list of MCP tools." />
          </div>
        </section>

        {/* Chrome extension */}
        <section id="extension" className="scroll-mt-20 border-t border-border/50 bg-card/50 py-20">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 md:px-8 lg:grid-cols-2">
            <div>
              <SectionTitle eyebrow="Chrome extension" title="Post from your own browser, no connections needed">
                Claude or Grok writes the post, then fills it in on YouTube, LinkedIn, Instagram, X, Reddit, Slack, or Hashnode in
                the tabs you’re already signed in to.
              </SectionTitle>
              <ul className="mt-6 space-y-4">
                <Bullet icon={KeyRound} slot="p1" title="No account needed">
                  Runs on your own Anthropic or xAI key, kept in your browser. Sign in only to save your runs.
                </Bullet>
                <Bullet icon={ShieldCheck} slot="p4" title="You approve every post">
                  It fills everything in, then waits with a screenshot before it clicks Post, Share, Publish, or Send.
                </Bullet>
              </ul>
              <Button asChild size="lg" className="mt-7 h-11 px-5 text-base">
                <Link to="/extension">
                  <Puzzle data-icon="inline-start" /> Get the extension
                </Link>
              </Button>
            </div>
            <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-[0_24px_60px_-28px_color-mix(in_oklab,var(--p1)_60%,transparent)]" aria-hidden>
              <div className="flex items-center gap-2 border-b border-border/60 pb-3 text-sm font-semibold">
                <span className="bg-palette flex size-7 items-center justify-center rounded-lg text-ink">
                  <BrewIcon className="size-4" />
                </span>
                Socialbrewery
                <span className="ml-auto rounded-md bg-p1 px-2 py-0.5 text-xs text-ink">Claude</span>
                <span className="rounded-md px-2 py-0.5 text-xs text-muted-foreground">Grok</span>
              </div>
              <div className="space-y-2.5 pt-4 text-sm">
                <p className="ml-10 rounded-xl bg-p1-soft px-3 py-2">Write a LinkedIn post about our launch and post it.</p>
                <p className="mr-6 rounded-xl border border-border px-3 py-2">Here’s the draft. Filling it in on LinkedIn now.</p>
                <p className="text-xs text-muted-foreground">• Open https://www.linkedin.com/feed/</p>
                <p className="text-xs text-muted-foreground">• Click “Start a post” · Type the draft</p>
                <div className="rounded-xl border-2 border-p1 p-3">
                  <p className="flex items-center gap-1.5 font-medium">
                    <ShieldCheck className="size-4" /> Ready to publish on linkedin.com
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">The agent wants to click “Post”.</p>
                  <div className="mt-2.5 flex gap-2">
                    <span className="flex-1 rounded-lg bg-p1 py-1.5 text-center text-xs font-medium text-ink">Approve</span>
                    <span className="flex-1 rounded-lg border border-border py-1.5 text-center text-xs font-medium">Don’t publish</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Security */}
        <section id="security" className="scroll-mt-20 border-y border-border/50 bg-card/50 py-20">
          <div className="mx-auto max-w-6xl px-4 md:px-8">
            <SectionTitle eyebrow="Teams and security" title="Built for a team, safe with your keys" />
            <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: Building2, slot: 'p1' as Slot, title: 'Organisations', body: 'Keys, accounts, posts, and history belong to an organisation. Teams never see each other’s.' },
                { icon: Users, slot: 'p2' as Slot, title: 'Roles via Clerk', body: 'Admins manage keys, connections, and invites. Members post, brew, and review.' },
                { icon: ShieldCheck, slot: 'p3' as Slot, title: 'Encrypted credentials', body: 'AES-256-GCM, bound to each organisation. Saved secrets are never sent back to the browser.' },
                { icon: Cloud, slot: 'p4' as Slot, title: 'Runs where you like', body: 'On Cloudflare Workers with D1 on the Free plan, or locally on Node.js 20 with zero dependencies.' },
              ].map((item) => (
                <div key={item.title} className="rounded-2xl border border-border/80 bg-card p-5">
                  <span className={cn('flex size-10 items-center justify-center rounded-xl', SLOT_CLASSES[item.slot].chip)}>
                    <item.icon className="size-5" />
                  </span>
                  <p className="mt-4 font-semibold">{item.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Product family */}
        <section className="mx-auto max-w-6xl px-4 py-20 md:px-8">
          <SectionTitle eyebrow="Product family" title="Part of a product family">
            Socialbrewery spreads the word. Its siblings get you ready to launch and help you get found.
          </SectionTitle>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {[
              { name: 'MetaInfo', href: 'https://metainfo.agarwal-aman041.workers.dev', body: 'SEO and AI-search visibility audits for your site.', slot: 'p3' as Slot },
              { name: 'ProductRoot', href: 'https://productroot.agarwal-aman041.workers.dev', body: 'A launch readiness planner for your product.', slot: 'p4' as Slot },
            ].map((product) => (
              <a
                key={product.name}
                href={product.href}
                target="_blank"
                rel="noreferrer"
                className="group flex items-start justify-between gap-4 rounded-2xl border border-border/80 bg-card p-6 transition-colors hover:border-p1"
              >
                <div>
                  <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', SLOT_CLASSES[product.slot].chip)}>{product.name}</span>
                  <p className="mt-3 text-lg font-semibold">{product.body}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{product.href.replace('https://', '')}</p>
                </div>
                <ArrowUpRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </a>
            ))}
          </div>
        </section>

        {/* Closing CTA */}
        <section className="mx-auto max-w-6xl px-4 pb-20 md:px-8">
          <div className="bg-palette rounded-3xl px-6 py-12 text-center text-ink sm:px-12">
            <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">Start brewing</h2>
            <p className="mx-auto mt-3 max-w-xl text-ink/75">
              Open the app and look around first. When you’re ready, sign in, add your xAI key, and connect a network.
            </p>
            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-11 w-full bg-ink px-5 text-base text-white hover:bg-ink/85 sm:w-auto">
                <Link to={EXPLORE}>
                  Open the app <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="h-11 w-full border-ink/20 bg-white/60 px-5 text-base sm:w-auto">
                <Link to="/login">Sign in</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center md:px-8">
          <Logo />
          <nav className="flex flex-wrap gap-x-5 gap-y-2 sm:ml-auto">
            <Link to={EXPLORE} className="hover:text-foreground">Open app</Link>
            <Link to="/extension" className="hover:text-foreground">Chrome extension</Link>
            <Link to="/login" className="hover:text-foreground">Sign in</Link>
            <a href={REPO} target="_blank" rel="noreferrer" className="hover:text-foreground">GitHub</a>
            <a href="https://metainfo.agarwal-aman041.workers.dev" target="_blank" rel="noreferrer" className="hover:text-foreground">MetaInfo</a>
            <a href="https://productroot.agarwal-aman041.workers.dev" target="_blank" rel="noreferrer" className="hover:text-foreground">ProductRoot</a>
          </nav>
        </div>
      </footer>
    </div>
  )
}
