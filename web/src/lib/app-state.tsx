import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  SIGNED_OUT_EVENT,
  allowLinkHost,
  api,
  sendJson,
  type Connectors,
  type Health,
  type OrgSummary,
  type Post,
  type Role,
  type Session,
  type User,
} from '@/lib/api'

type AppState = {
  session: Session | null
  user: User | null
  org: OrgSummary | null
  orgs: OrgSummary[]
  role: Role | null
  canManage: boolean
  health: Health | null
  connectors: Connectors | null
  posts: Post[] | null
  refresh: () => Promise<void>
  refreshPosts: () => Promise<void>
  refreshSession: () => Promise<Session>
  switchOrg: (orgId: string) => Promise<void>
  signOut: () => Promise<void>
}

const AppStateContext = createContext<AppState | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [connectors, setConnectors] = useState<Connectors | null>(null)
  const [posts, setPosts] = useState<Post[] | null>(null)

  const signedIn = session?.authenticated ? session : null
  const org = signedIn?.org ?? null
  const role = org?.role ?? null

  const refreshSession = useCallback(async () => {
    const next = await api<Session>('/api/session')
    setSession(next)
    return next
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
    async (orgId: string) => {
      await sendJson('/api/session/org', 'POST', { orgId })
      setHealth(null)
      setConnectors(null)
      setPosts(null)
      await refreshSession()
    },
    [refreshSession],
  )

  const signOut = useCallback(async () => {
    await sendJson('/auth/logout', 'POST').catch(() => {})
    setHealth(null)
    setConnectors(null)
    setPosts(null)
    setSession({ authenticated: false, providers: session?.providers ?? { google: { enabled: false, redirectUri: '' }, github: { enabled: false, redirectUri: '' } } })
    await refreshSession().catch(() => {})
  }, [refreshSession, session?.providers])

  useEffect(() => {
    refreshSession().catch(() => {})
    const onSignedOut = () => {
      refreshSession().catch(() => {})
    }
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut)
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut)
  }, [refreshSession])

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
        user: signedIn?.user ?? null,
        org,
        orgs: signedIn?.orgs ?? [],
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
