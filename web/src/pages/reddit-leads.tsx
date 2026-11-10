import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, ExternalLink, MessageSquareText, Search, Sparkles, Trash2, Trophy, Users } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState, Stat } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, safeLink, sendJson, timeAgo, type RedditLead, type RedditLeadStatus } from '@/lib/api'
import { useAppState } from '@/lib/app-state'
import { cn } from '@/lib/utils'

// Reddit leads found by Brew, the Grok or Claude connector, or the Chrome extension. People here
// wrote something public that matches what the organisation makes; following up means a helpful
// public reply, never a direct message.

const STATUSES: RedditLeadStatus[] = ['new', 'engaged', 'won', 'dismissed']
const FIT_TONE: Record<RedditLead['fit'], string> = {
  high: 'bg-p4-soft text-p4-ink',
  medium: 'bg-p2-soft text-p2-ink',
  low: 'bg-muted text-muted-foreground',
}
const SOURCE_LABEL: Record<string, string> = { extension: 'Extension', agent: 'Brew', grok: 'Grok', claude: 'Claude', dashboard: 'Dashboard', manual: 'Manual' }

function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function downloadCsv(leads: RedditLead[]) {
  const head = ['username', 'subreddit', 'fit', 'status', 'reason', 'post_title', 'post_url', 'notes', 'source', 'found']
  const rows = leads.map((l) => [l.username, l.subreddit, l.fit, l.status, l.reason, l.postTitle, l.postUrl, l.notes, l.source, l.createdAt].map((v) => csvCell(String(v || ''))).join(','))
  const url = URL.createObjectURL(new Blob([[head.join(','), ...rows].join('\n')], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `reddit-leads-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function RedditLeads() {
  const { guest, canManage } = useAppState()
  const [leads, setLeads] = useState<RedditLead[] | null>(null)
  const [filter, setFilter] = useState<RedditLeadStatus | 'open'>('open')

  const load = useCallback(async () => {
    if (guest) return setLeads([])
    try {
      setLeads((await api<{ leads: RedditLead[] }>('/api/reddit/leads')).leads)
    } catch (err) {
      toast.error((err as Error).message)
      setLeads([])
    }
  }, [guest])

  useEffect(() => {
    void load()
  }, [load])

  const shown = useMemo(() => (leads || []).filter((l) => (filter === 'open' ? l.status !== 'dismissed' : l.status === filter)), [leads, filter])
  const count = (status: RedditLeadStatus) => (leads || []).filter((l) => l.status === status).length

  async function setStatus(lead: RedditLead, status: RedditLeadStatus) {
    try {
      const { lead: next } = await sendJson<{ lead: RedditLead }>(`/api/reddit/leads/${lead.id}`, 'PATCH', { status })
      setLeads((list) => (list || []).map((l) => (l.id === next.id ? next : l)))
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  async function remove(lead: RedditLead) {
    try {
      await sendJson(`/api/reddit/leads/${lead.id}`, 'DELETE')
      setLeads((list) => (list || []).filter((l) => l.id !== lead.id))
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  if (!leads) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (!leads.length) {
    return (
      <EmptyState
        icon={Users}
        title={guest ? 'Sign in to keep Reddit leads' : 'No Reddit leads yet'}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link to="/brew">
                <Search /> Find leads with Brew
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/extension">Use the Chrome extension</Link>
            </Button>
          </div>
        }
      >
        Ask Brew, Grok, Claude, or the Chrome extension to “find Reddit leads for” what you make. They search public posts for people asking for it, explain why each one fits, and save the best here. Nothing messages anyone. Without Reddit API keys, the Chrome extension does the searching in your own browser.
      </EmptyState>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="New" value={count('new')} icon={Users} tone="p2" />
        <Stat label="High fit" value={leads.filter((l) => l.fit === 'high' && l.status !== 'dismissed').length} icon={Sparkles} tone="p4" />
        <Stat label="Engaged" value={count('engaged')} icon={MessageSquareText} tone="p3" />
        <Stat label="Won" value={count('won')} icon={Trophy} tone="p1" />
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Leads</CardTitle>
            <CardDescription>People whose public posts match what you make. Follow up with one helpful public reply, never a direct message.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={filter} onValueChange={(v) => setFilter(v as RedditLeadStatus | 'open')}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open ({leads.filter((l) => l.status !== 'dismissed').length})</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s[0].toUpperCase() + s.slice(1)} ({count(s)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" aria-label="Download as CSV" disabled={!shown.length} onClick={() => downloadCsv(shown)}>
              <Download />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Why they fit</TableHead>
                <TableHead className="hidden lg:table-cell">Found</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="w-8" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell className="align-top">
                    <a className="font-medium hover:underline" href={`https://www.reddit.com/user/${encodeURIComponent(lead.username)}/`} target="_blank" rel="noreferrer">
                      u/{lead.username}
                    </a>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {lead.subreddit && <span>r/{lead.subreddit}</span>}
                      <span className={cn('rounded-md px-1.5 py-0.5 font-medium', FIT_TONE[lead.fit])}>{lead.fit} fit</span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-md align-top whitespace-normal">
                    {lead.reason && <p className="text-sm">{lead.reason}</p>}
                    {lead.postUrl && (
                      <a className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:underline" href={safeLink(lead.postUrl)} target="_blank" rel="noreferrer">
                        <ExternalLink className="size-3 shrink-0" />
                        <span className="truncate">{lead.postTitle || 'Open the post'}</span>
                      </a>
                    )}
                    {!!lead.signals?.length && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {lead.signals.map((s) => (
                          <Badge key={s} variant="outline" className="text-[11px] font-normal">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {lead.notes && <p className="mt-1 text-xs text-muted-foreground">Note: {lead.notes}</p>}
                  </TableCell>
                  <TableCell className="hidden align-top text-xs text-muted-foreground lg:table-cell">
                    {timeAgo(lead.createdAt)}
                    <br />
                    {SOURCE_LABEL[lead.source] || lead.source}
                  </TableCell>
                  <TableCell className="align-top">
                    <Select value={lead.status} onValueChange={(v) => void setStatus(lead, v as RedditLeadStatus)}>
                      <SelectTrigger className="h-8 w-28" aria-label={`Status of u/${lead.username}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  {canManage && (
                    <TableCell className="align-top">
                      <Button variant="ghost" size="icon" aria-label={`Delete lead u/${lead.username}`} onClick={() => void remove(lead)}>
                        <Trash2 />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!shown.length && (
<p className="py-6 text-center text-sm text-muted-foreground">Nothing with this status.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
