import type { ReactNode } from 'react'
import { OrganizationList, SignIn, TaskChooseOrganization, useClerk } from '@clerk/react'
import { KeyRound, Loader2 } from 'lucide-react'
import { BrewIcon } from '@/components/brand-icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-brew flex min-h-svh items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-md flex-col items-center space-y-4">
        <div className="flex items-center justify-center gap-3">
          <span className="bg-palette flex size-10 items-center justify-center rounded-2xl text-ink shadow-sm">
            <BrewIcon className="size-6" />
          </span>
          <span className="text-xl font-semibold tracking-tight">Socialbrewery</span>
        </div>
        {children}
      </div>
    </div>
  )
}

// Clerk's sign-in, with sign-up in the same card. Invitation links from Clerk land here too.
export function LoginPage() {
  return (
    <Shell>
      <SignIn routing="hash" withSignUp fallbackRedirectUrl="/" />
      <p className="max-w-sm text-center text-xs text-muted-foreground">
        Keys and connected accounts belong to an organisation. Create one after signing in, or accept an invite from a teammate.
      </p>
    </Shell>
  )
}

// Signed in, but no organisation is active yet. When the Clerk instance requires one, the session is
// pending on Clerk's "choose an organisation" task; otherwise the user picks or creates one here.
export function ChooseOrgPage({ pending }: { pending: boolean }) {
  const clerk = useClerk()
  return (
    <Shell>
      {pending ? (
        <TaskChooseOrganization redirectUrlComplete="/" />
      ) : (
        <OrganizationList hidePersonal afterSelectOrganizationUrl="/" afterCreateOrganizationUrl="/settings" />
      )}
      <Button variant="ghost" size="sm" onClick={() => clerk.signOut({ redirectUrl: '/' })}>
        Sign out
      </Button>
    </Shell>
  )
}

export function SetupPage() {
  return (
    <Shell>
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" /> Set up sign-in
          </CardTitle>
          <CardDescription>
            Sign-in and organisations run on Clerk, and this server has no Clerk keys yet. Whoever runs it adds them to{' '}
            <code className="font-mono text-xs">.env</code> (or Worker secrets), then restarts Socialbrewery.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
            <li>Create an application at dashboard.clerk.com and choose the sign-in methods you want.</li>
            <li>Turn on Organizations (Configure → Organizations).</li>
            <li>Copy the keys from API keys:</li>
          </ol>
          <code className="block rounded-lg bg-muted px-3 py-2 font-mono text-xs">CLERK_PUBLISHABLE_KEY=pk_…</code>
          <code className="block rounded-lg bg-muted px-3 py-2 font-mono text-xs">CLERK_SECRET_KEY=sk_…</code>
        </CardContent>
      </Card>
    </Shell>
  )
}

export function AuthSplash({ error, onRetry, action }: { error?: string; onRetry?: () => void; action?: ReactNode }) {
  if (error) {
    return (
      <div className="bg-brew flex min-h-svh items-center justify-center p-6">
        <div className="max-w-md space-y-4 rounded-2xl border bg-card p-6 text-center shadow-sm">
          <p className="font-medium">Socialbrewery can't start yet</p>
          <p className="text-sm break-words text-muted-foreground">{error}</p>
          <div className="flex justify-center gap-2">
            {onRetry && (
              <Button variant="outline" onClick={onRetry}>
                Try again
              </Button>
            )}
            {action}
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="bg-brew flex min-h-svh items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  )
}
