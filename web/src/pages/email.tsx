import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom'
import { BarChart3, CircleAlert, Eye, FileUp, ImagePlus, Loader2, Mail, MailCheck, MailX, Plus, RefreshCw, Send, ShieldCheck, Sparkles, Trash2, UserMinus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { AssistantTabs } from '@/components/assistant-tabs'
import { CopyField, EmptyState, PageHeader, Stat } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api, postJson, sendJson, timeAgo, uploadCampaignBanner, type Campaign, type CampaignAnalytics, type EmailStatus, type ImportResult, type Lead, type SendResult } from '@/lib/api'
import { useAppState } from '@/lib/app-state'
import { useAssistant } from '@/lib/assistant'
import { cn } from '@/lib/utils'

const STATUS_TONE: Record<Lead['status'], string> = {
  subscribed: 'bg-p4-soft text-p4-ink',
  unsubscribed: 'bg-muted text-muted-foreground',
  bounced: 'bg-destructive/10 text-destructive',
}

const CAMPAIGN_TONE: Record<Campaign['status'], string> = {
  draft: 'bg-muted text-muted-foreground',
  sending: 'bg-p3-soft text-p3-ink',
  paused: 'bg-destructive/10 text-destructive',
  sent: 'bg-p4-soft text-p4-ink',
}

const fullName = (l: Pick<Lead, 'firstName' | 'lastName'>) => [l.firstName, l.lastName].filter(Boolean).join(' ')
const splitTags = (value: string) => [...new Set(value.split(/[,;]/).map((t) => t.trim().toLowerCase()).filter(Boolean))]

// The same merge rules as the server (src/email.js), for the preview.
function merge(template: string, lead: Partial<Lead>) {
  const values: Record<string, string> = {
    first_name: lead.firstName || '',
    last_name: lead.lastName || '',
    name: fullName({ firstName: lead.firstName || '', lastName: lead.lastName || '' }),
    company: lead.company || '',
    email: lead.email || '',
  }
  for (const [key, value] of Object.entries(lead.meta || {})) {
    const k = key.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    if (k && values[k] === undefined) values[k] = value
  }
  return template.replace(/\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/gi, (match, key: string, fallback?: string) => {
    const k = key.toLowerCase()
    if (!Object.prototype.hasOwnProperty.call(values, k)) return match
    return values[k] || (fallback ?? '').trim()
  })
}

// The preview shows the same light formatting the email gets: images, **bold**, [label](url), and bare links.
function Formatted({ text }: { text: string }) {
  const parts = text.split(/(!\[[^\]]*\]\([^)]+\)|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<)]+)/g)
  return (
    <>
      {parts.map((part, i) => {
        const image = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(part)
        if (image) {
          const src = /^https?:\/\//i.test(image[2].trim()) ? image[2].trim() : ''
          if (!src) return null
          return <img key={i} src={src} alt={image[1]} className="my-2 max-w-full rounded-md" />
        }
        const bold = /^\*\*([^*]+)\*\*$/.exec(part)
        if (bold) return <strong key={i}>{bold[1]}</strong>
        const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part)
        const href = link ? link[2] : /^https?:\/\//.test(part) ? part : ''
        if (href)
          return (
            <a key={i} href={href} target="_blank" rel="noreferrer" className="text-p1-ink underline">
              {link ? link[1] : part}
            </a>
          )
        return part
      })}
    </>
  )
}

function useEmail() {
  const [status, setStatus] = useState<EmailStatus | null>(null)
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const load = useCallback(async () => {
    const [s, l, c] = await Promise.all([
      api<EmailStatus>('/api/email/status'),
      api<{ leads: Lead[] }>('/api/email/leads'),
      api<{ campaigns: Campaign[] }>('/api/email/campaigns'),
    ])
    setStatus(s)
    setLeads(l.leads)
    setCampaigns(c.campaigns)
  }, [])
  useEffect(() => {
    load().catch((err) => toast.error(err.message))
  }, [load])
  return { status, leads, campaigns, load }
}

function SubNav() {
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn('rounded-lg px-3 py-1.5 text-sm font-medium transition-colors', isActive ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')
  return (
    <div className="mb-4 inline-flex gap-1 rounded-xl bg-muted p-1">
      <NavLink to="/email" end className={tab}>
        Leads
      </NavLink>
      <NavLink to="/email/campaigns" className={tab}>
        Campaigns
      </NavLink>
    </div>
  )
}

function SetupNotice({ status }: { status: EmailStatus }) {
  const { canManage } = useAppState()
  if (status.ready && status.publicLinks && status.webhookSet) return null
  return (
    <div className="mb-4 space-y-3">
      {!status.ready && (
        <Alert>
          <CircleAlert />
          <AlertTitle>Set up sending first</AlertTitle>
          <AlertDescription>
            <p>
              Add your {status.missing.join(', ')} in{' '}
              <Link to="/settings#email" className="font-medium underline">
                Settings → Email
              </Link>
              . Create a free account at resend.com, verify your sending domain there, and copy an API key.
            </p>
          </AlertDescription>
        </Alert>
      )}
      {!status.publicLinks && (
        <Alert>
          <CircleAlert />
          <AlertTitle>Public links need a public address</AlertTitle>
          <AlertDescription>APP_URL points at this computer, so unsubscribe links, open tracking, and banner images in your emails won’t work for recipients. Deploy, or set APP_URL to a public https URL.</AlertDescription>
        </Alert>
      )}
      {status.ready && !status.webhookSet && canManage && status.webhookUrl && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4" /> Stop mailing bounced addresses (recommended)
            </CardTitle>
            <CardDescription>
              In Resend, open Webhooks → Add endpoint, paste this URL, and choose email.bounced, email.complained, and email.suppressed. Then copy the signing secret
              (whsec_…) into Settings → Email.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CopyField label="Webhook URL" value={status.webhookUrl} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ---------- leads ----------

function AddLeadDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [form, setForm] = useState({ email: '', firstName: '', lastName: '', company: '', tags: '' })
  const [saving, setSaving] = useState(false)
  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      await postJson('/api/email/leads', { ...form, tags: splitTags(form.tags) })
      toast.success(`${form.email} added.`)
      setForm({ email: '', firstName: '', lastName: '', company: '', tags: '' })
      onOpenChange(false)
      onDone()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const field = (key: keyof typeof form, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`lead-${key}`}>{label}</Label>
      <Input id={`lead-${key}`} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...props} />
    </div>
  )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add a lead</DialogTitle>
            <DialogDescription>Only add people who agreed to hear from you.</DialogDescription>
          </DialogHeader>
          {field('email', 'Email', { type: 'email', required: true, autoFocus: true, placeholder: 'ada@example.com' })}
          <div className="grid grid-cols-2 gap-3">
            {field('firstName', 'First name')}
            {field('lastName', 'Last name')}
          </div>
          {field('company', 'Company')}
          {field('tags', 'Tags', { placeholder: 'customer, beta' })}
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />} Add lead
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ImportDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [csv, setCsv] = useState('')
  const [fileName, setFileName] = useState('')
  const [consent, setConsent] = useState(false)
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const preview = useMemo(() => csv.split(/\r?\n/).filter(Boolean).slice(0, 4), [csv])

  function reset() {
    setCsv('')
    setFileName('')
    setConsent(false)
    setTags('')
    setResult(null)
  }

  async function pick(file?: File) {
    if (!file) return
    if (file.size > 900_000) return void toast.error('That file is over 900 KB. Split it into smaller files.')
    setFileName(file.name)
    setCsv(await file.text())
    setResult(null)
  }

  async function submit() {
    setBusy(true)
    try {
      const data = await postJson<ImportResult>('/api/email/leads/import', { csv, consent, tags: splitTags(tags) })
      setResult(data)
      onDone()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import leads from CSV</DialogTitle>
          <DialogDescription>
            Needs an email column. Name, first name, last name, company, and tags are picked up as lead fields; any other column (subject, body, custom_note, …) is kept as a merge field. People who unsubscribed or bounced stay that way.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <MailCheck className="size-4" /> {result.added} added, {result.updated} updated, {result.skipped.length} skipped of {result.total} rows.
            </p>
            {result.skipped.length > 0 && (
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                {result.skipped.map((s) => (
                  <li key={s.line}>
                    Row {s.line}: {s.reason}
                  </li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button onClick={() => (reset(), onOpenChange(false))}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => void pick(e.target.files?.[0])} />
            <Button type="button" variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
              <FileUp /> {fileName || 'Choose a CSV file'}
            </Button>
            {preview.length > 0 && (
              <pre className="max-h-32 overflow-auto rounded-lg bg-muted p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">{preview.join('\n')}</pre>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="import-tags">Tag everyone in this file</Label>
              <Input id="import-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="webinar-2026" />
            </div>
            <div className="flex items-start gap-3 rounded-xl border p-3 text-sm">
              <Switch id="import-consent" checked={consent} onCheckedChange={setConsent} className="mt-0.5" />
              <label htmlFor="import-consent" className="cursor-pointer leading-snug">
                Everyone in this file agreed to receive email from us. <span className="text-muted-foreground">Required. Mailing people who didn’t agree breaks anti-spam laws and Resend’s terms.</span>
              </label>
            </div>
            <DialogFooter>
              <Button onClick={submit} disabled={!csv || !consent || busy}>
                {busy && <Loader2 className="animate-spin" />} Import
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function EmailLeadsPage() {
  const { canManage } = useAppState()
  const { status, leads, load } = useEmail()
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const allTags = useMemo(() => [...new Set((leads || []).flatMap((l) => l.tags))].sort(), [leads])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (leads || []).filter((l) => (!tag || l.tags.includes(tag)) && (!q || `${l.email} ${fullName(l)} ${l.company}`.toLowerCase().includes(q)))
  }, [leads, query, tag])

  async function unsubscribe(lead: Lead) {
    try {
      await sendJson(`/api/email/leads/${lead.id}`, 'PATCH', { status: 'unsubscribed' })
      toast.success(`${lead.email} won’t be emailed again.`)
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  async function removeSelected() {
    try {
      await postJson('/api/email/leads/delete', { ids: [...selected] })
      toast.success(`${selected.size} removed. Anyone who unsubscribed stays unsubscribed.`)
      setSelected(new Set())
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const toggle = (id: string) => setSelected((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])))

  return (
    <div>
      <PageHeader
        eyebrow="Email"
        title="Leads"
        icon={Mail}
        iconClass="bg-p3-soft text-p3-ink"
        description="Import a list or add people one by one, then email them from Campaigns."
        actions={
          <>
            <Button variant="outline" onClick={() => setAdding(true)}>
              <Plus /> Add lead
            </Button>
            {canManage && (
              <Button onClick={() => setImporting(true)}>
                <FileUp /> Import CSV
              </Button>
            )}
          </>
        }
      />
      <SubNav />
      {status && <SetupNotice status={status} />}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Leads" value={leads ? leads.length : <Skeleton className="h-7 w-10" />} icon={Users} tone="p3" />
        <Stat label="Subscribed" value={leads ? leads.filter((l) => l.status === 'subscribed').length : <Skeleton className="h-7 w-10" />} icon={MailCheck} tone="p4" />
        <Stat label="Unsubscribed or bounced" value={leads ? leads.filter((l) => l.status !== 'subscribed').length : <Skeleton className="h-7 w-10" />} icon={UserMinus} tone="p2" />
      </div>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center gap-2 space-y-0">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email, or company" className="max-w-xs" aria-label="Search leads" />
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {allTags.slice(0, 12).map((t) => (
                <button key={t} type="button" onClick={() => setTag(tag === t ? '' : t)}>
                  <Badge variant={tag === t ? 'default' : 'outline'}>{t}</Badge>
                </button>
              ))}
            </div>
          )}
          {canManage && selected.size > 0 && (
            <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 /> Remove {selected.size}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {!leads ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : !leads.length ? (
            <EmptyState icon={Users} title="No leads yet" action={canManage ? <Button onClick={() => setImporting(true)}><FileUp /> Import CSV</Button> : undefined}>
              Import a CSV with an email column, or add people one by one.
            </EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {canManage && <TableHead className="w-8" />}
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Company</TableHead>
                  <TableHead className="hidden lg:table-cell">Tags</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.slice(0, 500).map((lead) => (
                  <TableRow key={lead.id}>
                    {canManage && (
                      <TableCell>
                        <input type="checkbox" aria-label={`Select ${lead.email}`} checked={selected.has(lead.id)} onChange={() => toggle(lead.id)} />
                      </TableCell>
                    )}
                    <TableCell className="font-medium">{lead.email}</TableCell>
                    <TableCell>{fullName(lead) || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="hidden md:table-cell">{lead.company || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {lead.tags.map((t) => (
                          <Badge key={t} variant="secondary">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium capitalize', STATUS_TONE[lead.status])}>{lead.status}</span>
                    </TableCell>
                    <TableCell>
                      {lead.status === 'subscribed' && (
                        <Button size="icon-sm" variant="ghost" aria-label={`Unsubscribe ${lead.email}`} title="Unsubscribe" onClick={() => unsubscribe(lead)}>
                          <UserMinus />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {shown.length > 500 && <p className="mt-3 text-xs text-muted-foreground">Showing 500 of {shown.length}. Search or pick a tag to narrow it down.</p>}
        </CardContent>
      </Card>
      <AddLeadDialog open={adding} onOpenChange={setAdding} onDone={() => void load()} />
      <ImportDialog open={importing} onOpenChange={setImporting} onDone={() => void load()} />
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {selected.size} leads?</AlertDialogTitle>
            <AlertDialogDescription>They disappear from your list. Anyone who unsubscribed or bounced is still never emailed, even if you import them again.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={removeSelected}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------- campaigns ----------

export function EmailCampaignsPage() {
  const { status, campaigns } = useEmail()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)

  async function create() {
    setCreating(true)
    try {
      const { campaign } = await postJson<{ campaign: Campaign }>('/api/email/campaigns', { name: 'New campaign', subject: '', body: '' })
      navigate(`/email/campaigns/${campaign.id}`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Email"
        title="Campaigns"
        icon={Send}
        iconClass="bg-p3-soft text-p3-ink"
        description="Write an email once, personalise it with merge fields, and send it to everyone or to a tag."
        actions={
          <Button onClick={create} disabled={creating}>
            {creating ? <Loader2 className="animate-spin" /> : <Plus />} New campaign
          </Button>
        }
      />
      <SubNav />
      {status && <SetupNotice status={status} />}
      {!campaigns ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : !campaigns.length ? (
        <Card>
          <CardContent>
            <EmptyState icon={Send} title="No campaigns yet" action={<Button onClick={create}><Plus /> New campaign</Button>}>
              Ask Grok or Claude for a first draft, send yourself a test, then send it to your leads.
            </EmptyState>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {campaigns.map((c) => (
            <Link key={c.id} to={`/email/campaigns/${c.id}`} className="rounded-2xl border bg-card p-4 shadow-xs transition-colors hover:border-p1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{c.name}</p>
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium capitalize', CAMPAIGN_TONE[c.status])}>{c.status}</span>
                <span className="ml-auto text-xs text-muted-foreground">{c.sentAt ? `Sent ${timeAgo(c.sentAt)}` : `Edited ${timeAgo(c.updatedAt)}`}</span>
              </div>
              <p className="mt-1 truncate text-sm text-muted-foreground">{c.subject || 'No subject yet'}</p>
              {c.status !== 'draft' && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {c.stats.sent} sent{c.stats.failed ? ` · ${c.stats.failed} failed` : ''}
                  {c.stats.opens ? ` · ${c.stats.opens} opened` : ''}
                  {c.audienceTags.length ? ` · tags: ${c.audienceTags.join(', ')}` : ''}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

type Details = {
  campaign: Campaign
  audience: number
  remaining: number
  failures: { email: string; error: string }[]
  analytics?: CampaignAnalytics
}

function CampaignAnalyticsPanel({
  analytics,
  fallbackStats,
  remaining,
}: {
  analytics?: CampaignAnalytics
  fallbackStats: Campaign['stats']
  remaining: number
}) {
  const sent = analytics?.sent ?? fallbackStats.sent ?? 0
  const failed = analytics?.failed ?? fallbackStats.failed ?? 0
  const left = analytics?.remaining ?? remaining
  const uniqueOpens = analytics?.uniqueOpens ?? fallbackStats.opens ?? 0
  const openEvents = analytics?.openEvents ?? fallbackStats.openCount ?? 0
  const openRate = analytics?.openRate ?? (sent > 0 ? Math.round((uniqueOpens / sent) * 1000) / 10 : null)
  const opens = analytics?.opens ?? []

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="size-4" /> Campaign analytics
        </CardTitle>
        <CardDescription>
          Delivery and open tracking for this campaign. Opens use the tracking pixel; unique opens count each recipient once.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Stat label="Sent" value={sent} icon={Send} tone="p3" hint={sent === 0 ? 'Nothing sent yet' : undefined} />
          <Stat label="Failed" value={failed} icon={MailX} tone="p1" hint={failed ? 'See failures above' : 'No delivery failures'} />
          <Stat label="Remaining" value={left} icon={Users} tone="p2" hint={left === 0 ? 'Audience fully processed' : 'Still to send'} />
          <Stat label="Unique opens" value={uniqueOpens} icon={Eye} tone="p4" hint={uniqueOpens === 0 ? 'No opens recorded yet' : undefined} />
          <Stat label="Open events" value={openEvents} icon={MailCheck} tone="p4" hint="Includes repeat opens" />
          <Stat
            label="Open rate"
            value={openRate == null ? '—' : `${openRate}%`}
            icon={BarChart3}
            tone="p3"
            hint={openRate == null ? 'Available after the first send' : 'Unique opens ÷ sent'}
          />
        </div>
        {opens.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {sent === 0 ? 'Send the campaign (or wait for opens) to see who opened it here.' : 'No opens recorded yet for this campaign.'}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>First open</TableHead>
                  <TableHead className="hidden sm:table-cell">Last open</TableHead>
                  <TableHead className="w-24 text-right">Opens</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {opens.map((row) => (
                  <TableRow key={row.email}>
                    <TableCell className="font-medium">{row.email}</TableCell>
                    <TableCell className="text-muted-foreground">{row.firstOpenedAt ? timeAgo(row.firstOpenedAt) : '—'}</TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {row.lastOpenedAt ? timeAgo(row.lastOpenedAt) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.openCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function EmailCampaignPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { health, canManage } = useAppState()
  const assistant = useAssistant(health)
  const { status, leads } = useEmail()
  const [details, setDetails] = useState<Details | null>(null)
  const [form, setForm] = useState({
    name: '',
    subject: '',
    body: '',
    tags: '',
    bannerEnabled: false,
    bannerImageUrl: '',
    bannerLinkUrl: '',
  })
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [brief, setBrief] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [testing, setTesting] = useState(false)
  const [confirmSend, setConfirmSend] = useState(false)
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [bannerUploading, setBannerUploading] = useState(false)
  const [bannerPreviewKey, setBannerPreviewKey] = useState(0)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const bannerFileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const data = await api<Details>(`/api/email/campaigns/${id}`)
    setDetails(data)
    setForm({
      name: data.campaign.name,
      subject: data.campaign.subject,
      body: data.campaign.body,
      tags: data.campaign.audienceTags.join(', '),
      bannerEnabled: Boolean(data.campaign.bannerEnabled),
      bannerImageUrl: data.campaign.bannerImageUrl || '',
      bannerLinkUrl: data.campaign.bannerLinkUrl || '',
    })
    setBannerPreviewKey((k) => k + 1)
    setDirty(false)
  }, [id])

  useEffect(() => {
    load().catch((err) => toast.error(err.message))
  }, [load])

  const editable = details?.campaign.status === 'draft'
  const audienceTags = splitTags(form.tags)
  const audience = (leads || []).filter((l) => l.status === 'subscribed' && (!audienceTags.length || l.tags.some((t) => audienceTags.includes(t))))
  const sample = audience[0] || { firstName: 'Alex', lastName: 'Sample', company: 'Example Co', email: 'alex@example.com', meta: {} }
  const set = (key: keyof typeof form, value: string | boolean) => {
    setForm((f) => ({ ...f, [key]: value }))
    setDirty(true)
  }

  async function onBannerFile(file?: File | null) {
    if (!file || !editable) return
    setBannerUploading(true)
    try {
      const campaign = await uploadCampaignBanner(id, file)
      setDetails((d) => (d ? { ...d, campaign } : d))
      setForm((f) => ({ ...f, bannerEnabled: true }))
      setBannerPreviewKey((k) => k + 1)
      toast.success('Banner uploaded.')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBannerUploading(false)
      if (bannerFileRef.current) bannerFileRef.current.value = ''
    }
  }

  async function removeBannerUpload() {
    try {
      const { campaign } = await sendJson<{ campaign: Campaign }>(`/api/email/campaigns/${id}/banner`, 'DELETE')
      setDetails((d) => (d ? { ...d, campaign } : d))
      setBannerPreviewKey((k) => k + 1)
      toast.success('Uploaded banner removed.')
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  function insertImageSnippet() {
    const snippet = '![{{product_name|Product}}]({{hero_image|https://example.com/image.png}})\n\n'
    const el = bodyRef.current
    if (!el || !editable) {
      set('body', `${form.body}${form.body && !form.body.endsWith('\n') ? '\n' : ''}${snippet}`)
      return
    }
    const start = el.selectionStart ?? form.body.length
    const end = el.selectionEnd ?? start
    const next = `${form.body.slice(0, start)}${snippet}${form.body.slice(end)}`
    set('body', next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + snippet.length
      el.setSelectionRange(pos, pos)
    })
  }

  async function save() {
    setSaving(true)
    try {
      await sendJson(`/api/email/campaigns/${id}`, 'PATCH', {
        name: form.name,
        subject: form.subject,
        body: form.body,
        audienceTags,
        bannerEnabled: form.bannerEnabled,
        bannerImageUrl: form.bannerImageUrl,
        bannerLinkUrl: form.bannerLinkUrl,
      })
      await load()
      return true
    } catch (err) {
      toast.error((err as Error).message)
      return false
    } finally {
      setSaving(false)
    }
  }

  async function draft() {
    setDrafting(true)
    try {
      const data = await postJson<{ subject: string; body: string; by: string }>('/api/email/draft', { brief, provider: assistant.id })
      setForm((f) => ({ ...f, subject: data.subject, body: data.body }))
      setDirty(true)
      toast.success(`${data.by} wrote a draft. Edit it, then save.`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setDrafting(false)
    }
  }

  async function test() {
    if (dirty && !(await save())) return
    setTesting(true)
    try {
      await postJson(`/api/email/campaigns/${id}/test`, { to: testTo })
      toast.success(`Test sent to ${testTo}.`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setTesting(false)
    }
  }

  // The server sends up to 1,000 per request, so keep asking until nothing is left.
  async function send() {
    if (dirty && !(await save())) return
    const total = details?.remaining || audience.length
    setProgress({ sent: 0, total })
    try {
      let sent = 0
      for (let round = 0; round < 100; round++) {
        const result = await postJson<SendResult>(`/api/email/campaigns/${id}/send`, {})
        sent += result.sentNow + result.failedNow
        setProgress({ sent, total: Math.max(total, sent + result.remaining) })
        if (result.remaining <= 0) {
          toast.success(`Sent to ${result.stats.sent} people${result.stats.failed ? `; ${result.stats.failed} failed` : ''}.`)
          break
        }
      }
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setProgress(null)
      await load()
    }
  }

  async function retry() {
    try {
      const { cleared } = await postJson<{ cleared: number }>(`/api/email/campaigns/${id}/retry`, {})
      if (cleared) await send()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  async function remove() {
    try {
      await sendJson(`/api/email/campaigns/${id}`, 'DELETE')
      navigate('/email/campaigns')
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  if (!details) return <Skeleton className="h-96 rounded-2xl" />
  const c = details.campaign

  return (
    <div>
      <PageHeader
        eyebrow="Campaign"
        title={form.name || 'Untitled campaign'}
        icon={Send}
        iconClass="bg-p3-soft text-p3-ink"
        description={
          editable
            ? `${audience.length} subscribed ${audience.length === 1 ? 'person' : 'people'} will get this${audienceTags.length ? ` (tags: ${audienceTags.join(', ')})` : ''}.`
            : `${c.stats.sent} sent${c.stats.failed ? `, ${c.stats.failed} failed` : ''}${c.stats.opens ? `, ${c.stats.opens} opened` : ''}${c.sentAt ? ` · finished ${timeAgo(c.sentAt)}` : ''}.`
        }
        actions={
          <>
            {canManage && (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                <Trash2 /> Delete
              </Button>
            )}
            {editable && (
              <Button variant="outline" onClick={save} disabled={!dirty || saving}>
                {saving && <Loader2 className="animate-spin" />} Save
              </Button>
            )}
            {canManage && (c.status !== 'sent' || details.remaining > 0) && (
              <Button onClick={() => setConfirmSend(true)} disabled={!!progress || !status?.ready || !form.subject.trim() || !form.body.trim() || (editable ? !audience.length : details.remaining === 0)}>
                <Send /> {c.status === 'draft' ? 'Send' : 'Resume sending'}
              </Button>
            )}
          </>
        }
      />
      {status && <SetupNotice status={status} />}
      {progress && (
        <Card className="mb-4">
          <CardContent className="space-y-2 pt-6">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="size-4 animate-spin" /> Sending {progress.sent} of {progress.total}… keep this page open.
            </p>
            <Progress value={(progress.sent / Math.max(1, progress.total)) * 100} />
          </CardContent>
        </Card>
      )}
      {details.failures.length > 0 && (
        <Alert className="mb-4">
          <CircleAlert />
          <AlertTitle>{c.stats.failed} addresses failed</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-xs">
              {details.failures.map((f) => (
                <li key={f.email}>
                  {f.email}: {f.error}
                </li>
              ))}
            </ul>
            {canManage && (
              <Button size="sm" variant="outline" className="mt-2" onClick={retry} disabled={!!progress}>
                <RefreshCw /> Retry failed
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      <CampaignAnalyticsPanel analytics={details.analytics} fallbackStats={c.stats} remaining={details.remaining} />

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-1.5">
                <Label htmlFor="c-name">Campaign name (only you see this)</Label>
                <Input id="c-name" value={form.name} disabled={!editable} onChange={(e) => set('name', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-subject">Subject</Label>
                <Input id="c-subject" value={form.subject} disabled={!editable} onChange={(e) => set('subject', e.target.value)} placeholder="A quick update for {{first_name|you}}" />
              </div>
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="c-body">Email</Label>
                  {editable && (
                    <Button type="button" size="sm" variant="outline" onClick={insertImageSnippet}>
                      <ImagePlus /> Insert image
                    </Button>
                  )}
                </div>
                <Textarea
                  id="c-body"
                  ref={bodyRef}
                  rows={12}
                  value={form.body}
                  disabled={!editable}
                  onChange={(e) => set('body', e.target.value)}
                  placeholder={'Hi {{first_name|there}},\n\n…'}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Merge fields: <code>{'{{first_name}}'}</code>, <code>{'{{last_name}}'}</code>, <code>{'{{company}}'}</code>, <code>{'{{email}}'}</code>, plus any CSV
                  column as <code>{'{{column_name}}'}</code> (e.g. <code>{'{{subject}}'}</code>); add a fallback like <code>{'{{first_name|there}}'}</code>. Unknown tags
                  stay as written. Images: <code>![alt](https://…)</code> or merge-bound{' '}
                  <code>{'![{{product_name}}]({{hero_image|https://fallback}})'}</code> (http/https only; empty URLs are skipped). **bold**, [link](https://…) and blank
                  lines between paragraphs work. Your postal address and an unsubscribe link are added at the bottom.
                </p>
              </div>
              <div className="space-y-3 rounded-xl border p-3">
                <label className="flex items-start gap-3 text-sm">
                  <Switch
                    checked={form.bannerEnabled}
                    disabled={!editable}
                    onCheckedChange={(v) => {
                      set('bannerEnabled', v)
                    }}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">Header banner</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Places an image above the body. Upload a file (~1200×176 works well) or paste an https image URL. A URL overrides the upload when both are set.
                    </span>
                  </span>
                </label>
                {form.bannerEnabled && (
                  <div className="space-y-3">
                    <input
                      ref={bannerFileRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
                      hidden
                      onChange={(e) => void onBannerFile(e.target.files?.[0])}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!editable || bannerUploading}
                        onClick={() => bannerFileRef.current?.click()}
                      >
                        {bannerUploading ? <Loader2 className="animate-spin" /> : <ImagePlus />} Upload image
                      </Button>
                      {details?.campaign.bannerAssetId && editable && (
                        <Button type="button" size="sm" variant="ghost" onClick={() => void removeBannerUpload()}>
                          <Trash2 /> Remove upload
                        </Button>
                      )}
                      {details?.campaign.bannerAssetId && (
                        <span className="text-xs text-muted-foreground">Uploaded banner ready</span>
                      )}
                    </div>
                    {(form.bannerImageUrl.trim() || details?.campaign.bannerAssetId) && (
                      <div className="overflow-hidden rounded-lg border bg-muted/40">
                        <img
                          src={
                            /^https?:\/\//i.test(merge(form.bannerImageUrl, sample).trim())
                              ? merge(form.bannerImageUrl, sample).trim()
                              : `/api/email/campaigns/${id}/banner?v=${details?.campaign.bannerAssetId || ''}-${bannerPreviewKey}`
                          }
                          alt="Banner preview"
                          className="max-h-40 w-full object-contain"
                        />
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <Label htmlFor="c-banner-image">Or image URL (optional override)</Label>
                      <Input
                        id="c-banner-image"
                        value={form.bannerImageUrl}
                        disabled={!editable}
                        onChange={(e) => set('bannerImageUrl', e.target.value)}
                        placeholder="https://… or {{hero_image|https://…}}"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="c-banner-link">Banner link URL (optional)</Label>
                      <Input
                        id="c-banner-link"
                        value={form.bannerLinkUrl}
                        disabled={!editable}
                        onChange={(e) => set('bannerLinkUrl', e.target.value)}
                        placeholder="https://example.com"
                      />
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-tags">Send to tags</Label>
                <Input id="c-tags" value={form.tags} disabled={!editable} onChange={(e) => set('tags', e.target.value)} placeholder="Leave empty for every subscribed lead" />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          {editable && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="size-4" /> Write it with {assistant.label}
                </CardTitle>
                <CardDescription>Describe the email; it writes the subject and body for you to edit.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Announce our new scheduling feature to beta users and ask them to try it this week." />
                <div className="flex items-center justify-between gap-2">
                  <AssistantTabs value={assistant.id} onChange={assistant.set} health={health} />
                  <Button size="sm" onClick={draft} disabled={!brief.trim() || drafting}>
                    {drafting ? <Loader2 className="animate-spin" /> : <Sparkles />} Draft
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Preview</CardTitle>
              <CardDescription>As {fullName(sample) || sample.email} would see it.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="font-medium">{merge(form.subject, sample) || <span className="text-muted-foreground">No subject</span>}</p>
              <div className="rounded-xl border bg-background p-3 whitespace-pre-wrap">
                {form.bannerEnabled &&
                  (() => {
                    const url = merge(form.bannerImageUrl, sample).trim()
                    const src = /^https?:\/\//i.test(url)
                      ? url
                      : details?.campaign.bannerAssetId
                        ? `/api/email/campaigns/${id}/banner?v=${details.campaign.bannerAssetId}-${bannerPreviewKey}`
                        : ''
                    if (!src) return null
                    const href = merge(form.bannerLinkUrl, sample).trim()
                    const img = <img src={src} alt="Banner preview" className="mb-3 w-full rounded-md" />
                    return href && /^https?:\/\//i.test(href) ? (
                      <a href={href} target="_blank" rel="noreferrer" className="mb-3 block">
                        {img}
                      </a>
                    ) : (
                      img
                    )
                  })()}
                {form.body ? <Formatted text={merge(form.body, sample)} /> : <span className="text-muted-foreground">Nothing written yet.</span>}
              </div>
              <p className="text-xs text-muted-foreground">+ your postal address, unsubscribe link, and open-tracking pixel</p>
            </CardContent>
          </Card>
          {canManage && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Send a test</CardTitle>
                <CardDescription>
                  Sends this campaign’s current subject, body, and banner to one address. Works while the campaign is still a draft.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void test()
                  }}
                >
                  <Input type="email" required value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@company.com" aria-label="Test address" />
                  <Button type="submit" variant="outline" disabled={testing || !status?.ready || !form.subject.trim() || !form.body.trim()}>
                    {testing ? <Loader2 className="animate-spin" /> : <Mail />} Test
                  </Button>
                </form>
              </CardContent>
              <CardFooter className="text-xs text-muted-foreground">
                Uses a subscribed lead’s merge fields when available (otherwise sample values). Does not count toward campaign stats; the unsubscribe link does not affect real leads.
              </CardFooter>
            </Card>
          )}
        </div>
      </div>

      <AlertDialog open={confirmSend} onOpenChange={setConfirmSend}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send to {editable ? audience.length : details.remaining} people?</AlertDialogTitle>
            <AlertDialogDescription>
              From {status?.from}. People who unsubscribed or bounced are skipped. Once it starts, the campaign can’t be edited.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void send()}>Send now</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this campaign?</AlertDialogTitle>
            <AlertDialogDescription>Emails already sent stay sent. This only removes the campaign from your list.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
