import { OrganizationProfile } from '@clerk/react'
import { Building2, LogIn } from 'lucide-react'
import { PageHeader } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Role } from '@/lib/api'
import { useAppState } from '@/lib/app-state'

const ROLE_HELP: Record<Exclude<Role, 'owner'>, string> = {
  admin: 'Keys, connected accounts, the Grok connector, members, and invites.',
  member: 'Posts, Brew, and analysis with the shared accounts.',
}

// Members, invites, roles, and the name are Clerk's; everything else here belongs to this organisation.
export function OrganisationPage() {
  const { org, orgs, clerkOrgId, canManage, guest, signIn } = useAppState()
  const name = orgs.find((item) => item.id === clerkOrgId)?.name || org?.name

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Organisation"
        title={name || 'Organisation'}
        icon={Building2}
        iconClass="bg-palette text-ink"
        description="Keys, connected accounts, posts, and the Grok connector belong to this organisation. Everyone here posts through them."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 overflow-x-auto">
          {guest ? (
            <Alert>
              <Building2 />
              <AlertTitle>Organisations are for your team</AlertTitle>
              <AlertDescription>
                <p>Sign in to create one, invite teammates, and give each of them a role. Everyone in it posts through the same connected accounts.</p>
                <Button size="sm" className="mt-2" onClick={signIn}>
                  <LogIn /> Sign in
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <OrganizationProfile routing="hash" />
          )}
        </div>
        <div className="space-y-4">
          {!canManage && !guest && (
            <Alert>
              <Building2 />
              <AlertTitle>You are a member</AlertTitle>
              <AlertDescription>You can post and use Brew with this organisation's accounts. An admin manages keys, accounts, and invites.</AlertDescription>
            </Alert>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Roles</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {(Object.keys(ROLE_HELP) as (keyof typeof ROLE_HELP)[]).map((r) => (
                <p key={r}>
                  <span className="font-medium capitalize">{r}</span> <span className="text-muted-foreground">— {ROLE_HELP[r]}</span>
                </p>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
