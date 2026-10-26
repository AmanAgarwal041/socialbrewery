import { getToken } from '@clerk/react'

export type NetworkId = 'youtube' | 'linkedin' | 'instagram' | 'x' | 'hashnode' | 'slack' | 'reddit'

export type Role = 'owner' | 'admin' | 'member'
export type User = { id: string; email: string; name: string; picture: string }
// `id` is Socialbrewery's organisation; people, roles, and invites are managed in Clerk.
export type OrgSummary = { id: string; name: string; role: Role }
export type ClerkConfig = { publishableKey: string; configured: boolean }
export type Session =
  | { authenticated: false; clerk: ClerkConfig }
  | { authenticated: true; org: OrgSummary | null; clerk: ClerkConfig }

export type Health = {
  ok: boolean
  bootId: string
  /** Brew's assistant, chosen in Settings, and whether its API key is set. */
  agent?: 'grok' | 'claude'
  agentReady?: boolean
  /** Whether each assistant's API key is set (drives the Grok/Claude tabs). */
  agents?: { grok: boolean; claude: boolean }
  maxUploadMb?: number
  xai: boolean
  youtubeApp: boolean
  youtubeConnected: boolean
  linkedinApp: boolean
  linkedinConnected: boolean
  instagramApp: boolean
  instagramConnected: boolean
  xApp: boolean
  xConnected: boolean
  hashnodeApp: boolean
  hashnodeConnected: boolean
  slackApp: boolean
  slackConnected: boolean
  redditApp: boolean
  redditConnected: boolean
  redirectUri: string
  url: string
}

export type Channel = { id?: string; title?: string; customUrl?: string; thumbnail?: string }
export type Profile = { id?: string; urn?: string; title?: string; picture?: string }
export type SlackChannel = { id: string; name: string; isPrivate: boolean; isMember: boolean; members: number | null }
export type SlackStat = {
  id: string
  title: string
  url: string
  channel: string
  createdAt: string
  reactions: number | null
  replies: number | null
  top: { name: string; count: number }[]
}
export type RedditSubreddit = {
  name: string
  title: string
  subscribers: number | null
  submissionType: 'any' | 'self' | 'link' | string
  nsfw: boolean
  icon?: string
}
export type RedditDetails = RedditSubreddit & {
  banned: boolean
  restricted: boolean
  rules: { title: string; description: string }[]
  flairs: { id: string; text: string }[]
}
export type RedditStat = {
  id: string
  redditId: string
  title: string
  subreddit: string
  url: string
  createdAt: string
  score: number | null
  upvoteRatio: number | null
  comments: number | null
  removed: boolean
  deleted: boolean
}
export type HashnodePublication = { id: string; title: string; url: string }
export type HashnodeAccount = Profile & { username?: string; publication?: HashnodePublication; publications?: HashnodePublication[] }
export type HashnodeArticle = {
  id: string
  title: string
  url: string
  brief: string
  publishedAt: string
  views: number | null
  reactions: number | null
  comments: number | null
  readTime: number | null
  cover: string
  tags: string[]
}

export type Connectors = {
  youtube: { connected: boolean; channel: Channel | null; appReady: boolean; redirectUri: string }
  linkedin: { connected: boolean; profile: Profile | null; appReady: boolean; redirectUri: string }
  instagram: {
    connected: boolean
    account: Profile | null
    appReady: boolean
    redirectUri: string
    needsPublicUrl: boolean
    webhook: { url: string; verifyToken: string } | null
  }
  x: { connected: boolean; account: Profile | null; appReady: boolean; redirectUri: string }
  hashnode: { connected: boolean; account: HashnodeAccount | null; appReady: boolean; redirectUri: string }
  slack: {
    connected: boolean
    account: (Profile & { url?: string; botName?: string }) | null
    appReady: boolean
    redirectUri: string
    defaultChannel: string
    manifest: string
  }
  reddit: { connected: boolean; account: (Profile & { username?: string; karma?: number }) | null; appReady: boolean; redirectUri: string }
  // One MCP connector for both assistants: mcpUrl for Grok, claudeUrl (the same plus client=claude) for Claude.
  grok: { name: string; mcpUrl: string; claudeUrl: string; localOnly: boolean; connectorsPage: string; claudePage: string }
}

export type LeadStatus = 'subscribed' | 'unsubscribed' | 'bounced'
export type Lead = {
  id: string
  email: string
  firstName: string
  lastName: string
  company: string
  tags: string[]
  /** Extra CSV columns, keyed for merge fields ({{subject}}, {{custom_note}}, …). */
  meta?: Record<string, string>
  status: LeadStatus
  source: 'csv' | 'manual'
  createdAt: string
  updatedAt: string
  lastEmailedAt: string
}
export type Campaign = {
  id: string
  name: string
  subject: string
  body: string
  audienceTags: string[]
  /** Optional header banner above the body (upload and/or image URL). */
  bannerEnabled?: boolean
  bannerImageUrl?: string
  bannerLinkUrl?: string
  bannerAssetId?: string
  bannerMime?: string
  status: 'draft' | 'sending' | 'paused' | 'sent'
  createdAt: string
  updatedAt: string
  sentAt: string
  stats: { sent: number; failed: number; opens?: number; openCount?: number }
}
export type EmailStatus = {
  ready: boolean
  missing: string[]
  publicLinks: boolean
  from: string
  counts: { total: number; subscribed: number }
  webhookSet: boolean
  webhookUrl: string
}
export type ImportResult = { added: number; updated: number; total: number; skipped: { line: number; reason: string }[] }
export type SendResult = { status: Campaign['status']; sentNow: number; failedNow: number; remaining: number; stats: Campaign['stats'] }

export type Post = {
  id: string
  network?: NetworkId
  mediaId?: string
  title: string
  description?: string
  tags?: string[]
  privacyStatus?: string
  youtubeId?: string
  linkedinId?: string
  instagramId?: string
  xId?: string
  hashnodeId?: string
  slackTs?: string
  slackChannel?: string
  slackChannelName?: string
  redditId?: string
  subreddit?: string
  url?: string
  createdAt: string
  source?: string
}

export type Video = {
  id: string
  thumbnail: string
  title: string
  description: string
  publishedAt: string
  duration: string
  privacyStatus: string
  views: number | null
  likes: number | null
  comments: number | null
  url: string
  shortsUrl: string
  analysis: string
}

export type Review = {
  videoId: string
  title: string
  analysis: string
  provider: 'grok' | 'openai'
  performance: { last28Days: Record<string, number | null>; range: { startDate: string; endDate: string } }
}

export type ChatItem = {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool?: string
  mediaId?: string
  mediaName?: string
  url?: string
  error?: boolean
  at?: string
}

export type InstagramEvent = {
  id: string
  field: string
  accountId: string
  time: number
  from: string
  text: string
  mediaId?: string
  commentId?: string
  echo?: boolean
  receivedAt: string
}

export type SettingField = { key: string; label: string; value: string; secret: boolean; set: boolean; help?: string }
export type Settings = { managed: SettingField[]; redirectUri: string }

export const SIGNED_OUT_EVENT = 'socialbrewery:signed-out'
// Signed-out visitors explore the dashboard; anything that would change something asks them to sign in.
export const SIGN_IN_EVENT = 'socialbrewery:sign-in'

export class SignInRequired extends Error {
  constructor() {
    super('Sign in to do that. You can keep looking around first.')
  }
}

export function requestSignIn(): never {
  window.dispatchEvent(new Event(SIGN_IN_EVENT))
  throw new SignInRequired()
}

// What the pages read while signed out: an organisation with nothing set up or connected yet.
const GUEST_READS: Record<string, unknown> = {
  '/api/agent/history': { display: [] },
  '/api/youtube/videos': { videos: [] },
  '/api/hashnode/posts': { posts: [] },
  '/api/slack/stats': { posts: [] },
  '/api/reddit/stats': { posts: [] },
  '/api/reddit/subreddits': { subreddits: [] },
  '/api/slack/channels': { channels: [] },
  '/api/instagram/events': { events: [] },
  '/api/posts': { posts: [] },
  '/api/email/leads': { leads: [] },
  '/api/email/campaigns': { campaigns: [] },
  '/api/email/status': {
    ready: false,
    missing: ['Resend API key', 'From address', 'Postal address'],
    publicLinks: true,
    from: '',
    counts: { total: 0, subscribed: 0 },
    webhookSet: false,
    webhookUrl: '',
  },
}

export function agentLabel(health?: Health | null) {
  return health?.agent === 'claude' ? 'Claude' : 'Grok'
}

export function guestHealth(): Health {
  return {
    ok: true,
    bootId: 'guest',
    agent: 'grok',
    agentReady: false,
    agents: { grok: false, claude: false },
    maxUploadMb: 25,
    xai: false,
    youtubeApp: false,
    youtubeConnected: false,
    linkedinApp: false,
    linkedinConnected: false,
    instagramApp: false,
    instagramConnected: false,
    xApp: false,
    xConnected: false,
    hashnodeApp: false,
    hashnodeConnected: false,
    slackApp: false,
    slackConnected: false,
  } as Health
}

export function guestConnectors(): Connectors {
  const callback = (network: string) => `${window.location.origin}/api/${network}/callback`
  return {
    youtube: { connected: false, channel: null, appReady: false, redirectUri: callback('youtube') },
    linkedin: { connected: false, profile: null, appReady: false, redirectUri: callback('linkedin') },
    instagram: { connected: false, account: null, appReady: false, redirectUri: callback('instagram'), needsPublicUrl: false, webhook: null },
    x: { connected: false, account: null, appReady: false, redirectUri: callback('x') },
    hashnode: { connected: false, account: null, appReady: false, redirectUri: '' },
    slack: { connected: false, account: null, appReady: false, redirectUri: '', defaultChannel: '', manifest: '' },
    reddit: { connected: false, account: null, appReady: false, redirectUri: callback('reddit') },
    grok: { name: 'Socialbrewery', mcpUrl: '', claudeUrl: '', localOnly: false, connectorsPage: 'https://grok.com/connectors', claudePage: 'https://claude.ai/settings/connectors' },
  }
}

// The current Clerk session token, for this app's own endpoints. Clerk refreshes it (and the
// __session cookie) as it nears its one-minute expiry.
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken().catch(() => null)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function isRead(options?: RequestInit) {
  const method = (options?.method || 'GET').toUpperCase()
  return method === 'GET' || method === 'HEAD'
}

export async function authedFetch(url: string, options?: RequestInit): Promise<Response> {
  const headers = new Headers(options?.headers)
  if (url.startsWith('/') && !headers.has('Authorization')) {
    const auth = await authHeaders()
    if (!auth.Authorization && url.startsWith('/api/') && !isRead(options)) requestSignIn()
    for (const [key, value] of Object.entries(auth)) headers.set(key, value)
  }
  return fetch(url, { ...options, headers })
}

// Full-page navigations (connect links) carry the __session cookie instead of a header, so refresh it first.
export async function navigateSignedIn(url: string) {
  const token = await getToken().catch(() => null)
  if (!token) {
    window.dispatchEvent(new Event(SIGN_IN_EVENT))
    return
  }
  window.location.assign(url)
}

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  if (url.startsWith('/api/') && isRead(options) && !(await getToken().catch(() => null))) {
    const path = url.split('?')[0]
    if (path in GUEST_READS) return structuredClone(GUEST_READS[path]) as T
  }
  const res = await authedFetch(url, options)
  const text = await res.text().catch(() => '')
  let data: unknown = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = {}
  }
  if (res.status === 401) window.dispatchEvent(new Event(SIGNED_OUT_EVENT))
  if (!res.ok) {
    const plain = text && !text.trimStart().startsWith('<') ? text.trim().slice(0, 300) : ''
    throw new Error((data as { error?: string }).error || plain || `Request failed (${res.status}).`)
  }
  return data as T
}

export function sendJson<T>(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  return api<T>(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export function postJson<T>(url: string, body: unknown): Promise<T> {
  return api<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function postNetwork(post: Post): NetworkId {
  return post.network || 'youtube'
}

export async function uploadMedia(file: File): Promise<{ id: string; name: string }> {
  const res = await authedFetch('/api/media', {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-Filename': encodeURIComponent(file.name),
    },
    body: file,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Upload failed.')
  return data.media
}

/** Upload a campaign header banner (PNG/JPEG/WebP/GIF, max ~750 KB). */
export async function uploadCampaignBanner(campaignId: string, file: File): Promise<Campaign> {
  const res = await authedFetch(`/api/email/campaigns/${campaignId}/banner`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Banner upload failed.')
  return data.campaign
}

export async function readSse(response: Response, onEvent: (event: string, data: any) => void) {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split('\n\n')
    buffer = chunks.pop() || ''
    for (const chunk of chunks) {
      if (!chunk.trim() || chunk.startsWith(':')) continue
      let event = 'message'
      const dataLines: string[] = []
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      if (dataLines.length) onEvent(event, JSON.parse(dataLines.join('\n')))
    }
  }
}

const VIDEO_HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'youtu.be',
  'www.linkedin.com',
  'linkedin.com',
  'www.instagram.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'hashnode.com',
  'www.reddit.com',
  'reddit.com',
  'old.reddit.com',
  'redd.it',
])

// A connected Hashnode blog can live on its own domain, so its host is added once connectors load.
export function allowLinkHost(url?: string) {
  try {
    const parsed = new URL(url || '')
    if (parsed.protocol === 'https:') VIDEO_HOSTS.add(parsed.hostname)
  } catch {
    // Not a URL.
  }
}

export function safeLink(url?: string): string {
  try {
    const parsed = new URL(url || '')
    const host = parsed.hostname
    const trusted = VIDEO_HOSTS.has(host) || host.endsWith('.hashnode.dev') || host.endsWith('.slack.com')
    if (parsed.protocol === 'https:' && trusted) return parsed.toString()
  } catch {
    // Not a URL.
  }
  return ''
}

export function safeImage(url?: string): string {
  try {
    const parsed = new URL(url || '')
    if (parsed.protocol !== 'https:') return ''
    if (/(^|\.)(ggpht|googleusercontent|ytimg|licdn|cdninstagram|fbcdn|twimg|hashnode|slack-edge|redditmedia|redditstatic|redd)\.(com|net|it)$/.test(parsed.hostname)) {
      return parsed.toString()
    }
  } catch {
    // Not a URL.
  }
  return ''
}

export function mediaSrc(id?: string): string {
  return id && /^[0-9a-f-]{36}$/i.test(id) ? `/api/media/${id}` : ''
}

export function formatCount(value: number | null | undefined): string {
  if (value == null) return '—'
  return new Intl.NumberFormat(undefined, { notation: value >= 10000 ? 'compact' : 'standard' }).format(value)
}

export function timeAgo(iso?: string): string {
  if (!iso) return ''
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.35, 'week'],
    [12, 'month'],
    [Infinity, 'year'],
  ]
  let value = seconds
  for (const [size, unit] of steps) {
    if (Math.abs(value) < size) return rtf.format(-Math.round(value), unit)
    value /= size
  }
  return ''
}
