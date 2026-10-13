import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Layout } from '@/components/layout'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppStateProvider, useAppState } from '@/lib/app-state'
import { BrewPage } from '@/pages/brew'
import { ConnectorsPage, GrokConnectorPage } from '@/pages/connectors'
import { AuthSplash, InvitePage, LoginPage } from '@/pages/login'
import { NetworkPage } from '@/pages/network'
import { OrganisationPage } from '@/pages/organisation'
import { OverviewPage } from '@/pages/overview'
import { SettingsPage } from '@/pages/settings'

function AppRoutes() {
  const { session, org } = useAppState()
  const { pathname } = useLocation()

  if (pathname.startsWith('/invite/')) {
    return (
      <Routes>
        <Route path="invite/:token" element={<InvitePage />} />
      </Routes>
    )
  }
  if (!session || (session.authenticated && !org)) return <AuthSplash />
  if (!session.authenticated) return <LoginPage />
  if (pathname === '/login') return <Navigate to="/" replace />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<OverviewPage />} />
        <Route path="brew" element={<BrewPage />} />
        <Route path="connectors" element={<ConnectorsPage />} />
        <Route path="connectors/grok" element={<GrokConnectorPage />} />
        <Route path="connectors/:network" element={<NetworkPage />} />
        <Route path="connectors/:network/:tab" element={<NetworkPage />} />
        <Route path="organisation" element={<OrganisationPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppStateProvider>
        <TooltipProvider delayDuration={200}>
          <AppRoutes />
          <Toaster position="bottom-right" richColors={false} />
        </TooltipProvider>
      </AppStateProvider>
    </BrowserRouter>
  )
}
