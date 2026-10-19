import { useClerk } from '@clerk/react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Building2, Check, ChevronRight, ChevronsUpDown, CircleUser, LayoutDashboard, LogOut, Plug, Plus, Puzzle, Settings, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { BrewIcon } from '@/components/brand-icons'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { safeImage } from '@/lib/api'
import { useAppState } from '@/lib/app-state'
import { NETWORKS, SLOT_CLASSES, networkState } from '@/lib/networks'
import { cn } from '@/lib/utils'

const NETWORK_TABS = [
  { tab: 'overview', label: 'Overview' },
  { tab: 'posts', label: 'Posts' },
  { tab: 'compose', label: 'Compose' },
  { tab: 'analysis', label: 'Analysis' },
  { tab: 'connection', label: 'Connection' },
]

function StatusDot({ on, className }: { on: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('size-2 shrink-0 rounded-full', on ? 'bg-p4-ink/70 ring-2 ring-p4' : 'bg-muted-foreground/30', className)}
    />
  )
}

function OrgSwitcher() {
  const { org, clerkOrgId, orgs, switchOrg, guest, signIn } = useAppState()
  const clerk = useClerk()
  const navigate = useNavigate()
  const name = orgs.find((item) => item.id === clerkOrgId)?.name || org?.name

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
          <div className="bg-palette flex aspect-square size-8 items-center justify-center rounded-xl text-ink shadow-sm">
            <BrewIcon className="size-5" />
          </div>
          <div className="grid flex-1 text-left leading-tight">
            <span className="truncate font-semibold">{name || 'Socialbrewery'}</span>
            <span className="truncate text-xs text-muted-foreground capitalize">
              {guest ? 'Exploring · Posting studio' : org ? `${org.role} · Socialbrewery` : 'Posting studio'}
            </span>
          </div>
          <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {guest ? (
          <DropdownMenuItem onSelect={signIn}>
            <Plus /> Sign in to create an organisation
          </DropdownMenuItem>
        ) : (
          <>
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
            <DropdownMenuItem
              onSelect={() =>
                clerk.openCreateOrganization({
                  afterCreateOrganizationUrl: '/settings',
                })
              }
            >
              <Plus /> New organisation
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UserMenu() {
  const { user, signOut, guest, signIn } = useAppState()
  const clerk = useClerk()
  if (guest) {
    return (
      <SidebarMenuButton size="lg" tooltip="Sign in" onClick={signIn}>
        <CircleUser className="size-5" />
        <div className="grid flex-1 text-left text-sm leading-tight">
          <span className="truncate font-medium">Sign in</span>
          <span className="truncate text-xs text-muted-foreground">Save keys, connect accounts, post</span>
        </div>
      </SidebarMenuButton>
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
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" tooltip={user.email}>
          <Avatar className="size-8 rounded-lg">
            <AvatarImage src={safeImage(user.picture) || undefined} referrerPolicy="no-referrer" />
            <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{user.name || user.email}</span>
            <span className="truncate text-xs text-muted-foreground">{user.email}</span>
          </div>
          <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
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

export function AppSidebar() {
  const { health, connectors, posts, guest } = useAppState()
  const { pathname } = useLocation()

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <OrgSwitcher />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Studio</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === '/' || pathname === '/overview'} tooltip="Overview">
                <NavLink to={guest ? '/overview' : '/'} end>
                  <LayoutDashboard />
                  <span>Overview</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname.startsWith('/brew')} tooltip="Brew with Grok">
                <NavLink to="/brew">
                  <Sparkles />
                  <span>Brew</span>
                </NavLink>
              </SidebarMenuButton>
              {!health?.xai && health && <SidebarMenuBadge className="text-destructive">key</SidebarMenuBadge>}
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname.startsWith('/extension')} tooltip="Chrome extension">
                <NavLink to="/extension">
                  <Puzzle />
                  <span>Chrome extension</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Connectors</SidebarGroupLabel>
          <SidebarMenu>
            {NETWORKS.map((network) => {
              const state = networkState(network.id, health, connectors)
              const base = `/connectors/${network.id}`
              const active = pathname.startsWith(base)
              const count = posts?.filter((p) => (p.network || 'youtube') === network.id).length ?? 0
              return (
                <Collapsible key={network.id} asChild defaultOpen={active} className="group/collapsible">
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton tooltip={network.name} isActive={active}>
                        <span className={cn('flex size-5 items-center justify-center rounded-md', SLOT_CLASSES[network.slot].chip)}>
                          <network.icon className="size-3.5" />
                        </span>
                        <span>{network.name}</span>
                        <StatusDot on={state.connected} className="ml-auto group-data-[collapsible=icon]:hidden" />
                        <ChevronRight className="transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {NETWORK_TABS.map((t) => (
                          <SidebarMenuSubItem key={t.tab}>
                            <SidebarMenuSubButton asChild isActive={pathname === `${base}/${t.tab}` || (t.tab === 'overview' && pathname === base)}>
                              <NavLink to={`${base}/${t.tab}`}>
                                <span>{t.label}</span>
                                {t.tab === 'posts' && count > 0 && <span className="ml-auto text-xs tabular-nums text-muted-foreground">{count}</span>}
                              </NavLink>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              )
            })}
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname.startsWith('/connectors/grok')} tooltip="Grok connector">
                <NavLink to="/connectors/grok">
                  <span className={cn('flex size-5 items-center justify-center rounded-md', SLOT_CLASSES.p4.chip)}>
                    <Plug className="size-3.5" />
                  </span>
                  <span>Grok connector</span>
                  <StatusDot on={Boolean(connectors && !connectors.grok.localOnly)} className="ml-auto group-data-[collapsible=icon]:hidden" />
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname.startsWith('/connectors/claude')} tooltip="Claude connector">
                <NavLink to="/connectors/claude">
                  <span className={cn('flex size-5 items-center justify-center rounded-md', SLOT_CLASSES.p4.chip)}>
                    <Plug className="size-3.5" />
                  </span>
                  <span>Claude connector</span>
                  <StatusDot on={Boolean(connectors && !connectors.grok.localOnly)} className="ml-auto group-data-[collapsible=icon]:hidden" />
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === '/connectors'} tooltip="All connectors">
                <NavLink to="/connectors" end>
                  <Plug />
                  <span>All connectors</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname.startsWith('/organisation')} tooltip="Organisation">
              <NavLink to="/organisation">
                <Building2 />
                <span>Organisation</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname.startsWith('/settings')} tooltip="Settings">
              <NavLink to="/settings">
                <Settings />
                <span>Settings</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <UserMenu />
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="bg-palette h-1.5 rounded-full opacity-80 group-data-[collapsible=icon]:hidden" aria-hidden />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
