// Signing in is optional and only saves runs. The extension shares the Clerk session of the
// Socialbrewery dashboard (syncHost): sign in there, and the extension is signed in too.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ClerkProvider, useAuth, useClerk, useOrganization, useUser } from '@clerk/chrome-extension'

export type Account = {
  /** The server answered with a Clerk key, so signing in is possible. */
  available: boolean
  loaded: boolean
  signedIn: boolean
  email: string
  orgName: string
  getToken: () => Promise<string | null>
  signIn: () => void
  signOut: () => Promise<void>
}

const noToken = async () => null

const OFFLINE: Account = { available: false, loaded: true, signedIn: false, email: '', orgName: '', getToken: noToken, signIn: () => {}, signOut: async () => {} }

const AccountContext = createContext<Account>(OFFLINE)
export const useAccount = () => useContext(AccountContext)

function openDashboard(serverUrl: string, path: string) {
  void chrome.tabs.create({ url: `${serverUrl.replace(/\/$/, '')}${path}` })
}

function ClerkAccount({ serverUrl, children }: { serverUrl: string; children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useAuth()
  const { user } = useUser()
  const { organization } = useOrganization()
  const clerk = useClerk()
  const value = useMemo<Account>(
    () => ({
      available: true,
      loaded: isLoaded,
      signedIn: !!isSignedIn,
      email: user?.primaryEmailAddress?.emailAddress || '',
      orgName: organization?.name || '',
      getToken: () => getToken().catch(() => null),
      signIn: () => openDashboard(serverUrl, '/login'),
      signOut: () => clerk.signOut(),
    }),
    [isLoaded, isSignedIn, user, organization, getToken, clerk, serverUrl],
  )
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
}

/** Fetches the dashboard's Clerk publishable key; without one, the extension just runs signed out. */
export function AccountProvider({ serverUrl, children }: { serverUrl: string; children: ReactNode }) {
  const [key, setKey] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setKey(undefined)
    fetch(`${serverUrl.replace(/\/$/, '')}/api/session`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => !cancelled && setKey(data?.clerk?.configured ? data.clerk.publishableKey || null : null))
      .catch(() => !cancelled && setKey(null))
    return () => {
      cancelled = true
    }
  }, [serverUrl])

  if (key === undefined) return <AccountContext.Provider value={{ ...OFFLINE, loaded: false }}>{children}</AccountContext.Provider>
  if (!key) return <AccountContext.Provider value={OFFLINE}>{children}</AccountContext.Provider>
  let origin = serverUrl
  try {
    origin = new URL(serverUrl).origin
  } catch {
    // Keep it as typed; Clerk reports a bad host.
  }
  return (
    <ClerkProvider publishableKey={key} syncHost={origin}>
      <ClerkAccount serverUrl={serverUrl}>{children}</ClerkAccount>
    </ClerkProvider>
  )
}
