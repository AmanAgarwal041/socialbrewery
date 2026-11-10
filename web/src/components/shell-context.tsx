import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'

// The app frame's sidebar: 16rem wide when expanded, 4rem (icons only) when collapsed. On phones the
// column stays 4rem and the expanded sidebar floats over the page instead of squeezing it.

type ShellContextValue = {
  expanded: boolean
  isMobile: boolean
  toggle: () => void
  collapse: () => void
  /** Width of the brand cell and the sidebar column. */
  columnClass: string
}

const ShellContext = createContext<ShellContextValue | null>(null)
const STORAGE_KEY = 'socialbrewery.sidebar'

function savedExpanded() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'collapsed'
  } catch {
    return true
  }
}

export function ShellProvider({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile()
  const [preferred, setPreferred] = useState(savedExpanded)
  const [mobileOpen, setMobileOpen] = useState(false)

  const expanded = isMobile ? mobileOpen : preferred

  const toggle = useCallback(() => {
    if (isMobile) return setMobileOpen((open) => !open)
    setPreferred((value) => {
      try {
        localStorage.setItem(STORAGE_KEY, value ? 'collapsed' : 'expanded')
      } catch {
        // The choice just won't be remembered.
      }
      return !value
    })
  }, [isMobile])

  const collapse = useCallback(() => {
    if (isMobile) setMobileOpen(false)
  }, [isMobile])

  const value = useMemo(() => ({ expanded, isMobile, toggle, collapse, columnClass: !isMobile && expanded ? 'w-64' : 'w-16' }), [expanded, isMobile, toggle, collapse])
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
}

export function useShell() {
  const context = useContext(ShellContext)
  if (!context) throw new Error('useShell must be used inside ShellProvider')
  return context
}

export const TOP_BAR_CLASS = 'flex h-11 shrink-0 items-center'

export function topBar(className?: string) {
  return cn(TOP_BAR_CLASS, className)
}

/** The "/" between scope items in the top bar. */
export function ScopeSeparator() {
  return <span className="shrink-0 px-0.5 text-xs text-muted-foreground/60">/</span>
}
