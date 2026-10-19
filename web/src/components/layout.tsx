import { useEffect } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { AppSidebar } from '@/components/app-sidebar'
import { Button } from '@/components/ui/button'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { useAppState } from '@/lib/app-state'
import { NETWORKS, networkById } from '@/lib/networks'
import { agentLabel, type NetworkId } from '@/lib/api'
import { cn } from '@/lib/utils'

const TAB_LABELS: Record<string, string> = {
  overview: 'Overview',
  posts: 'Posts',
  compose: 'Compose',
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
  if (parts[0] === 'connectors') {
    if (!parts[1]) return [{ label: 'Connectors' }]
    if (parts[1] === 'grok') return [{ label: 'Connectors', to: '/connectors' }, { label: 'Grok connector' }]
    if (parts[1] === 'claude') return [{ label: 'Connectors', to: '/connectors' }, { label: 'Claude connector' }]
    const network = networkById[parts[1] as NetworkId]
    if (network) {
      return [
        { label: 'Connectors', to: '/connectors' },
        { label: network.name, to: `/connectors/${network.id}` },
        { label: TAB_LABELS[parts[2] || 'overview'] || 'Overview' },
      ]
    }
  }
  return [{ label: 'Socialbrewery' }]
}

function StatusPills() {
  const { health } = useAppState()
  if (!health) return null
  const items = [
    { label: agentLabel(health), on: Boolean(health.agentReady) },
    ...NETWORKS.map((n) => ({ label: n.name, on: Boolean(health[`${n.id}Connected` as const]) })),
  ]
  return (
    <div className="hidden items-center gap-1.5 xl:flex">
      {items.map((item) => (
        <span
          key={item.label}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
            item.on ? 'bg-p4-soft text-p4-ink' : 'bg-muted text-muted-foreground',
          )}
        >
          <span className={cn('size-1.5 rounded-full', item.on ? 'bg-p4-ink' : 'bg-muted-foreground/40')} />
          {item.label}
        </span>
      ))}
    </div>
  )
}

export function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { refresh, guest, signIn } = useAppState()

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const notice = params.get('notice')
    if (notice) {
      toast(notice)
      refresh().catch(() => {})
      navigate(location.pathname === '/' ? '/connectors' : location.pathname, { replace: true })
    }
  }, [location.search, location.pathname, navigate, refresh])

  const trail = crumbs(location.pathname)
  const fullBleed = location.pathname.startsWith('/brew')

  return (
    <SidebarProvider className="h-svh">
      <AppSidebar />
      <SidebarInset className="bg-brew min-h-0 overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <Breadcrumb className="min-w-0">
            <BreadcrumbList className="flex-nowrap truncate">
              {trail.map((crumb, index) => (
                <span key={crumb.label} className="contents">
                  {index > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem>
                    {crumb.to ? (
                      <BreadcrumbLink asChild>
                        <Link to={crumb.to}>{crumb.label}</Link>
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                </span>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-3">
            {!guest && <StatusPills />}
            {guest && (
              <Button size="sm" onClick={signIn}>
                Sign in
              </Button>
            )}
          </div>
        </header>
        {guest && (
          <div className="shrink-0 border-b border-border/60 bg-p2-soft px-4 py-2 text-center text-sm text-p2-ink">
            You're exploring Socialbrewery. Sign in to add keys, connect accounts, and post.
          </div>
        )}
        <div className={cn('min-h-0 flex-1', fullBleed ? 'flex flex-col' : 'overflow-y-auto')}>
          {fullBleed ? (
            <Outlet />
          ) : (
            <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
              <Outlet />
            </div>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
