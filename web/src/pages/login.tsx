import { useEffect, useState, type ReactNode } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Building2, CircleAlert, KeyRound, Loader2, MailCheck } from 'lucide-react'
import { toast } from 'sonner'
import { BrewIcon, GithubIcon, GoogleIcon } from '@/components/brand-icons'
import { CopyField } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { api, sendJson, type Providers } from '@/lib/api'
import { useAppState } from '@/lib/app-state'

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-brew flex min-h-svh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-4">
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

function ProviderButtons({ providers, invite }: { providers: Providers; invite?: string }) {
  const query = invite ? `?invite=${encodeURIComponent(invite)}` : ''
  return (
    <div className="grid gap-2">
      {providers.google.enabled && (
        <Button asChild size="lg" variant="outline">
          <a href={`/auth/google${query}`}>
            <GoogleIcon className="size-4" /> Continue with Google
          </a>
        </Button>
      )}
      {providers.github.enabled && (
        <Button asChild size="lg" variant="outline">
          <a href={`/auth/github${query}`}>
            <GithubIcon className="size-4" /> Continue with GitHub
          </a>
        </Button>
      )}
    </div>
  )
}

function OperatorSetup({ providers }: { providers: Providers }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" /> Set up sign-in
        </CardTitle>
        <CardDescription>
          No sign-in provider is configured yet. Whoever runs this server adds one OAuth app to <code className="font-mono text-xs">.env</code>, then
          restarts Socialbrewery.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-2">
          <p className="font-medium">GitHub</p>
          <p className="text-muted-foreground">
            github.com → Settings → Developer settings → OAuth Apps → New OAuth App. Set these, then copy the client ID and a new client secret.
          </p>
          <CopyField label="Authorization callback URL" value={providers.github.redirectUri} />
          <code className="block rounded-lg bg-muted px-3 py-2 font-mono text-xs">GITHUB_AUTH_CLIENT_ID=…</code>
          <code className="block rounded-lg bg-muted px-3 py-2 font-mono text-xs">GITHUB_AUTH_CLIENT_SECRET=…</code>
        </div>
        <div className="space-y-2">
          <p className="font-medium">Google</p>
          <p className="text-muted-foreground">
            Google Cloud console → APIs &amp; Services → Credentials → Create OAuth client ID (Web application). Add this redirect URI.
          </p>
          <CopyField label="Authorized redirect URI" value={providers.google.redirectUri} />
          <code className="block rounded-lg bg-muted px-3 py-2 font-mono text-xs">GOOGLE_AUTH_CLIENT_ID=…</code>
          <code className="block rounded-lg bg-muted px-3 py-2 font-mono text-xs">GOOGLE_AUTH_CLIENT_SECRET=…</code>
        </div>
      </CardContent>
    </Card>
  )
}

export function LoginPage() {
  const { session } = useAppState()
  const [params] = useSearchParams()
  const error = params.get('error')
  const providers = session?.providers
  const any = providers && (providers.google.enabled || providers.github.enabled)

  return (
    <Shell>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Sign in</CardTitle>
          <CardDescription>
            Keys and connected accounts belong to your organisation. Your first sign-in creates one; teammates join by invite.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>Sign-in did not finish</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {!providers ? (
            <div className="flex justify-center py-4">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : any ? (
            <ProviderButtons providers={providers} />
          ) : (
            <p className="text-center text-sm text-muted-foreground">Sign-in is not set up on this server yet.</p>
          )}
        </CardContent>
      </Card>
      {providers && !any && <OperatorSetup providers={providers} />}
    </Shell>
  )
}

export function InvitePage() {
  const { token = '' } = useParams()
  const { session, refreshSession } = useAppState()
  const [invite, setInvite] = useState<{ orgName: string; email: string; role: string } | null>(null)
  const [error, setError] = useState('')
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    api<{ invite: { orgName: string; email: string; role: string } }>(`/api/invites/lookup?token=${encodeURIComponent(token)}`)
      .then((data) => setInvite(data.invite))
      .catch((err) => setError(err.message))
  }, [token])

  async function join() {
    setJoining(true)
    try {
      await sendJson('/api/invites/accept', 'POST', { token })
      await refreshSession()
      toast.success(`You joined ${invite?.orgName}.`)
      window.location.replace('/')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setJoining(false)
    }
  }

  const signedIn = session?.authenticated ? session : null

  return (
    <Shell>
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-2xl bg-p2-soft text-p2-ink">
            <Building2 className="size-6" />
          </div>
          <CardTitle className="text-2xl">{invite ? `Join ${invite.orgName}` : 'Organisation invite'}</CardTitle>
          {invite && (
            <CardDescription>
              Invited as <span className="font-medium text-foreground">{invite.role}</span>. Sign in with an account that uses{' '}
              <span className="font-medium text-foreground">{invite.email}</span>.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>Can't use this invite</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {invite && signedIn && (
            <div className="space-y-3">
              <p className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-sm">
                <MailCheck className="size-4 shrink-0" /> Signed in as {signedIn.user.email}
              </p>
              <Button className="w-full" size="lg" onClick={join} disabled={joining}>
                {joining && <Loader2 className="animate-spin" />} Join {invite.orgName}
              </Button>
            </div>
          )}
          {invite && session && !session.authenticated && <ProviderButtons providers={session.providers} invite={token} />}
        </CardContent>
      </Card>
    </Shell>
  )
}

export function AuthSplash() {
  return (
    <div className="bg-brew flex min-h-svh items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  )
}
