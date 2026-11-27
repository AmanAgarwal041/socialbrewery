import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode, type SVGProps } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowUp,
  BarChart3,
  Clapperboard,
  ExternalLink,
  Globe,
  History,
  LineChart,
  MessageSquareText,
  Paperclip,
  Pencil,
  Plus,
  Puzzle,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  TriangleAlert,
  Users,
  Wand2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { BrewIcon, DevtoIcon, HashnodeIcon, InstagramIcon, LinkedinIcon, RedditIcon, SlackIcon, XIcon, YoutubeIcon } from '@/components/brand-icons'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api, authedFetch, mediaSrc, readSse, safeLink, timeAgo, uploadMedia, type ChatItem, type Conversation, type ConversationSummary, type NetworkId } from '@/lib/api'
import { useAssistant } from '@/lib/assistant'
import { AssistantTabs } from '@/components/assistant-tabs'
import { useAppState } from '@/lib/app-state'
import { NETWORKS, SLOT_CLASSES, networkById, type Slot } from '@/lib/networks'
import { cn } from '@/lib/utils'

type Icon = ComponentType<SVGProps<SVGSVGElement>>

const TOOL_META: Record<string, { icon: Icon; slot: Slot; label: string }> = {
  // Steps from Chrome extension runs, shown read-only.
  browser_action: { icon: Globe, slot: 'p2', label: 'In the browser' },
  browser_approval: { icon: ShieldCheck, slot: 'p3', label: 'Approval' },
  browser_post: { icon: ExternalLink, slot: 'p4', label: 'Posted' },
  generate_short_video: { icon: Clapperboard, slot: 'p2', label: 'Generated clip' },
  upload_youtube_short: { icon: YoutubeIcon, slot: 'p1', label: 'YouTube upload' },
  list_youtube_videos: { icon: BarChart3, slot: 'p1', label: 'Channel stats' },
  analyze_youtube_video: { icon: LineChart, slot: 'p1', label: 'Video review' },
  update_youtube_video: { icon: Pencil, slot: 'p1', label: 'Video update' },
  post_linkedin: { icon: LinkedinIcon, slot: 'p3', label: 'LinkedIn post' },
  comment_linkedin: { icon: MessageSquareText, slot: 'p3', label: 'LinkedIn comment' },
  post_instagram_reel: { icon: InstagramIcon, slot: 'p2', label: 'Instagram Reel' },
  post_x: { icon: XIcon, slot: 'p4', label: 'X post' },
  reply_x: { icon: MessageSquareText, slot: 'p4', label: 'X reply' },
  publish_hashnode_article: { icon: HashnodeIcon, slot: 'p1', label: 'Hashnode article' },
  list_hashnode_articles: { icon: BarChart3, slot: 'p1', label: 'Hashnode stats' },
  publish_devto_article: { icon: DevtoIcon, slot: 'p4', label: 'DEV article' },
  list_devto_articles: { icon: BarChart3, slot: 'p4', label: 'DEV stats' },
  post_slack: { icon: SlackIcon, slot: 'p2', label: 'Slack message' },
  reply_slack: { icon: MessageSquareText, slot: 'p2', label: 'Slack reply' },
  list_slack_channels: { icon: SlackIcon, slot: 'p2', label: 'Slack channels' },
  reddit_subreddit_rules: { icon: RedditIcon, slot: 'p3', label: 'Subreddit rules' },
  post_reddit: { icon: RedditIcon, slot: 'p3', label: 'Reddit post' },
  comment_reddit: { icon: MessageSquareText, slot: 'p3', label: 'Reddit comment' },
  get_research_skill: { icon: RedditIcon, slot: 'p3', label: 'Research skill' },
  find_subreddits: { icon: RedditIcon, slot: 'p3', label: 'Find subreddits' },
  search_reddit: { icon: RedditIcon, slot: 'p3', label: 'Reddit search' },
  get_reddit_thread: { icon: MessageSquareText, slot: 'p3', label: 'Reddit thread' },
  research_reddit_user: { icon: RedditIcon, slot: 'p3', label: 'Reddit user' },
  save_reddit_leads: { icon: RedditIcon, slot: 'p3', label: 'Saved leads' },
  list_reddit_leads: { icon: RedditIcon, slot: 'p3', label: 'Reddit leads' },
  update_reddit_lead: { icon: RedditIcon, slot: 'p3', label: 'Lead updated' },
}

const SUGGESTIONS: { network: NetworkId | 'any'; title: string; prompt: string }[] = [
  {
    network: 'youtube',
    title: 'Brew a Short',
    prompt:
      'Generate an 8 second vertical short of rain tapping a copper kettle on a wooden counter. Then post it to YouTube as an unlisted Short with a warm title and a short description.',
  },
  {
    network: 'youtube',
    title: 'Review my channel',
    prompt: 'List my latest YouTube videos, then review the best and worst performer and tell me what to change next.',
  },
  {
    network: 'linkedin',
    title: 'Write a LinkedIn post',
    prompt:
      'Write a short LinkedIn post about what I learned shipping an AI agent this week. Keep it under 120 words, end with a question, and put any links in the first comment.',
  },
  {
    network: 'instagram',
    title: 'Post a Reel',
    prompt: 'Write a punchy caption with 5 hashtags for the attached video and post it as an Instagram Reel.',
  },
  {
    network: 'x',
    title: 'Start an X thread',
    prompt:
      'Write a 3-part X thread about one lesson from shipping an AI agent. Keep each part under 280 characters, post the first, then reply with the other two in order.',
  },
  {
    network: 'hashnode',
    title: 'Draft a blog article',
    prompt:
      'Write a 900-word Hashnode article on how to observe and debug an AI agent in production, with an intro, headed sections, a code example, and a conclusion. Add 4 tags and save it as a draft.',
  },
  {
    network: 'devto',
    title: 'Draft a DEV article',
    prompt:
      'Write a 900-word DEV article for developers on how to trace and debug an AI agent in production, with headed sections starting at H2, a code example, and a conclusion. Add a one-sentence description and 4 tags, and save it as a draft.',
  },
  {
    network: 'slack',
    title: 'Announce in Slack',
    prompt:
      'Write a short, friendly Slack announcement for my team about what I shipped this week, with 3 bullet points and a link placeholder, and post it to the default channel.',
  },
  {
    network: 'reddit',
    title: 'Share on Reddit',
    prompt:
      'Read the rules of r/selfhosted first. If self-promotion is allowed, write a genuine text post (not an ad) about the tool I built, with a plain title, and show me the draft before posting. Tool: ',
  },
  {
    network: 'reddit',
    title: 'Find Reddit leads',
    prompt:
      'Find people on Reddit from the past month who are asking for or comparing tools like mine. Suggest a few subreddits first, then search, qualify each person, and save the best as leads. Never message anyone. My product: ',
  },
  {
    network: 'any',
    title: 'Cross-post everywhere',
    prompt:
      'Take this idea and adapt it for each connected network: a LinkedIn post, an X post under 280 characters, and a Slack announcement. Show me all three drafts before posting anything. Idea: ',
  },
]

const TARGET_PREFIX = /^\[(YouTube|LinkedIn|Instagram|X|Hashnode|DEV|Slack|Reddit)\]\s*/

function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g)
  return (
    <>
      {parts.map((part, index) =>
        /^https?:\/\//.test(part) ? (
          <a key={index} href={part} target="_blank" rel="noreferrer" className="font-medium underline decoration-p1 underline-offset-2 hover:decoration-2">
            {part}
          </a>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  )
}

function Avatar() {
  return (
    <div className="bg-palette flex size-8 shrink-0 items-center justify-center rounded-xl text-ink shadow-sm">
      <BrewIcon className="size-4.5" />
    </div>
  )
}

function VideoPreview({ id, className }: { id?: string; className?: string }) {
  const src = mediaSrc(id)
  if (!src) return null
  return (
    <video
      className={cn('mt-2 aspect-[9/16] max-h-80 w-auto rounded-xl border bg-black/5 object-cover', className)}
      controls
      preload="metadata"
      src={src}
    />
  )
}

function UserBubble({ item }: { item: ChatItem }) {
  const match = item.content.match(TARGET_PREFIX)
  const target = match ? NETWORKS.find((n) => n.name === match[1]) : undefined
  const text = match ? item.content.slice(match[0].length) : item.content
  return (
    <div className="flex justify-end">
      <div className="flex max-w-[85%] flex-col items-end">
        <div className="rounded-2xl rounded-br-md bg-p1-soft px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-ink shadow-xs">
          {target && (
            <span className={cn('mb-1.5 mr-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', SLOT_CLASSES[target.slot].chip)}>
              <target.icon className="size-3" />
              {target.name}
            </span>
          )}
          {text}
          {item.mediaName && !mediaSrc(item.mediaId) && (
            <span className="mt-1 block text-xs text-muted-foreground">Attached {item.mediaName}</span>
          )}
        </div>
        <VideoPreview id={item.mediaId} />
        {item.at && <span className="mt-1 text-[11px] text-muted-foreground">{timeAgo(item.at)}</span>}
      </div>
    </div>
  )
}

function AssistantBubble({ item }: { item: ChatItem }) {
  return (
    <div className="flex gap-3">
      <Avatar />
      <div className="max-w-[85%] min-w-0">
        <div className="rounded-2xl rounded-tl-md border bg-card px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap shadow-xs">
          <Linkified text={item.content} />
        </div>
        {item.at && <span className="mt-1 block text-[11px] text-muted-foreground">{timeAgo(item.at)}</span>}
      </div>
    </div>
  )
}

function ToolCard({ item }: { item: ChatItem }) {
  const meta = TOOL_META[item.tool || ''] || { icon: Wand2, slot: 'p2' as Slot, label: 'Step' }
  const link = safeLink(item.url)
  return (
    <div className="flex gap-3 pl-11">
      <div
        className={cn(
          'w-full max-w-[85%] rounded-2xl border px-3 py-2.5 text-sm shadow-xs',
          item.error ? 'border-destructive/30 bg-destructive/5' : 'bg-card/80',
        )}
      >
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-lg',
              item.error ? 'bg-destructive/10 text-destructive' : SLOT_CLASSES[meta.slot].chip,
            )}
          >
            {item.error ? <TriangleAlert className="size-3.5" /> : <meta.icon className="size-3.5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground">{meta.label}</p>
            <p className={cn('text-sm whitespace-pre-wrap', item.error && 'text-destructive')}>
              <Linkified text={item.content} />
            </p>
          </div>
          {link && (
            <Button asChild size="sm" variant="secondary" className="shrink-0">
              <a href={link} target="_blank" rel="noreferrer">
                Open <ExternalLink />
              </a>
            </Button>
          )}
        </div>
        {!item.error && <VideoPreview id={item.mediaId} className="ml-9" />}
      </div>
    </div>
  )
}

function Thinking({ status, agent }: { status: string; agent: string }) {
  return (
    <div className="flex gap-3">
      <Avatar />
      <div className="flex items-center gap-3 rounded-2xl rounded-tl-md border bg-card px-4 py-3 text-sm shadow-xs">
        <span className="flex gap-1" aria-hidden>
          <span className="typing-dot size-1.5 rounded-full bg-p1-ink" />
          <span className="typing-dot size-1.5 rounded-full bg-p3-ink" />
          <span className="typing-dot size-1.5 rounded-full bg-p2-ink" />
        </span>
        <span className="text-muted-foreground">{status || `${agent} is thinking…`}</span>
      </div>
    </div>
  )
}

function EmptyChat({ onPick, agent, keyName, ready }: { onPick: (prompt: string, target: NetworkId | 'any') => void; agent: string; keyName: string; ready: boolean }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-10 text-center">
      <div className="bg-palette mb-5 flex size-16 items-center justify-center rounded-3xl text-ink shadow-md">
        <BrewIcon className="size-8" />
      </div>
      <h1 className="text-3xl font-semibold tracking-tight">What should we brew today?</h1>
      <p className="mt-2 max-w-lg text-sm text-muted-foreground">
        Ask {agent} to write the copy, generate a vertical clip, and post it to YouTube, LinkedIn, Instagram, X, Hashnode, DEV, Slack, or Reddit.
        Attach a video to post your own.{agent !== 'Grok' && ` ${agent} can make clips too: they are generated with Grok Imagine, so that needs your xAI key.`}
      </p>
      {!ready && (
        <p className="mt-4 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Add your {keyName} API key in Settings before chatting.
        </p>
      )}
      <div className="mt-8 grid w-full gap-3 sm:grid-cols-2 sm:[&>*:last-child:nth-child(odd)]:col-span-2">
        {SUGGESTIONS.map((s) => {
          const network = s.network === 'any' ? undefined : networkById[s.network]
          const Icon = network?.icon || Sparkles
          return (
            <button
              key={s.title}
              type="button"
              onClick={() => onPick(s.prompt, s.network)}
              className="group rounded-2xl border bg-card/80 p-4 text-left shadow-xs transition hover:-translate-y-0.5 hover:border-p1 hover:shadow-md"
            >
              <div className="flex items-center gap-2">
                <span className={cn('flex size-7 items-center justify-center rounded-lg', SLOT_CLASSES[network?.slot || 'p4'].chip)}>
                  <Icon className="size-3.5" />
                </span>
                <span className="text-sm font-medium">{s.title}</span>
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{s.prompt}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function TargetPicker({ value, onChange, agent }: { value: NetworkId | 'any'; onChange: (v: NetworkId | 'any') => void; agent: string }) {
  const options: { id: NetworkId | 'any'; label: string; icon: Icon; slot: Slot }[] = [
    { id: 'any', label: 'Ask me', icon: Sparkles, slot: 'p4' },
    ...NETWORKS.map((n) => ({ id: n.id, label: n.name, icon: n.icon, slot: n.slot })),
  ]
  return (
    <div className="flex items-center gap-1 rounded-full bg-muted/70 p-0.5" role="radiogroup" aria-label="Post to">
      {options.map((o) => {
        const active = value === o.id
        return (
          <Tooltip key={o.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange(o.id)}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition',
                  active ? cn(SLOT_CLASSES[o.slot].chip, 'shadow-xs') : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <o.icon className="size-3.5" />
                <span className="hidden sm:inline">{o.label}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>{o.id === 'any' ? `${agent} asks which network` : `Post to ${o.label}`}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

const SOURCE_META: Record<ConversationSummary['source'], { icon: Icon; label: string }> = {
  dashboard: { icon: Sparkles, label: 'Brew' },
  extension: { icon: Puzzle, label: 'Extension' },
  shared: { icon: Users, label: 'Organisation' },
}

/** The person's conversations: Brew chats here and runs from the Chrome extension, newest first. */
function ConversationList({
  conversations,
  currentId,
  open,
  busy,
  canManage,
  onOpen,
  onNew,
  onDelete,
  onClose,
}: {
  conversations: ConversationSummary[] | null
  currentId: string
  open: boolean
  busy: boolean
  canManage: boolean
  onOpen: (id: string) => void
  onNew: () => void
  onDelete: (c: ConversationSummary) => void
  onClose: () => void
}) {
  return (
    <>
      {open && <div className="absolute inset-0 z-20 bg-background/60 backdrop-blur-xs lg:hidden" onClick={onClose} aria-hidden />}
      <aside
        className={cn(
          'w-72 shrink-0 flex-col border-r border-border/60',
          open ? 'absolute inset-y-0 left-0 z-30 flex bg-background shadow-xl' : 'hidden',
          'lg:static lg:flex lg:w-64 lg:bg-background/40 lg:shadow-none',
        )}
        aria-label="Conversations"
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2.5">
          <span className="text-sm font-medium">Conversations</span>
          <Button size="sm" variant="ghost" onClick={onNew} disabled={busy}>
            <Plus /> New
          </Button>
        </div>
        <p className="px-3 pb-2 text-[11px] text-muted-foreground">Brew chats and Chrome extension runs, on every device you sign in to.</p>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {conversations === null ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">Loading…</p>
          ) : conversations.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">No conversations yet. Your chats appear here.</p>
          ) : (
            <ul className="space-y-0.5">
              {conversations.map((c) => {
                const meta = SOURCE_META[c.source] || SOURCE_META.dashboard
                const active = c.id === currentId
                const deletable = c.source !== 'shared' || canManage
                return (
                  <li key={c.id} className="group relative">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onOpen(c.id)}
                      aria-current={active ? 'true' : undefined}
                      className={cn(
                        'w-full rounded-lg px-2.5 py-2 text-left transition disabled:opacity-60',
                        deletable && 'pr-8',
                        active ? 'bg-p1-soft' : 'hover:bg-muted',
                      )}
                    >
                      <span className="block truncate text-sm">{c.title || 'Untitled'}</span>
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                        <meta.icon className="size-3 shrink-0" />
                        {meta.label}
                        {c.updatedAt > 0 && <> · {timeAgo(new Date(c.updatedAt).toISOString())}</>}
                        {c.posts > 0 && <> · {c.posts} posted</>}
                        {c.status === 'running' && <> · running</>}
                      </span>
                    </button>
                    {deletable && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onDelete(c)}
                        aria-label={`Delete ${c.title || 'conversation'}`}
                        className="absolute top-2 right-1.5 rounded-md p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-background hover:text-foreground focus-visible:opacity-100"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </aside>
    </>
  )
}

export function BrewPage() {
  const { health, refreshPosts, canManage } = useAppState()
  const assistant = useAssistant(health)
  const agent = assistant.label
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [items, setItems] = useState<ChatItem[] | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null)
  // What is open: one of the person's Brew chats (continues), something to start from (extension run,
  // the organisation's older chat), or null for a new chat.
  const [current, setCurrent] = useState<Conversation | null>(null)
  const [continuedFrom, setContinuedFrom] = useState('')
  const [listOpen, setListOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ConversationSummary | null>(null)
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [target, setTarget] = useState<NetworkId | 'any'>('any')
  const [privacy, setPrivacy] = useState('unlisted')
  const [kids, setKids] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [dragging, setDragging] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const loadList = useCallback(async () => {
    const data = await api<{ conversations: ConversationSummary[] }>('/api/conversations')
    setConversations(data.conversations || [])
  }, [])

  const setChatParam = useCallback(
    (id: string) =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (id) next.set('chat', id)
          else next.delete('chat')
          return next
        },
        { replace: true },
      ),
    [setSearchParams],
  )

  const openConversation = useCallback(
    async (id: string, keepNote = false) => {
      const data = await api<{ conversation: Conversation }>(`/api/conversations/${encodeURIComponent(id)}`)
      setCurrent(data.conversation)
      setItems(data.conversation.display || [])
      if (!keepNote) setContinuedFrom('')
      setListOpen(false)
      setChatParam(id)
    },
    [setChatParam],
  )

  function newChat() {
    setCurrent(null)
    setItems([])
    setContinuedFrom('')
    setListOpen(false)
    setChatParam('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  // On load: the list, and the chat named in the address (?chat=), or a new chat.
  const initialChat = useRef(searchParams.get('chat') || '')
  useEffect(() => {
    loadList().catch((err) => toast.error(err.message))
    const id = initialChat.current
    if (!id) {
      setItems([])
      return
    }
    openConversation(id).catch(() => {
      setItems([])
      setChatParam('')
    })
  }, [loadList, openConversation, setChatParam])

  // The extension may have added runs while this tab was in the background.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') loadList().catch(() => {})
    }
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [loadList])

  useEffect(() => {
    const state = location.state as { prompt?: string; target?: NetworkId } | null
    if (state?.prompt || state?.target) {
      if (state.prompt) setText(state.prompt)
      if (state.target) setTarget(state.target)
      navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null })
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [location.state, location.pathname, location.search, navigate])

  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [items, busy, status])

  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [text])

  function pickFile(next: File | null | undefined) {
    if (!next) return
    if (!/\.(mp4|mov|webm|m4v)$/i.test(next.name)) {
      toast.error('Use an mp4, mov, or webm file.')
      return
    }
    setFile(next)
  }

  async function send() {
    if (busy) return
    const raw = text.trim()
    if (!raw && !file) {
      toast('Write a message or attach a video.')
      return
    }
    const network = target === 'any' ? undefined : networkById[target]
    const mentions = network && new RegExp(network.name, 'i').test(raw)
    const message = network && !mentions ? `[${network.name}] ${raw || `Post the attached video to ${network.name}.`}` : raw

    // Own Brew chats continue in place; anything else starts a new chat from its transcript.
    let chatId = current?.continues ? current.id : ''
    const startFrom = current && !current.continues ? current : null

    setBusy(true)
    setStatus(file ? 'Uploading video…' : `${agent} is thinking…`)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      let mediaId = ''
      let mediaName = ''
      if (file) {
        const media = await uploadMedia(file)
        mediaId = media.id
        mediaName = media.name
      }
      const res = await authedFetch('/api/agent/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: message,
          mediaId,
          privacyStatus: privacy,
          madeForKids: kids,
          provider: assistant.id,
          chatId: chatId || undefined,
          resumeFrom: startFrom?.id,
        }),
        signal: controller.signal,
      })
      if (!res.ok || !res.headers.get('content-type')?.includes('text/event-stream')) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `${agent} could not start.`)
      }
      setText('')
      setFile(null)
      if (startFrom) {
        setContinuedFrom(startFrom.title)
        setCurrent(null)
      }
      setItems((prev) => [
        ...(startFrom ? [] : prev || []),
        {
          id: `local-${Date.now()}`,
          role: 'user',
          content: message || 'Post the attached video as a YouTube Short.',
          mediaId,
          mediaName,
          at: new Date().toISOString(),
        },
      ])
      await readSse(res, (event, data) => {
        if (event === 'chat' && data.id && data.id !== chatId) {
          chatId = data.id
          setCurrent({ id: data.id, title: message.slice(0, 80), source: 'dashboard', continues: true, display: [] })
          setChatParam(data.id)
          loadList().catch(() => {})
        }
        if (event === 'status') setStatus(data.text || '')
        if (event === 'message') setItems((prev) => [...(prev || []), data as ChatItem])
        if (event === 'error') toast.error(data.error || `${agent} could not finish that.`)
      })
      if (chatId) await openConversation(chatId, true)
      refreshPosts().catch(() => {})
    } catch (err) {
      if ((err as Error).name === 'AbortError') toast('Stopped.')
      else toast.error((err as Error).message)
      if (chatId) await openConversation(chatId, true).catch(() => {})
    } finally {
      loadList().catch(() => {})
      abortRef.current = null
      setBusy(false)
      setStatus('')
      inputRef.current?.focus()
    }
  }

  async function removeConversation(c: ConversationSummary) {
    // The organisation's older chat is cleared for everyone; everything else is this person's own.
    if (c.source === 'shared') await api('/api/agent/history', { method: 'DELETE' })
    else await api(`/api/conversations/${encodeURIComponent(c.id)}`, { method: 'DELETE' })
    if (current?.id === c.id) newChat()
    await loadList()
    toast.success('Conversation deleted.')
  }

  const empty = items !== null && items.length === 0
  const showYoutubeOptions = target === 'any' || target === 'youtube'

  let body: ReactNode
  if (items === null) {
    body = <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading chat…</div>
  } else if (empty && !busy) {
    body = (
      <EmptyChat
        agent={agent}
        keyName={assistant.keyName}
        ready={health ? assistant.ready : true}
        onPick={(prompt, t) => {
          setText(prompt)
          setTarget(t)
          inputRef.current?.focus()
        }}
      />
    )
  } else {
    const fromElsewhere = current && !current.continues
    body = (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
        {fromElsewhere && (
          <p className="flex items-start gap-2 rounded-xl border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {current.source === 'extension' ? <Puzzle className="mt-0.5 size-3.5 shrink-0" /> : <Users className="mt-0.5 size-3.5 shrink-0" />}
            <span>
              {current.source === 'extension' ? 'A run from the Chrome extension.' : 'The chat your organisation shared before conversations were per person.'} Your next message starts a new Brew chat that picks up from it.
            </span>
          </p>
        )}
        {continuedFrom && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <History className="size-3.5 shrink-0" /> Continues “{continuedFrom}”
          </p>
        )}
        {items.map((item) =>
          item.role === 'user' ? (
            <UserBubble key={item.id} item={item} />
          ) : item.role === 'tool' ? (
            <ToolCard key={item.id} item={item} />
          ) : (
            <AssistantBubble key={item.id} item={item} />
          ),
        )}
        {busy && <Thinking status={status} agent={agent} />}
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1">
      <ConversationList
        conversations={conversations}
        currentId={current?.id || ''}
        open={listOpen}
        busy={busy}
        canManage={canManage}
        onOpen={(id) => openConversation(id).catch((err) => toast.error(err.message))}
        onNew={newChat}
        onDelete={setPendingDelete}
        onClose={() => setListOpen(false)}
      />
      <div
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault()
            setDragging(true)
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          pickFile(e.dataTransfer.files?.[0])
        }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-background/40 px-4 py-2.5 backdrop-blur">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <Button size="icon-sm" variant="ghost" className="lg:hidden" onClick={() => setListOpen(true)} aria-label="Conversations">
              <History />
            </Button>
            <Sparkles className="size-4 shrink-0 text-p1-ink" />
            <span className="truncate font-medium">{current?.title || `Brew with ${agent}`}</span>
            <span className="hidden truncate text-muted-foreground xl:inline">· generates clips, writes copy, and posts for you</span>
          </div>
          <Button size="sm" variant="ghost" disabled={busy || (!current && !items?.length)} onClick={newChat}>
            <Plus /> New chat
          </Button>
        </div>

        <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto" aria-live="polite">
          {body}
        </div>

        <div className="px-4 pb-4">
          <form
            className={cn(
              'mx-auto w-full max-w-3xl rounded-3xl border bg-card shadow-lg shadow-p2/20 transition focus-within:border-p1 focus-within:ring-4 focus-within:ring-p1/20',
              dragging && 'border-p1 ring-4 ring-p1/30',
            )}
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
          >
            {file && (
              <div className="flex items-center gap-2 px-4 pt-3">
                <span className="inline-flex max-w-full items-center gap-2 rounded-xl bg-p3-soft px-2.5 py-1.5 text-xs font-medium text-p3-ink">
                  <Clapperboard className="size-3.5 shrink-0" />
                  <span className="truncate">{file.name}</span>
                  <span className="text-p3-ink/70">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                  <button type="button" onClick={() => setFile(null)} aria-label="Remove video" className="rounded-full p-0.5 hover:bg-p3/40">
                    <X className="size-3" />
                  </button>
                </span>
              </div>
            )}
            <label htmlFor="brew-input" className="sr-only">
              Message {agent}
            </label>
            <textarea
              id="brew-input"
              ref={inputRef}
              rows={1}
              value={text}
              disabled={busy}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  send()
                }
              }}
              placeholder={dragging ? 'Drop the video to attach it' : `Tell ${agent} what to make: a Short, a post, or ask how your videos did…`}
              className="block max-h-56 w-full resize-none bg-transparent px-4 pt-4 pb-2 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
            />
            <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
              <AssistantTabs value={assistant.id} onChange={assistant.set} health={health} disabled={busy} />
              <input
                ref={fileRef}
                type="file"
                hidden
                accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
                onChange={(e) => {
                  pickFile(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => fileRef.current?.click()} disabled={busy} aria-label="Attach video">
                    <Paperclip />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Attach a video (or drop it here)</TooltipContent>
              </Tooltip>
              <TargetPicker value={target} onChange={setTarget} agent={agent} />
              {showYoutubeOptions && (
                <div className="flex items-center gap-2">
                  <Select value={privacy} onValueChange={setPrivacy}>
                    <SelectTrigger size="sm" className="h-7 rounded-full text-xs" aria-label="YouTube privacy">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unlisted">Unlisted</SelectItem>
                      <SelectItem value="private">Private</SelectItem>
                      <SelectItem value="public">Public</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-1.5">
                    <Switch id="kids" size="sm" checked={kids} onCheckedChange={setKids} />
                    <Label htmlFor="kids" className="text-xs font-normal text-muted-foreground">
                      For kids
                    </Label>
                  </div>
                </div>
              )}
              <div className="ml-auto flex items-center gap-2">
                <span className="hidden text-[11px] text-muted-foreground md:inline">Enter to send · Shift+Enter for a new line</span>
                {busy ? (
                  <Button type="button" size="icon" variant="secondary" className="rounded-full" onClick={() => abortRef.current?.abort()} aria-label="Stop">
                    <Square className="fill-current" />
                  </Button>
                ) : (
                  <Button type="submit" size="icon" className="rounded-full" disabled={!text.trim() && !file} aria-label="Send">
                    <ArrowUp />
                  </Button>
                )}
              </div>
            </div>
          </form>
        </div>
      </div>
      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.source === 'shared'
                ? 'This clears the older Brew chat for everyone in your organisation.'
                : '“' + (pendingDelete?.title || 'Untitled') + '” disappears here and from the Chrome extension on every device you sign in to.'}{' '}
              Posts already published stay in your library.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = pendingDelete
                setPendingDelete(null)
                if (target) removeConversation(target).catch((err) => toast.error(err.message))
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
