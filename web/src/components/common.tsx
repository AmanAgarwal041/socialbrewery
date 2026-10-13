import { useState, type ComponentType, type ReactNode, type SVGProps } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function PageHeader({
  eyebrow,
  title,
  description,
  icon: Icon,
  iconClass,
  actions,
}: {
  eyebrow?: string
  title: string
  description?: ReactNode
  icon?: ComponentType<SVGProps<SVGSVGElement>>
  iconClass?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-start gap-4">
        {Icon && (
          <div className={cn('flex size-12 shrink-0 items-center justify-center rounded-2xl shadow-sm', iconClass)}>
            <Icon className="size-6" />
          </div>
        )}
        <div>
          {eyebrow && <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">{eyebrow}</p>}
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed bg-card/60 px-6 py-12 text-center">
      <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-p2-soft text-p2-ink">
        <Icon className="size-6" />
      </div>
      <h3 className="font-medium">{title}</h3>
      {children && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function CopyField({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false)
  const shown = secret ? value.replace(/token=[^&]+/, 'token=••••••••') : value
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success(`${label} copied.`)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast(value)
    }
  }
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2 rounded-xl border bg-muted/60 py-1 pr-1 pl-3">
        <code className="min-w-0 flex-1 truncate font-mono text-xs">{shown || '—'}</code>
        <Button type="button" size="icon-sm" variant="ghost" onClick={copy} disabled={!value} aria-label={`Copy ${label}`}>
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  )
}

export function StatusBadge({
  on,
  loading = false,
  onLabel = 'Connected',
  offLabel = 'Not connected',
}: {
  on: boolean
  loading?: boolean
  onLabel?: string
  offLabel?: string
}) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
        <span className="size-1.5 animate-pulse rounded-full bg-p1" />
        Checking…
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        on ? 'bg-p4-soft text-p4-ink' : 'bg-muted text-muted-foreground',
      )}
    >
      <span className={cn('size-1.5 rounded-full', on ? 'bg-p4-ink' : 'bg-muted-foreground/50')} />
      {on ? onLabel : offLabel}
    </span>
  )
}

export function Stat({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'p1',
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon: ComponentType<SVGProps<SVGSVGElement>>
  tone?: 'p1' | 'p2' | 'p3' | 'p4'
}) {
  const tones = {
    p1: 'bg-p1-soft text-p1-ink',
    p2: 'bg-p2-soft text-p2-ink',
    p3: 'bg-p3-soft text-p3-ink',
    p4: 'bg-p4-soft text-p4-ink',
  }
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-xs">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span className={cn('flex size-8 items-center justify-center rounded-xl', tones[tone])}>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
