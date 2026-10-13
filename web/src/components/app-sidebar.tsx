import { useState, type FormEvent } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Building2, Check, ChevronRight, ChevronsUpDown, LayoutDashboard, LogOut, Plug, Plus, Settings, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { BrewIcon } from '@/components/brand-icons'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
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
import { safeImage, sendJson } from '@/lib/api'
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

function NewOrgDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { refreshSession } = useAppState()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  async function create(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      await sendJson('/api/orgs', 'POST', { name })
      await refreshSession()
      onOpenChange(false)
      setName('')
      navigate('/settings')
      toast.success(`${name} created. Add its keys next.`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={create} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New organisation</DialogTitle>
            <DialogDescription>It starts empty, with its own keys, connected accounts, posts, and Grok connector. You are its owner.</DialogDescription>
          </DialogHeader>
          <Input autoFocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme marketing" aria-label="Organisation name" />
          <DialogFooter>
            <Button type="submit" disabled={saving || !name.trim()}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function OrgSwitcher() {
  const { org, orgs, switchOrg } = useAppState()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
            <div className="bg-palette flex aspect-square size-8 items-center justify-center rounded-xl text-ink shadow-sm">
              <BrewIcon className="size-5" />
            </div>
            <div className="grid flex-1 text-left leading-tight">
              <span className="truncate font-semibold">{org?.name || 'Socialbrewery'}</span>
              <span className="truncate text-xs text-muted-foreground capitalize">{org ? `${org.role} · Socialbrewery` : 'Posting studio'}</span>
            </div>
            <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Organisations</DropdownMenuLabel>
          {orgs.map((item) => (
            <DropdownMenuItem
              key={item.id}
              onSelect={() => {
                if (item.id === org?.id) return
                switchOrg(item.id)
                  .then(() => navigate('/'))
                  .catch((err) => toast.error(err.message))
              }}
            >
              <Building2 />
              <span className="flex-1 truncate">{item.name}</span>
              {item.id === org?.id && <Check className="size-4" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate('/organisation')}>
            <Settings /> Manage organisation
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus /> New organisation
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewOrgDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}

function UserMenu() {
  const { user, signOut } = useAppState()
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
        <DropdownMenuItem onSelect={() => signOut()}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AppSidebar() {
  const { health, connectors, posts } = useAppState()
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
              <SidebarMenuButton asChild isActive={pathname === '/'} tooltip="Overview">
                <NavLink to="/" end>
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
                                {t.tab === 'posts' && count > 0 && (
                                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">{count}</span>
                                )}
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
                  <StatusDot
                    on={Boolean(connectors && !connectors.grok.localOnly)}
                    className="ml-auto group-data-[collapsible=icon]:hidden"
                  />
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
