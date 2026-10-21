import { useCallback, useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ClerkProvider, useAuth, useClerk } from '@clerk/react'
import { Layout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { ClerkConfig, Session } from '@/lib/api'
import { AppStateProvider, useAppState } from '@/lib/app-state'
import { BrewPage } from '@/pages/brew'
import { LandingPage } from '@/pages/landing'
import { AiConnectorPage, ConnectorsPage } from '@/pages/connectors'
import { ExtensionPage } from '@/pages/extension'
import { EmailCampaignPage, EmailCampaignsPage, EmailLeadsPage } from '@/pages/email'
import { AuthSplash, ChooseOrgPage, LoginPage, SetupPage } from '@/pages/login'
import { NetworkPage } from '@/pages/network'
import { OrganisationPage } from '@/pages/organisation'
import { OverviewPage } from '@/pages/overview'
import { SettingsPage } from '@/pages/settings'

function AppRoutes() {
  const { isLoaded, isSignedIn, orgId } = useAuth({ treatPendingAsSignedOut: false })
  const clerk = useClerk()
  const pending = clerk.session?.status === 'pending'
  const { session, sessionError, org, refreshSession } = useAppState()
  const { pathname } = useLocation()

  if (!isLoaded) return <AuthSplash />
  if (!isSignedIn) {
    // Signed out: the landing page at /, sign-in at /login, and every other route explores the dashboard.
    if (pathname === '/login') return <LoginPage />
    if (pathname === '/') return <LandingPage />
    return <DashboardRoutes />
  }
  if (pending || !orgId) return <ChooseOrgPage pending={pending} />
  if (!session && sessionError) return <AuthSplash error={sessionError} onRetry={() => refreshSession().catch(() => {})} />
  if (session && !session.authenticated) {
    return (
      <AuthSplash
        error="You are signed in to Clerk, but this server did not accept the session. Check that CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY belong to the same Clerk application and that APP_URL matches the address in your browser."
        onRetry={() => refreshSession().catch(() => {})}
        action={
          <Button variant="ghost" onClick={() => clerk.signOut({ redirectUrl: '/' })}>
            Sign out
          </Button>
        }
      />
    )
  }
  if (!org) return <AuthSplash />
  if (pathname === '/login') return <Navigate to="/" replace />
  return <DashboardRoutes />
}

// Signed in, or exploring as a guest: the same pages either way. Guests reach the overview at /overview,
// because / is the landing page for them.
function DashboardRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<OverviewPage />} />
        <Route path="overview" element={<OverviewPage />} />
        <Route path="brew" element={<BrewPage />} />
        <Route path="connectors" element={<ConnectorsPage />} />
        <Route path="connectors/grok" element={<AiConnectorPage client="grok" />} />
        <Route path="connectors/claude" element={<AiConnectorPage client="claude" />} />
        <Route path="extension" element={<ExtensionPage />} />
        <Route path="email" element={<EmailLeadsPage />} />
        <Route path="email/campaigns" element={<EmailCampaignsPage />} />
        <Route path="email/campaigns/:id" element={<EmailCampaignPage />} />
        <Route path="connectors/:network" element={<NetworkPage />} />
        <Route path="connectors/:network/:tab" element={<NetworkPage />} />
        <Route path="organisation" element={<OrganisationPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

// The publishable key comes from the server, so one build of the dashboard works with any Clerk application.
function ClerkApp() {
  const navigate = useNavigate()
  const [clerk, setClerk] = useState<ClerkConfig | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await fetch('/api/session')
      const data = (await res.json().catch(() => ({}))) as Partial<Session> & { error?: string }
      if (!res.ok || !data.clerk) throw new Error(data.error || `The server answered ${res.status}.`)
      setClerk(data.clerk)
    } catch (err) {
      setError((err as Error).message || 'The server did not answer.')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (error) return <AuthSplash error={error} onRetry={load} />
  if (!clerk) return <AuthSplash />
  if (!clerk.configured || !clerk.publishableKey) return <SetupPage />

  return (
    <ClerkProvider
      publishableKey={clerk.publishableKey}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      afterSignOutUrl="/"
    >
      <AppStateProvider>
        <TooltipProvider delayDuration={200}>
          <AppRoutes />
          <Toaster position="bottom-right" richColors={false} />
        </TooltipProvider>
      </AppStateProvider>
    </ClerkProvider>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ClerkApp />
    </BrowserRouter>
  )
}
