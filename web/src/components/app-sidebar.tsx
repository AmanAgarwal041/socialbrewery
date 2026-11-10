import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useClerk } from '@clerk/react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Building2,
  Check,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  CircleUser,
  LayoutDashboard,
  LogOut,
  Mail,
  Palette,
  Plug,
  Plus,
  Puzzle,
  Search,
  Settings,
  Sparkles,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { BrewIcon } from '@/components/brand-icons'
import { useShell, topBar } from '@/components/shell-context'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { safeImage } from '@/lib/api'
import { useAssistant } from '@/lib/assistant'
import { useAppState } from '@/lib/app-state'
import { NETWORKS, SLOT_CLASSES, networkState } from '@/lib/networks'
import { cn } from '@/lib/utils'

type NavItem = {
  label: string
  to: string
  icon: ReactNode
  active: boolean
  /** Connected (true), not connected (false), or no status (undefined). */
  status?: boolean
  /** Extra words the ⌘K search matches. */
  keywords?: string
}

type NavGroup = { title: string; items: NavItem[] }

const ITEM_CLASS =
  'flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const IDLE_CLASS = 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground'
const ACTIVE_CLASS = 'bg-sidebar-accent text-sidebar-accent-foreground'

function Chip({ className, children }: { className: string; children: ReactNode }) {
  return <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-md', className)}>{children}</span>
}

function StatusDot({ on }: { on: boolean }) {
  return <span aria-hidden className={cn('ml-auto size-1.5 shrink-0 rounded-full', on ? 'bg-p4-ink/70 ring-2 ring-p4' : 'bg-muted-foreground/30')} />
}

/** Everything the sidebar links to, built once per render from the app state. */
function useNav() {
  const { health, connectors, guest } = useAppState()
  const { pathname } = useLocation()
  return useMemo(() => {
    const home = guest ? '/overview' : '/'
    const primary: NavItem[] = [
      { label: 'Overview', to: home, icon: <LayoutDashboard className="size-4" />, active: pathname === '/' || pathname === '/overview', keywords: 'home dashboard' },
      { label: 'Email', to: '/email', icon: <Mail className="size-4" />, active: pathname.startsWith('/email'), keywords: 'campaigns leads newsletter' },
      { label: 'Chrome extension', to: '/extension', icon: <Puzzle className="size-4" />, active: pathname.startsWith('/extension'), keywords: 'browser side panel' },
    ]
    const networks: NavItem[] = NETWORKS.map((network) => ({
      label: network.name,
      to: `/connectors/${network.id}`,
      icon: (
        <Chip className={SLOT_CLASSES[network.slot].chip}>
          <network.icon className="size-3.5" />
        </Chip>
      ),
      active: pathname.startsWith(`/connectors/${network.id}`),
      status: networkState(network.id, health, connectors).connected,
      keywords: `${network.noun} posts compose analysis${network.id === 'reddit' ? ' leads research' : ''}`,
    }))
    const connected = Boolean(connectors && !connectors.grok.localOnly)
    const ai: NavItem[] = [
      {
        label: 'Grok connector',
        to: '/connectors/grok',
        icon: (
          <Chip className={SLOT_CLASSES.p4.chip}>
            <Plug className="size-3.5" />
          </Chip>
        ),
        active: pathname.startsWith('/connectors/grok'),
        status: connected,
        keywords: 'mcp xai',
      },
      {
        label: 'Claude connector',
        to: '/connectors/claude',
        icon: (
          <Chip className={SLOT_CLASSES.p4.chip}>
            <Plug className="size-3.5" />
          </Chip>
        ),
        active: pathname.startsWith('/connectors/claude'),
        status: connected,
        keywords: 'mcp anthropic',
      },
      { label: 'All connectors', to: '/connectors', icon: <Plug className="size-4" />, active: pathname === '/connectors', keywords: 'networks integrations' },
    ]
    const settings: NavItem[] = [
      { label: 'Organisation', to: '/organisation', icon: <Building2 className="size-4" />, active: pathname.startsWith('/organisation'), keywords: 'members invites team' },
      { label: 'Settings', to: '/settings', icon: <Settings className="size-4" />, active: pathname.startsWith('/settings'), keywords: 'keys palette theme colors' },
    ]
    const groups: NavGroup[] = [
      { title: 'Networks', items: networks },
      { title: 'AI connectors', items: ai },
    ]
    return { home, primary, groups, settings }
  }, [health, connectors, guest, pathname])
}

function NavLinkItem({ item, compact, onNavigate }: { item: NavItem; compact: boolean; onNavigate?: () => void }) {
  const link = (
    <Link
      to={item.to}
      onClick={onNavigate}
      aria-current={item.active ? 'page' : undefined}
      className={cn(ITEM_CLASS, compact && 'justify-center px-2', item.active ? ACTIVE_CLASS : IDLE_CLASS)}
    >
      {item.icon}
      <span className={cn('min-w-0 truncate', compact && 'sr-only')}>{item.label}</span>
      {!compact && item.status !== undefined && <StatusDot on={item.status} />}
    </Link>
  )
  if (!compact) return link
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {item.label}
        {item.status !== undefined && (item.status ? ' · connected' : ' · not connected')}
      </TooltipContent>
    </Tooltip>
  )
}

// ---------- top-left brand cell ----------

export function SidebarBrand() {
  const { expanded, isMobile, toggle } = useShell()
  const label = expanded ? 'Collapse sidebar' : 'Expand sidebar'
  return (
    <div className={topBar('relative gap-2 px-3')}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            onClick={toggle}
            aria-label={label}
            aria-expanded={expanded}
            className="absolute top-1/2 -right-3 z-50 size-6 -translate-y-1/2 rounded-full border-border bg-background p-0 text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground"
          >
            {expanded ? <ChevronsLeft className="size-3.5" /> : <ChevronsRight className="size-3.5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={10}>
          {label}
        </TooltipContent>
      </Tooltip>
      <Link to="/" aria-label="Socialbrewery home" className="bg-palette flex size-8 shrink-0 items-center justify-center rounded-lg text-ink shadow-sm">
        <BrewIcon className="size-5" />
      </Link>
      <p className={cn('min-w-0 truncate text-base font-semibold transition-opacity', (!expanded || isMobile) && 'pointer-events-none invisible opacity-0')}>Socialbrewery</p>
    </div>
  )
}

// ---------- organisation switcher (top bar) ----------

export function OrgSwitch() {
  const { org, clerkOrgId, orgs, switchOrg, guest, signIn } = useAppState()
  const clerk = useClerk()
  const navigate = useNavigate()
  const name = orgs.find((item) => item.id === clerkOrgId)?.name || org?.name

  if (guest) {
    return (
      <button onClick={signIn} className="inline-flex shrink-0 items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground">
        Exploring <ChevronsUpDown className="size-3" />
      </button>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex max-w-52 min-w-0 shrink-0 items-center gap-1 rounded-sm text-xs font-medium text-foreground/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none">
        <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{name || 'Organisation'}</span>
        {org && <span className="hidden text-muted-foreground capitalize sm:inline">· {org.role}</span>}
        <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Organisations</DropdownMenuLabel>
        {orgs.map((item) => (
          <DropdownMenuItem
            key={item.id}
            onSelect={() => {
              if (item.id === clerkOrgId) return
              switchOrg(item.id)
                .then(() => navigate('/'))
                .catch((err) => toast.error(err.message))
            }}
          >
            <Building2 />
            <span className="flex-1 truncate">{item.name}</span>
            {item.id === clerkOrgId && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/organisation')}>
          <Settings /> Manage organisation
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => clerk.openCreateOrganization({ afterCreateOrganizationUrl: '/settings' })}>
          <Plus /> New organisation
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ---------- user (sidebar footer) ----------

function UserActions({ compact }: { compact: boolean }) {
  const { user, signOut, guest, signIn } = useAppState()
  const clerk = useClerk()
  const trigger = 'flex w-full items-center gap-2 rounded-lg p-2 text-left text-[13px] text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground'

  if (guest) {
    return (
      <button onClick={signIn} className={cn(trigger, compact && 'justify-center')} aria-label="Sign in">
        <CircleUser className="size-5 shrink-0" />
        {!compact && (
          <span className="grid min-w-0 flex-1 leading-tight">
            <span className="truncate font-medium text-foreground">Sign in</span>
            <span className="truncate text-xs">Save keys, connect accounts, post</span>
          </span>
        )}
      </button>
    )
  }
  if (!user) return null
  const initials = (user.name || user.email)
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(trigger, compact && 'justify-center')} aria-label="Account">
        <Avatar className="size-6 rounded-lg">
          <AvatarImage src={safeImage(user.picture) || undefined} referrerPolicy="no-referrer" />
          <AvatarFallback className="rounded-lg text-[10px]">{initials}</AvatarFallback>
        </Avatar>
        {!compact && (
          <>
            <span className="grid min-w-0 flex-1 leading-tight">
              <span className="truncate font-medium text-foreground">{user.name || user.email}</span>
              <span className="truncate text-xs">{user.email}</span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={4} className="min-w-56">
        <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => clerk.openUserProfile()}>
          <CircleUser /> Account
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => signOut()}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ---------- ⌘K search ----------

function NavSearch({ open, onOpenChange, items, onNavigate }: { open: boolean; onOpenChange: (open: boolean) => void; items: NavItem[]; onNavigate: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogTitle className="sr-only">Search Socialbrewery</DialogTitle>
        {open && (
          <SearchBody
            items={items}
            onPick={() => {
              onOpenChange(false)
              onNavigate()
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function SearchBody({ items, onPick }: { items: NavItem[]; onPick: () => void }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return items.filter((item) => words.every((w) => `${item.label} ${item.keywords || ''}`.toLowerCase().includes(w)))
  }, [items, query])

  function go(item?: NavItem) {
    if (!item) return
    onPick()
    navigate(item.to)
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIndex(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIndex((i) => Math.min(i + 1, results.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIndex((i) => Math.max(i - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              go(results[index])
            }
          }}
          placeholder="Search Socialbrewery…"
          aria-label="Search pages"
          className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="max-h-80 overflow-y-auto p-1.5" role="listbox" aria-label="Pages">
        {results.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">No pages match.</p>}
        {results.map((item, i) => (
          <button
            key={item.to}
            role="option"
            aria-selected={i === index}
            onMouseEnter={() => setIndex(i)}
            onClick={() => go(item)}
            className={cn('flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-[13px]', i === index ? 'bg-accent text-accent-foreground' : 'text-foreground/80')}
          >
            {item.icon}
            <span className="flex-1 truncate">{item.label}</span>
            {item.status !== undefined && <span className="text-xs text-muted-foreground">{item.status ? 'Connected' : 'Not connected'}</span>}
          </button>
        ))}
      </div>
    </>
  )
}

// ---------- sidebar ----------

export function AppSidebar() {
  const { health } = useAppState()
  const assistant = useAssistant(health)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { expanded, isMobile, collapse } = useShell()
  const nav = useNav()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const compact = !expanded
  const onBrew = pathname.startsWith('/brew')

  const searchItems = useMemo<NavItem[]>(
    () => [
      ...nav.primary,
      { label: `Brew with ${assistant.label}`, to: '/brew', icon: <Sparkles className="size-4" />, active: onBrew, keywords: 'chat agent write post ai' },
      ...nav.groups.flatMap((g) => g.items),
      ...nav.settings,
    ],
    [nav, assistant.label, onBrew],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
      if (event.key === 'Escape') setSettingsOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Any navigation from the sidebar closes the settings panel and, on phones, the sidebar itself.
  const closeAll = useCallback(() => {
    setSettingsOpen(false)
    collapse()
  }, [collapse])

  const settingsActive = nav.settings.some((item) => item.active)
  const settingsButton = (
    <button
      aria-expanded={settingsOpen}
      onClick={() => setSettingsOpen((open) => !open)}
      className={cn(ITEM_CLASS, compact && 'justify-center px-2', settingsOpen || settingsActive ? ACTIVE_CLASS : IDLE_CLASS)}
    >
      <Settings className="size-4 shrink-0" />
      {compact ? (
        <span className="sr-only">Settings</span>
      ) : (
        <>
          <span>Settings</span>
          <ChevronRight className="ml-auto size-4" />
        </>
      )}
    </button>
  )

  return (
    <aside
      aria-label="Main navigation"
      className={cn(
        'flex h-full min-h-0 flex-col bg-sidebar',
        // On phones the expanded sidebar floats over the page.
        isMobile && expanded ? 'absolute inset-y-0 left-0 z-40 w-64 border-r shadow-xl' : 'relative w-full',
      )}
    >
      {(settingsOpen || (isMobile && expanded)) && (
        <button aria-label="Close navigation panel" className={cn('fixed inset-y-0 right-0 z-30 cursor-default bg-ink/15', expanded ? 'left-64' : 'left-16')} onClick={closeAll} />
      )}
      <div className="relative z-40 flex h-full min-h-0 flex-col">
        <div className="px-2 pt-3 pb-3">
          <button
            onClick={() => setSearchOpen(true)}
            aria-label="Search pages"
            className={cn(
              'flex h-9 w-full items-center gap-2 rounded-lg border bg-transparent px-2.5 text-[13px] text-muted-foreground hover:bg-sidebar-accent/50',
              compact && 'justify-center px-2',
            )}
          >
            <Search className="size-4 shrink-0" />
            {!compact && (
              <>
                <span className="flex-1 text-left">Search</span>
                <kbd className="rounded border px-1 py-0.5 text-[10px]">⌘K</kbd>
              </>
            )}
          </button>
        </div>

        {expanded ? (
          <div className="mx-2 grid grid-cols-2 gap-1 rounded-lg border bg-muted/70 p-1">
            <button
              onClick={() => {
                closeAll()
                navigate(nav.home)
              }}
              className={cn(
                'h-8 rounded-md px-2 text-[13px] font-medium text-muted-foreground hover:bg-background/70 hover:text-foreground',
                !onBrew && 'bg-background text-foreground shadow-sm',
              )}
            >
              Browse
            </button>
            <Link
              to="/brew"
              onClick={closeAll}
              className={cn(
                'relative flex h-8 items-center justify-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-muted-foreground hover:bg-background/70 hover:text-foreground',
                onBrew && 'bg-background text-foreground shadow-sm',
              )}
            >
              <Sparkles className="size-4 shrink-0" />
              Brew
              {!assistant.ready && health && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-destructive" aria-label="Add a key to use Brew" />}
            </Link>
          </div>
        ) : (
          <div className="px-2">
            <NavLinkItem compact onNavigate={closeAll} item={{ label: `Brew with ${assistant.label}`, to: '/brew', icon: <Sparkles className="size-4" />, active: onBrew }} />
          </div>
        )}

        <nav className="flex min-h-0 grow flex-col gap-3 overflow-y-auto px-2 py-2" aria-label="Pages">
          <div className="flex flex-col gap-0.5">
            {nav.primary.map((item) => (
              <NavLinkItem key={item.to} item={item} compact={compact} onNavigate={closeAll} />
            ))}
            {compact ? (
              <Tooltip>
                <TooltipTrigger asChild>{settingsButton}</TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  Settings
                </TooltipContent>
              </Tooltip>
            ) : (
              settingsButton
            )}
          </div>
          {nav.groups.map((group) => (
            <div key={group.title} className="flex flex-col gap-0.5">
              {compact ? <div className="mx-2 my-1 border-t" /> : <p className="px-2.5 pt-1 pb-0.5 text-xs font-semibold tracking-wide text-muted-foreground">{group.title}</p>}
              {group.items.map((item) => (
                <NavLinkItem key={item.to} item={item} compact={compact} onNavigate={closeAll} />
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t p-2">
          <UserActions compact={compact} />
        </div>
      </div>

      {settingsOpen && (
        <div className="absolute inset-y-0 left-full z-40 flex w-[min(18rem,calc(100vw-4rem))] flex-col border-y border-r bg-sidebar shadow-xl">
          <div className="flex items-center justify-between border-b px-3 py-2.5">
            <p className="flex items-center gap-2 text-[15px] font-semibold">
              <Settings className="size-4" /> Settings
            </p>
            <Button variant="ghost" size="icon-sm" onClick={() => setSettingsOpen(false)} aria-label="Close settings panel">
              <X />
            </Button>
          </div>
          <div className="flex flex-col gap-0.5 overflow-y-auto p-2">
            {nav.settings.map((item) => (
              <NavLinkItem key={item.to} item={item} compact={false} onNavigate={closeAll} />
            ))}
          </div>
          <Link
            to="/settings#organisation"
            onClick={closeAll}
            className="mt-auto flex items-center justify-between border-t px-3 py-2.5 text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            <span className="flex items-center gap-2">
              <Palette className="size-4" /> Appearance
            </span>
            <span className="bg-palette h-3 w-10 rounded-full" aria-hidden />
          </Link>
        </div>
      )}

      <NavSearch open={searchOpen} onOpenChange={setSearchOpen} items={searchItems} onNavigate={closeAll} />
    </aside>
  )
}
