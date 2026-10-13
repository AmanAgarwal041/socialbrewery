import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Building2, Loader2, MailPlus, Save, Trash2, UserMinus } from 'lucide-react'
import { toast } from 'sonner'
import { CopyField, PageHeader } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { api, safeImage, sendJson, timeAgo, type Invite, type OrgDetails, type Role } from '@/lib/api'
import { useAppState } from '@/lib/app-state'

const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything an admin can do, plus managing owners.',
  admin: 'Keys, connected accounts, and invites.',
  member: 'Posts, Brew, and analysis with the shared accounts.',
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  )
}

export function OrganisationPage() {
  const { user, role, canManage, refreshSession } = useAppState()
  const [details, setDetails] = useState<OrgDetails | null>(null)
  const [name, setName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('member')
  const [inviting, setInviting] = useState(false)
  const [lastLink, setLastLink] = useState<{ email: string; link: string } | null>(null)

  const load = useCallback(async () => {
    const data = await api<OrgDetails>('/api/org')
    setDetails(data)
    setName(data.org.name)
  }, [])

  useEffect(() => {
    load().catch((err) => toast.error(err.message))
  }, [load])

  async function rename(event: FormEvent) {
    event.preventDefault()
    setSavingName(true)
    try {
      await sendJson('/api/org', 'PATCH', { name })
      await Promise.all([load(), refreshSession()])
      toast.success('Organisation renamed.')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSavingName(false)
    }
  }

  async function invite(event: FormEvent) {
    event.preventDefault()
    setInviting(true)
    try {
      const data = await sendJson<{ invite: Invite; link: string }>('/api/org/invites', 'POST', { email, role: inviteRole })
      setLastLink({ email: data.invite.email, link: data.link })
      setEmail('')
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setInviting(false)
    }
  }

  async function act(fn: () => Promise<unknown>, done: string) {
    try {
      await fn()
      await Promise.all([load(), refreshSession()])
      toast.success(done)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const isOwner = role === 'owner'

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Organisation"
        title={details?.org.name || 'Organisation'}
        icon={Building2}
        iconClass="bg-palette text-ink"
        description="Keys, connected accounts, posts, and the Grok connector belong to this organisation. Everyone here posts through them."
      />

      {!details ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="space-y-4 lg:col-span-3">
            <Card>
              <CardHeader>
                <CardTitle>Members</CardTitle>
                <CardDescription>{details.members.length === 1 ? 'Just you so far.' : `${details.members.length} people.`}</CardDescription>
              </CardHeader>
              <CardContent className="divide-y">
                {details.members.map((member) => {
                  const self = member.id === user?.id
                  const canEdit = canManage && !self && (isOwner || member.role !== 'owner')
                  return (
                    <div key={member.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <Avatar>
                        <AvatarImage src={safeImage(member.picture) || undefined} referrerPolicy="no-referrer" />
                        <AvatarFallback>{initials(member.name || member.email)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {member.name || member.email} {self && <span className="text-muted-foreground">(you)</span>}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                      </div>
                      {canEdit ? (
                        <>
                          <Select
                            value={member.role}
                            onValueChange={(next) =>
                              act(() => sendJson(`/api/org/members/${member.id}`, 'PATCH', { role: next }), `${member.name || member.email} is now ${next}.`)
                            }
                          >
                            <SelectTrigger size="sm" className="w-28">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {isOwner && <SelectItem value="owner">Owner</SelectItem>}
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="member">Member</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Remove ${member.email}`}
                            onClick={() => {
                              if (confirm(`Remove ${member.email} from ${details.org.name}?`)) {
                                act(() => sendJson(`/api/org/members/${member.id}`, 'DELETE'), `${member.email} removed.`)
                              }
                            }}
                          >
                            <UserMinus />
                          </Button>
                        </>
                      ) : (
                        <Badge variant="secondary" className="capitalize">
                          {member.role}
                        </Badge>
                      )}
                    </div>
                  )
                })}
              </CardContent>
            </Card>

            {canManage && (
              <Card>
                <CardHeader>
                  <CardTitle>Pending invites</CardTitle>
                  <CardDescription>Invites expire after 14 days. Signing in with the invited email joins automatically.</CardDescription>
                </CardHeader>
                <CardContent className="divide-y">
                  {!details.invites.length && <p className="text-sm text-muted-foreground">No pending invites.</p>}
                  {details.invites.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.email}</p>
                        <p className="text-xs text-muted-foreground">
                          <span className="capitalize">{item.role}</span> · sent {timeAgo(item.createdAt)}
                        </p>
                      </div>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Revoke invite for ${item.email}`}
                        onClick={() => act(() => sendJson(`/api/org/invites/${item.id}`, 'DELETE'), 'Invite revoked.')}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-4 lg:col-span-2">
            {canManage ? (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>Invite someone</CardTitle>
                    <CardDescription>Share the link with them. It only works for that email.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={invite} className="space-y-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="invite-email">Email</Label>
                        <Input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="invite-role">Role</Label>
                        <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as Role)}>
                          <SelectTrigger id="invite-role" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {isOwner && <SelectItem value="owner">Owner</SelectItem>}
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="member">Member</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">{ROLE_HELP[inviteRole]}</p>
                      </div>
                      <Button type="submit" disabled={inviting}>
                        {inviting ? <Loader2 className="animate-spin" /> : <MailPlus />} Create invite
                      </Button>
                    </form>
                    {lastLink && (
                      <div className="mt-4 space-y-1.5">
                        <p className="text-xs text-muted-foreground">Send this link to {lastLink.email}:</p>
                        <CopyField label="Invite link" value={lastLink.link} />
                      </div>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Name</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={rename} className="flex gap-2">
                      <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Organisation name" />
                      <Button type="submit" variant="outline" disabled={savingName || !name.trim() || name === details.org.name}>
                        {savingName ? <Loader2 className="animate-spin" /> : <Save />} Save
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Alert>
                <Building2 />
                <AlertTitle>You are a member</AlertTitle>
                <AlertDescription>You can post and use Brew with this organisation's accounts. An owner or admin manages keys, accounts, and invites.</AlertDescription>
              </Alert>
            )}
            <Card>
              <CardHeader>
                <CardTitle>Roles</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {(Object.keys(ROLE_HELP) as Role[]).map((r) => (
                  <p key={r}>
                    <span className="font-medium capitalize">{r}</span> <span className="text-muted-foreground">— {ROLE_HELP[r]}</span>
                  </p>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
