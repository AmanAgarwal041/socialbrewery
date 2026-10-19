import { ASSISTANTS, type Assistant } from '@/lib/assistant'
import type { Health } from '@/lib/api'
import { cn } from '@/lib/utils'

// Small tabs under a prompt box: pick who answers. Switching relabels the page and routes the next
// message to that assistant. A muted dot means its API key isn't set yet.
export function AssistantTabs({
  value,
  onChange,
  health,
  disabled,
  className,
  tone = 'default',
}: {
  value: Assistant
  onChange: (a: Assistant) => void
  health?: Health | null
  disabled?: boolean
  className?: string
  tone?: 'default' | 'onBrand'
}) {
  return (
    <div role="tablist" aria-label="Assistant" className={cn('inline-flex items-center gap-0.5 rounded-full p-0.5', tone === 'onBrand' ? 'bg-white/50' : 'bg-muted', className)}>
      {ASSISTANTS.map((a) => {
        const selected = a.id === value
        const ready = health?.agents ? health.agents[a.id] : undefined
        return (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={disabled}
            onClick={() => onChange(a.id)}
            title={ready === false ? `Add your ${a.keyName} API key in Settings to use ${a.label}` : `Ask ${a.label}`}
            className={cn(
              'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors disabled:opacity-60',
              selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              tone === 'onBrand' && !selected && 'text-ink/70 hover:text-ink',
            )}
          >
            <span aria-hidden className={cn('size-1.5 rounded-full', ready === false ? 'bg-muted-foreground/40' : a.id === 'claude' ? 'bg-[#d97757]' : 'bg-foreground/80')} />
            {a.label}
          </button>
        )
      })}
    </div>
  )
}
