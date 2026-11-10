import { useEffect } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { AppSidebar, OrgSwitch, SidebarBrand } from '@/components/app-sidebar'
import { ScopeSeparator, ShellProvider, topBar, useShell } from '@/components/shell-context'
import { Button } from '@/components/ui/button'
import { useAppState } from '@/lib/app-state'
import { NETWORKS, networkById } from '@/lib/networks'
import { type NetworkId } from '@/lib/api'
import { useAssistant } from '@/lib/assistant'
import { cn } from '@/lib/utils'

const TAB_LABELS: Record<string, string> = {
  overview: 'Overview',
  posts: 'Posts',
  compose: 'Compose',
  leads: 'Leads',
  analysis: 'Analysis',
  connection: 'Connection',
}

function crumbs(pathname: string): { label: string; to?: string }[] {
  const parts = pathname.split('/').filter(Boolean)
  if (!parts.length || parts[0] === 'overview') return [{ label: 'Overview' }]
  if (parts[0] === 'brew') return [{ label: 'Brew' }]
  if (parts[0] === 'settings') return [{ label: 'Settings' }]
  if (parts[0] === 'organisation') return [{ label: 'Organisation' }]
  if (parts[0] === 'extension') return [{ label: 'Chrome extension' }]
  if (parts[0] === 'email') {
    if (parts[1] !== 'campaigns') return [{ label: 'Email' }, { label: 'Leads' }]
    return parts[2]
      ? [{ label: 'Email', to: '/email' }, { label: 'Campaigns', to: '/email/campaigns' }, { label: 'Campaign' }]
      : [{ label: 'Email', to: '/email' }, { label: 'Campaigns' }]
  }
  if (parts[0] === 'connectors') {
    if (!parts[1]) return [{ label: 'Connectors' }]
    if (parts[1] === 'grok') return [{ label: 'Connectors', to: '/connectors' }, { label: 'Grok connector' }]
    if (parts[1] === 'claude') return [{ label: 'Connectors', to: '/connectors' }, { label: 'Claude connector' }]
    const network = networkById[parts[1] as NetworkId]
    if (network) {
      return [{ label: 'Connectors', to: '/connectors' }, { label: network.name, to: `/connectors/${network.id}` }, { label: TAB_LABELS[parts[2] || 'overview'] || 'Overview' }]
    }
  }
  return [{ label: 'Socialbrewery' }]
}

function StatusPills() {
  const { health } = useAppState()
  const assistant = useAssistant(health)
  if (!health) return null
  const items = [{ label: assistant.label, on: assistant.ready }, ...NETWORKS.map((n) => ({ label: n.name, on: Boolean(health[`${n.id}Connected` as const]) }))]
  return (
    <div className="hidden items-center gap-1 xl:flex">
      {items.map((item) => (
        <span
          key={item.label}
          className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium', item.on ? 'bg-p4-soft text-p4-ink' : 'bg-muted text-muted-foreground')}
        >
          <span className={cn('size-1.5 rounded-full', item.on ? 'bg-p4-ink' : 'bg-muted-foreground/40')} />
          {item.label}
        </span>
      ))}
    </div>
  )
}

// The page trail after the organisation: "Acme / Connectors / Reddit / Leads".
function PageTrail({ pathname }: { pathname: string }) {
  const trail = crumbs(pathname)
  return (
    <>
      {trail.map((crumb, index) => {
        const last = index === trail.length - 1
        return (
          <span key={crumb.label} className={cn('contents', !last && 'max-sm:hidden')}>
            <ScopeSeparator />
            {crumb.to && !last ? (
              <Link to={crumb.to} className="max-w-40 truncate text-xs font-medium text-muted-foreground hover:text-foreground">
                {crumb.label}
              </Link>
            ) : (
              <span className="max-w-56 truncate text-xs font-semibold" aria-current="page">
                {crumb.label}
              </span>
            )}
          </span>
        )
      })}
    </>
  )
}

function HeaderContextRow() {
  const location = useLocation()
  const { guest, signIn } = useAppState()
  return (
    <div className={topBar('min-w-0 flex-1 gap-x-2 pr-3 pl-6')}>
      <OrgSwitch />
      <PageTrail pathname={location.pathname} />
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {!guest && <StatusPills />}
        {guest && (
          <Button size="sm" onClick={signIn}>
            Sign in
          </Button>
        )}
      </div>
    </div>
  )
}

function Frame() {
  const location = useLocation()
  const { guest } = useAppState()
  const { columnClass } = useShell()
  const fullBleed = location.pathname.startsWith('/brew')

  return (
    <div className="flex h-svh w-full flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 border-b">
        <div className={cn('relative shrink-0 border-r transition-[width] duration-200', columnClass)}>
          <SidebarBrand />
        </div>
        <HeaderContextRow />
      </header>
      <div className="flex min-h-0 flex-1">
        <div className={cn('relative z-30 flex shrink-0 flex-col border-r transition-[width] duration-200', columnClass)}>
          <AppSidebar />
        </div>
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {guest && (
            <div className="shrink-0 border-b bg-p2-soft px-4 py-1.5 text-center text-xs text-p2-ink">
              You're exploring Socialbrewery. Sign in to add keys, connect accounts, and post.
            </div>
          )}
          <div className={cn('min-h-0 flex-1', fullBleed ? 'flex flex-col' : 'overflow-y-auto')}>
            {fullBleed ? (
              <Outlet />
            ) : (
              <div className="mx-auto w-full max-w-7xl px-4 py-4 md:px-6 md:py-5">
                <Outlet />
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

export function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { refresh } = useAppState()

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const notice = params.get('notice')
    if (notice) {
      toast(notice)
      refresh().catch(() => {})
      navigate(location.pathname === '/' ? '/connectors' : location.pathname, { replace: true })
    }
  }, [location.search, location.pathname, navigate, refresh])

  return (
    <ShellProvider>
      <Frame />
    </ShellProvider>
  )
}
