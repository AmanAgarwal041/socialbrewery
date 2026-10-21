import { useEffect, useMemo, useState, type ComponentType, type FormEvent, type SVGProps } from 'react'
import { Bot, Eye, EyeOff, Loader2, Lock, Mail, Palette as PaletteIcon, Plug, RotateCcw, Save, Settings as SettingsIcon, X } from 'lucide-react'
import { toast } from 'sonner'
import { HashnodeIcon, InstagramIcon, LinkedinIcon, RedditIcon, SlackIcon, XIcon, YoutubeIcon } from '@/components/brand-icons'
import { PageHeader } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { api, sendJson, type SettingField, type Settings } from '@/lib/api'
import { useAppState } from '@/lib/app-state'
import { cn } from '@/lib/utils'
import { PALETTE, PRESETS, applyPalette, resetPalette, savedPalette, type Palette } from '@/theme'

type Group = { id: string; title: string; description: string; icon: ComponentType<SVGProps<SVGSVGElement>>; tone: string; keys: string[] }

const GROUPS: Group[] = [
  {
    id: 'ai',
    title: 'AI models',
    description: 'Grok or Claude runs Brew and writes drafts. Clips are generated with Grok. Reviews can use Grok, Claude, or OpenAI.',
    icon: Bot,
    tone: 'bg-p1-soft text-p1-ink',
    keys: ['AGENT_PROVIDER', 'XAI_API_KEY', 'XAI_MODEL', 'XAI_VIDEO_MODEL', 'ANTHROPIC_API_KEY', 'CLAUDE_MODEL', 'ANALYSIS_PROVIDER', 'OPENAI_API_KEY', 'OPENAI_MODEL'],
  },
  { id: 'youtube', title: 'YouTube', description: 'OAuth client from Google Cloud.', icon: YoutubeIcon, tone: 'bg-p1-soft text-p1-ink', keys: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET'] },
  { id: 'linkedin', title: 'LinkedIn', description: 'App credentials from LinkedIn Developers.', icon: LinkedinIcon, tone: 'bg-p3-soft text-p3-ink', keys: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'] },
  { id: 'instagram', title: 'Instagram', description: 'Instagram API with Instagram Login, from the Meta App Dashboard.', icon: InstagramIcon, tone: 'bg-p2-soft text-p2-ink', keys: ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET'] },
  { id: 'x', title: 'X', description: 'OAuth 2.0 client from the X Developer Console.', icon: XIcon, tone: 'bg-p4-soft text-p4-ink', keys: ['X_CLIENT_ID', 'X_CLIENT_SECRET'] },
  { id: 'hashnode', title: 'Hashnode', description: 'Personal access token. API access needs the blog on Hashnode Pro.', icon: HashnodeIcon, tone: 'bg-p1-soft text-p1-ink', keys: ['HASHNODE_TOKEN', 'HASHNODE_PUBLICATION'] },
  { id: 'slack', title: 'Slack', description: 'Bot token from your Slack app, after Install to Workspace.', icon: SlackIcon, tone: 'bg-p2-soft text-p2-ink', keys: ['SLACK_BOT_TOKEN', 'SLACK_DEFAULT_CHANNEL'] },
  { id: 'reddit', title: 'Reddit', description: 'Web app credentials from reddit.com/prefs/apps.', icon: RedditIcon, tone: 'bg-p3-soft text-p3-ink', keys: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'] },
  {
    id: 'email',
    title: 'Email',
    description: 'Send to your leads through your Resend account. Every email includes your postal address and an unsubscribe link.',
    icon: Mail,
    tone: 'bg-p3-soft text-p3-ink',
    keys: ['RESEND_API_KEY', 'EMAIL_FROM', 'EMAIL_REPLY_TO', 'EMAIL_POSTAL_ADDRESS', 'RESEND_WEBHOOK_SECRET'],
  },
  { id: 'grok', title: 'Grok connector', description: 'Public tunnel URL for grok.com and Instagram. Rotate the connector token on the Grok connector page.', icon: Plug, tone: 'bg-p4-soft text-p4-ink', keys: ['MCP_PUBLIC_URL'] },
]

function Field({
  field,
  value,
  cleared,
  onChange,
  onClear,
}: {
  field: SettingField
  value: string
  cleared: boolean
  onChange: (v: string) => void
  onClear: () => void
}) {
  const [shown, setShown] = useState(false)
  const id = `setting-${field.key}`
  const saved = field.secret && field.set && !cleared
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{field.label}</Label>
        {saved ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Lock className="size-3" /> Saved, encrypted
            <button type="button" className="ml-1 inline-flex items-center rounded p-0.5 hover:bg-muted hover:text-foreground" onClick={onClear} aria-label={`Remove ${field.label}`}>
              <X className="size-3" />
            </button>
          </span>
        ) : (
          <code className="font-mono text-[10px] text-muted-foreground">{cleared ? 'will be removed' : field.key}</code>
        )}
      </div>
      {field.key === 'ANALYSIS_PROVIDER' || field.key === 'AGENT_PROVIDER' ? (
        <Select value={value || 'grok'} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="grok">Grok</SelectItem>
            <SelectItem value="claude">Claude</SelectItem>
            {field.key === 'ANALYSIS_PROVIDER' && <SelectItem value="openai">OpenAI</SelectItem>}
          </SelectContent>
        </Select>
      ) : (
        <div className="relative">
          <Input
            id={id}
            type={field.secret && !shown ? 'password' : 'text'}
            value={value}
            placeholder={saved ? '•••••••• type to replace' : undefined}
            onChange={(e) => onChange(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className={cn('font-mono text-xs', field.secret && 'pr-10')}
          />
          {field.secret && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="absolute top-1/2 right-1 -translate-y-1/2"
              onClick={() => setShown(!shown)}
              aria-label={shown ? `Hide ${field.label}` : `Show ${field.label}`}
            >
              {shown ? <EyeOff /> : <Eye />}
            </Button>
          )}
        </div>
      )}
      {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
    </div>
  )
}

function Appearance() {
  const [palette, setPalette] = useState<Palette>(savedPalette())
  function choose(next: Palette) {
    setPalette(next)
    applyPalette(next, true)
  }
  function setSwatch(index: number, color: string) {
    const next = [...palette] as Palette
    next[index] = color.toUpperCase()
    choose(next)
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="bg-palette flex size-9 items-center justify-center rounded-xl text-ink">
            <PaletteIcon className="size-4" />
          </span>
          <div>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>
              Four swatches color the whole platform. The default lives in <code className="font-mono text-xs">web/src/theme.ts</code> as{' '}
              <code className="font-mono text-xs">PALETTE</code>. Changes here stay in this browser.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PRESETS.map((preset) => {
            const active = preset.palette.join() === palette.join()
            return (
              <button
                key={preset.name}
                type="button"
                onClick={() => choose(preset.palette)}
                className={cn('rounded-2xl border p-3 text-left transition hover:shadow-md', active && 'border-p1 ring-4 ring-p1/25')}
              >
                <div className="flex h-10 overflow-hidden rounded-xl">
                  {preset.palette.map((c) => (
                    <span key={c} className="flex-1" style={{ background: c }} />
                  ))}
                </div>
                <p className="mt-2 text-sm font-medium">{preset.name}</p>
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap items-end gap-4">
          {palette.map((color, index) => (
            <label key={index} className="flex items-center gap-2 text-xs">
              <input
                type="color"
                value={color}
                onChange={(e) => setSwatch(index, e.target.value)}
                className="size-9 cursor-pointer rounded-lg border bg-transparent p-0.5"
                aria-label={`Swatch ${index + 1}`}
              />
              <span className="font-mono text-muted-foreground">{color}</span>
            </label>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => {
              resetPalette()
              setPalette(PALETTE)
            }}
          >
            <RotateCcw /> Reset
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function SettingsPage() {
  const { org, canManage, refresh } = useAppState()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [cleared, setCleared] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function apply(data: Settings) {
    setSettings(data)
    setValues(Object.fromEntries(data.managed.map((f) => [f.key, f.value || ''])))
    setCleared(new Set())
  }

  async function load() {
    apply(await api<Settings>('/api/settings'))
  }

  useEffect(() => {
    if (canManage) load().catch((err) => toast.error(err.message))
  }, [canManage, org?.id])

  const byKey = useMemo(() => new Map((settings?.managed || []).map((f) => [f.key, f])), [settings])
  const dirty = useMemo(() => {
    if (!settings) return false
    return cleared.size > 0 || settings.managed.some((f) => (f.value || '') !== (values[f.key] || ''))
  }, [settings, values, cleared])

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const data = await sendJson<{ managed: SettingField[] }>('/api/settings', 'POST', { values, clear: [...cleared] })
      apply({ managed: data.managed, redirectUri: settings?.redirectUri || '' })
      toast.success('Settings saved and encrypted.')
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-4 pb-24">
      <PageHeader
        eyebrow={org?.name || 'Organisation'}
        title="Settings"
        icon={SettingsIcon}
        iconClass="bg-palette text-ink"
        description="API keys and app credentials for this organisation. They are encrypted at rest, every post uses them, and saved secrets are never shown again."
      />
      <Appearance />

      {!canManage ? (
        <Alert>
          <Lock />
          <AlertTitle>Only owners and admins can change keys</AlertTitle>
          <AlertDescription>Ask an owner or admin of {org?.name || 'this organisation'} to add or rotate keys and connected accounts.</AlertDescription>
        </Alert>
      ) : !settings ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-56 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {GROUPS.map((group) => {
            const fields = group.keys.map((k) => byKey.get(k)).filter(Boolean) as SettingField[]
            if (!fields.length) return null
            return (
              <Card key={group.id} id={group.id} className={cn('scroll-mt-20', (group.id === 'ai' || group.id === 'email') && 'md:col-span-2')}>
                <CardHeader>
                  <div className="flex items-start gap-3">
                    <span className={cn('flex size-9 items-center justify-center rounded-xl', group.tone)}>
                      <group.icon className="size-4" />
                    </span>
                    <div>
                      <CardTitle>{group.title}</CardTitle>
                      <CardDescription>{group.description}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className={cn('grid gap-4', (group.id === 'ai' || group.id === 'email') && 'md:grid-cols-2')}>
                  {fields.map((field) => (
                    <Field
                      key={field.key}
                      field={field}
                      value={values[field.key] || ''}
                      cleared={cleared.has(field.key)}
                      onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
                      onClear={() => setCleared((prev) => new Set(prev).add(field.key))}
                    />
                  ))}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Not saved</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div
        className={cn(
          'fixed right-4 bottom-4 left-4 z-20 mx-auto flex max-w-xl items-center gap-3 rounded-2xl border bg-card/95 px-4 py-3 shadow-xl backdrop-blur transition md:left-[calc(var(--sidebar-width)+1rem)]',
          dirty || saving ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0',
        )}
      >
        <span className="flex-1 text-sm">You have unsaved changes.</span>
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => settings && apply(settings)}>
          Discard
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />} Save
        </Button>
      </div>
    </form>
  )
}
