import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth, useClerk, useOrganizationList, useUser } from '@clerk/react'
import { SIGNED_OUT_EVENT, allowLinkHost, api, type Connectors, type Health, type OrgSummary, type Post, type Role, type Session, type User } from '@/lib/api'

// A Clerk organisation the user belongs to. `id` is Clerk's organisation id.
export type ClerkOrg = { id: string; name: string; role: Role }

type AppState = {
  session: Session | null
  sessionError: string
  user: User | null
  org: OrgSummary | null
  clerkOrgId: string | null
  orgs: ClerkOrg[]
  role: Role | null
  canManage: boolean
  health: Health | null
  connectors: Connectors | null
  posts: Post[] | null
  refresh: () => Promise<void>
  refreshPosts: () => Promise<void>
  refreshSession: () => Promise<Session>
  switchOrg: (clerkOrgId: string) => Promise<void>
  signOut: () => Promise<void>
}

const AppStateContext = createContext<AppState | null>(null)

function clerkRole(role: string): Role {
  const name = role.replace(/^org:/, '')
  return name === 'owner' || name === 'admin' ? name : 'member'
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const { isSignedIn, orgId: clerkOrgId } = useAuth()
  const { user: clerkUser } = useUser()
  const clerk = useClerk()
  const { userMemberships, setActive } = useOrganizationList({ userMemberships: { infinite: true, pageSize: 50 } })
  const [session, setSession] = useState<Session | null>(null)
  const [sessionError, setSessionError] = useState('')
  const [health, setHealth] = useState<Health | null>(null)
  const [connectors, setConnectors] = useState<Connectors | null>(null)
  const [posts, setPosts] = useState<Post[] | null>(null)

  const org = session?.authenticated ? session.org : null
  const role = org?.role ?? null

  const user = useMemo<User | null>(() => {
    if (!clerkUser) return null
    const email = clerkUser.primaryEmailAddress?.emailAddress || ''
    return { id: clerkUser.id, email, name: clerkUser.fullName || clerkUser.username || email, picture: clerkUser.imageUrl || '' }
  }, [clerkUser])

  const orgs = useMemo<ClerkOrg[]>(
    () => (userMemberships.data || []).map((m) => ({ id: m.organization.id, name: m.organization.name, role: clerkRole(m.role) })),
    [userMemberships.data],
  )

  const refreshSession = useCallback(async () => {
    try {
      const next = await api<Session>('/api/session')
      setSession(next)
      setSessionError('')
      return next
    } catch (err) {
      setSessionError((err as Error).message)
      throw err
    }
  }, [])

  const refreshPosts = useCallback(async () => {
    const data = await api<{ posts: Post[] }>('/api/posts')
    setPosts(data.posts)
  }, [])

  const refresh = useCallback(async () => {
    await Promise.all([
      api<Health>('/api/health').then(setHealth),
      api<Connectors>('/api/connectors').then((next) => {
        allowLinkHost(next.hashnode?.account?.publication?.url)
        setConnectors(next)
      }),
    ])
  }, [])

  const switchOrg = useCallback(
    async (next: string) => {
      if (!setActive) return
      await setActive({ organization: next })
    },
    [setActive],
  )

  const signOut = useCallback(async () => {
    await clerk.signOut({ redirectUrl: '/' })
  }, [clerk])

  // Whatever Clerk says is the active organisation (switcher, invite accepted, created) is the one the
  // server acts in, so start over whenever it changes.
  useEffect(() => {
    setSession(null)
    setHealth(null)
    setConnectors(null)
    setPosts(null)
    if (isSignedIn && clerkOrgId) refreshSession().catch(() => {})
  }, [isSignedIn, clerkOrgId, refreshSession])

  useEffect(() => {
    const onSignedOut = () => {
      if (isSignedIn && clerkOrgId) refreshSession().catch(() => {})
    }
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut)
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut)
  }, [isSignedIn, clerkOrgId, refreshSession])

  const orgId = org?.id
  useEffect(() => {
    if (!orgId) return
    refresh().catch(() => {})
    refreshPosts().catch(() => {})
  }, [orgId, refresh, refreshPosts])

  return (
    <AppStateContext.Provider
      value={{
        session,
        sessionError,
        user,
        org,
        clerkOrgId: clerkOrgId ?? null,
        orgs,
        role,
        canManage: role === 'owner' || role === 'admin',
        health,
        connectors,
        posts,
        refresh,
        refreshPosts,
        refreshSession,
        switchOrg,
        signOut,
      }}
    >
      {children}
    </AppStateContext.Provider>
  )
}

export function useAppState() {
  const value = useContext(AppStateContext)
  if (!value) throw new Error('useAppState must be used inside AppStateProvider')
  return value
}
