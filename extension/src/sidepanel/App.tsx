import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, Check, CircleStop, Clapperboard, History, KeyRound, Loader2, Paperclip, Plus, Settings as SettingsIcon, ShieldCheck, Trash2, X } from 'lucide-react'
import { AgentSession } from '@/agent/run'
import { CLAUDE_MODELS } from '@/agent/providers'
import type { ApprovalRequest } from '@/agent/tools'
import { syncRuns } from '@/sync'
import { addFile, deleteRun, listFiles, listRuns, loadSettings, removeFile, saveRun, saveSettings, type MediaFile, type Provider, type Run, type Settings, type Step } from '@/storage'
import { useAccount } from './account'

type View = 'chat' | 'history' | 'settings'
type Pending = ApprovalRequest & { resolve: (ok: boolean) => void }

function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

function Button({ children, variant = 'solid', className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'solid' | 'outline' | 'ghost' | 'danger' }) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4',
        variant === 'solid' && 'bg-p1 text-ink hover:brightness-95',
        variant === 'outline' && 'border border-border bg-card hover:bg-muted',
        variant === 'ghost' && 'hover:bg-muted',
        variant === 'danger' && 'bg-danger text-white hover:brightness-110',
        className,
      )}
    >
      {children}
    </button>
  )
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  )
}

const inputClass = 'w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-p1'

// ---------- approval ----------

function ApprovalCard({ pending }: { pending: Pending }) {
  return (
    <div className="space-y-2 rounded-xl border-2 border-p1 bg-card p-3 shadow-sm">
      <p className="flex items-center gap-1.5 font-medium">
        <ShieldCheck className="size-4" /> Ready to publish on {pending.site || 'this site'}
      </p>
      <p className="text-muted-foreground">
        The agent wants to {pending.action === 'click' ? 'click' : pending.action} <span className="font-medium text-foreground">“{pending.target}”</span>. Check the tab, or the screenshot below, before you approve.
      </p>
      {pending.screenshot && <img src={`data:image/jpeg;base64,${pending.screenshot}`} alt="What the page looks like now" className="max-h-56 w-full rounded-lg border border-border object-contain object-top" />}
      <div className="flex gap-2">
        <Button onClick={() => pending.resolve(true)} className="flex-1">
          <Check /> Approve
        </Button>
        <Button variant="outline" onClick={() => pending.resolve(false)} className="flex-1">
          <X /> Don’t publish
        </Button>
      </div>
    </div>
  )
}

// ---------- steps ----------

function StepView({ step }: { step: Step }) {
  if (step.kind === 'user') return <div className="ml-8 rounded-xl bg-p1-soft px-3 py-2 whitespace-pre-wrap">{step.text}</div>
  if (step.kind === 'assistant') return <div className="mr-4 rounded-xl border border-border bg-card px-3 py-2 whitespace-pre-wrap">{step.text}</div>
  if (step.kind === 'approval')
    return (
      <p className={cn('text-xs', step.approved ? 'text-p4-ink' : 'text-danger')}>
        {step.approved ? '✓ Approved:' : '✕ Declined:'} {step.text}
      </p>
    )
  return <p className={cn('truncate text-xs', step.error ? 'text-danger' : 'text-muted-foreground')}>• {step.text}</p>
}

// ---------- settings ----------

function SettingsView({ settings, onChange }: { settings: Settings; onChange: (next: Settings) => void }) {
  const account = useAccount()
  const [files, setFiles] = useState<MediaFile[]>([])
  const refresh = useCallback(() => listFiles().then(setFiles), [])
  useEffect(() => {
    refresh()
  }, [refresh])
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value })

  return (
    <div className="space-y-5 p-3">
      <section className="space-y-3">
        <h2 className="flex items-center gap-1.5 font-semibold">
          <KeyRound className="size-4" /> Your API keys
        </h2>
        <p className="text-xs text-muted-foreground">Kept only in this browser and sent only to Anthropic or xAI. Signing in never uploads them.</p>
        <Field label="Anthropic API key (Claude)" hint="From console.anthropic.com → API keys.">
          <input className={inputClass} type="password" autoComplete="off" value={settings.anthropicKey} onChange={(e) => set('anthropicKey', e.target.value.trim())} placeholder="sk-ant-…" />
        </Field>
        <Field label="xAI API key (Grok)" hint="From console.x.ai. Also needed to generate video clips.">
          <input className={inputClass} type="password" autoComplete="off" value={settings.xaiKey} onChange={(e) => set('xaiKey', e.target.value.trim())} placeholder="xai-…" />
        </Field>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Models</h2>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Claude model">
            <select className={inputClass} value={settings.claudeModel} onChange={(e) => set('claudeModel', e.target.value)}>
              {CLAUDE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Claude effort">
            <select className={inputClass} value={settings.claudeEffort} onChange={(e) => set('claudeEffort', e.target.value as Settings['claudeEffort'])}>
              {['low', 'medium', 'high', 'xhigh', 'max'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label="Grok model">
            <input className={inputClass} value={settings.grokModel} onChange={(e) => set('grokModel', e.target.value.trim())} />
          </Field>
          <Field label="Grok video model">
            <input className={inputClass} value={settings.grokVideoModel} onChange={(e) => set('grokVideoModel', e.target.value.trim())} />
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Saving your progress</h2>
        {!account.loaded ? (
          <p className="text-xs text-muted-foreground">Checking…</p>
        ) : account.signedIn ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card p-2.5">
            <span className="min-w-0 truncate text-xs">
              Saving to {account.orgName || 'your account'} as {account.email}
            </span>
            <Button variant="ghost" onClick={() => account.signOut()}>
              Sign out
            </Button>
          </div>
        ) : account.available ? (
          <div className="space-y-2 rounded-lg border border-border bg-card p-2.5 text-xs">
            <p className="text-muted-foreground">Everything works without an account. Sign in to Socialbrewery to keep your runs and posts on any device and in your team’s dashboard.</p>
            <Button onClick={account.signIn}>Sign in to save</Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Couldn’t reach Socialbrewery at this address, so runs stay in this browser.</p>
        )}
        <Field label="Socialbrewery address">
          <input className={inputClass} value={settings.serverUrl} onChange={(e) => set('serverUrl', e.target.value.trim())} />
        </Field>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Files</h2>
        {!files.length && <p className="text-xs text-muted-foreground">Attach a video or image in the chat, or ask for a Grok clip.</p>}
        {files.map((f) => (
          <div key={f.id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs">
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            <span className="text-muted-foreground">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
            <button aria-label={`Remove ${f.name}`} onClick={() => removeFile(f.id).then(refresh)}>
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </section>
    </div>
  )
}

// ---------- history ----------

function HistoryView({ onOpen, onChanged }: { onOpen: (run: Run) => void; onChanged: () => void }) {
  const [runs, setRuns] = useState<Run[]>([])
  const refresh = useCallback(() => listRuns().then(setRuns), [])
  useEffect(() => {
    refresh()
  }, [refresh])
  if (!runs.length) return <p className="p-4 text-center text-muted-foreground">No runs yet.</p>
  return (
    <div className="space-y-2 p-3">
      {runs.map((run) => (
        <div key={run.id} className="flex items-start gap-2 rounded-xl border border-border bg-card p-2.5">
          <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(run)}>
            <p className="truncate font-medium">{run.title || 'Untitled'}</p>
            <p className="text-xs text-muted-foreground">
              {new Date(run.updatedAt).toLocaleString()} · {run.provider === 'claude' ? 'Claude' : 'Grok'}
              {run.posts.length ? ` · ${run.posts.length} posted` : ''}
            </p>
          </button>
          <button aria-label="Delete run" className="text-muted-foreground" onClick={() => deleteRun(run.id).then(refresh).then(onChanged)}>
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

// ---------- app ----------

/** The tab the user is looking at; if that is this panel opened as a page, their most recent website tab. */
async function workTab() {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (active?.url && !active.url.startsWith(chrome.runtime.getURL(''))) return active
  const tabs = (await chrome.tabs.query({})).filter((t) => t.id && /^https?:/.test(t.url || ''))
  return tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || active
}

export function App({ settings, setSettings }: { settings: Settings; setSettings: (s: Settings) => void }) {
  const account = useAccount()
  const [view, setView] = useState<View>('chat')
  const [run, setRun] = useState<Run | null>(null)
  const [readOnly, setReadOnly] = useState(false)
  const [input, setInput] = useState('')
  const [progress, setProgress] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState('')
  const [syncNote, setSyncNote] = useState('')
  const session = useRef<AgentSession | null>(null)
  const runRef = useRef<Run | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const bottom = useRef<HTMLDivElement>(null)

  const keyMissing = settings.provider === 'claude' ? !settings.anthropicKey : !settings.xaiKey

  const update = useCallback((fn: (r: Run) => Run) => {
    if (!runRef.current) return
    const next = fn(runRef.current)
    next.updatedAt = Date.now()
    runRef.current = next
    setRun(next)
    void saveRun(next)
  }, [])
  const push = useCallback((step: Step) => update((r) => ({ ...r, steps: [...r.steps, step] })), [update])

  const sync = useCallback(async () => {
    if (!account.signedIn) return
    try {
      await syncRuns(settings.serverUrl, account.getToken)
      setSyncNote('Saved')
    } catch (err) {
      setSyncNote((err as Error).message)
    }
  }, [account, settings.serverUrl])

  useEffect(() => {
    void sync()
  }, [sync])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [run?.steps.length, pending])

  function newChat() {
    session.current?.stop()
    session.current = null
    runRef.current = null
    setRun(null)
    setReadOnly(false)
    setError('')
    setView('chat')
  }

  async function send() {
    const text = input.trim()
    if (!text || session.current?.running) return
    setError('')
    try {
      if (!session.current) {
        const tab = await workTab()
        if (!tab?.id) throw new Error('Open a tab for the agent to work in.')
        session.current = new AgentSession(settings, tab.id)
        const fresh: Run = { id: crypto.randomUUID(), title: text.slice(0, 80), provider: settings.provider, status: 'running', createdAt: Date.now(), updatedAt: Date.now(), steps: [], posts: [] }
        runRef.current = fresh
        setRun(fresh)
        setReadOnly(false)
      }
    } catch (err) {
      setError((err as Error).message)
      return
    }
    setInput('')
    update((r) => ({ ...r, status: 'running', steps: [...r.steps, { kind: 'user', text, at: Date.now() }] }))
    try {
      await session.current.send(text, {
        onText: (t) => push({ kind: 'assistant', text: t, at: Date.now() }),
        onAction: (t, isError) => push({ kind: 'action', text: t, at: Date.now(), error: isError }),
        onProgress: setProgress,
        onPost: (post) => update((r) => ({ ...r, posts: [...r.posts, post] })),
        approve: (request) =>
          new Promise<boolean>((resolve) => {
            setPending({
              ...request,
              resolve: (ok) => {
                setPending(null)
                push({ kind: 'approval', text: `${request.target} on ${request.site}`, at: Date.now(), approved: ok })
                resolve(ok)
              },
            })
          }),
      })
      update((r) => ({ ...r, status: 'done' }))
    } catch (err) {
      const message = (err as Error).message || String(err)
      update((r) => ({ ...r, status: message === 'Stopped.' ? 'stopped' : 'error' }))
      if (message !== 'Stopped.') setError(message)
    } finally {
      setProgress('')
      void sync()
    }
  }

  function stop() {
    pending?.resolve(false)
    session.current?.stop()
  }

  async function attach(files: FileList | null) {
    for (const file of Array.from(files || [])) {
      const saved = await addFile(file, file.name, 'upload')
      if (runRef.current) push({ kind: 'action', text: `Attached ${saved.name} (file id ${saved.id})`, at: Date.now() })
      setInput((v) => `${v}${v ? '\n' : ''}[Attached ${saved.name}, file id ${saved.id}]`)
    }
  }

  const running = !!progress || !!session.current?.running

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="bg-palette flex size-7 items-center justify-center rounded-lg text-ink">
          <Clapperboard className="size-4" />
        </span>
        <span className="font-semibold">Socialbrewery</span>
        <div className="ml-auto flex items-center gap-1">
          <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Model">
            {(['claude', 'grok'] as Provider[]).map((p) => (
              <button
                key={p}
                disabled={running}
                onClick={() => {
                  setSettings({ ...settings, provider: p })
                  newChat()
                }}
                className={cn('rounded-md px-2 py-0.5 text-xs font-medium', settings.provider === p ? 'bg-p1 text-ink' : 'text-muted-foreground')}
              >
                {p === 'claude' ? 'Claude' : 'Grok'}
              </button>
            ))}
          </div>
          <Button variant="ghost" className="px-2" aria-label="New chat" onClick={newChat}>
            <Plus />
          </Button>
          <Button variant="ghost" className={cn('px-2', view === 'history' && 'bg-muted')} aria-label="History" onClick={() => setView(view === 'history' ? 'chat' : 'history')}>
            <History />
          </Button>
          <Button variant="ghost" className={cn('px-2', view === 'settings' && 'bg-muted')} aria-label="Settings" onClick={() => setView(view === 'settings' ? 'chat' : 'settings')}>
            <SettingsIcon />
          </Button>
        </div>
      </header>

      {account.loaded && account.available && !account.signedIn && view === 'chat' && (
        <div className="flex items-center gap-2 border-b border-border bg-p2-soft px-3 py-1.5 text-xs text-p2-ink">
          <span className="flex-1">Works without an account. Sign in to save your runs.</span>
          <button className="font-medium underline" onClick={account.signIn}>
            Sign in
          </button>
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto">
        {view === 'settings' && <SettingsView settings={settings} onChange={setSettings} />}
        {view === 'history' && (
          <HistoryView
            onOpen={(r) => {
              session.current = null
              runRef.current = r
              setRun(r)
              setReadOnly(true)
              setView('chat')
            }}
            onChanged={() => void sync()}
          />
        )}
        {view === 'chat' && (
          <div className="space-y-2 p-3">
            {!run && (
              <div className="space-y-3 rounded-xl border border-border bg-card p-4">
                <p className="font-medium">Tell {settings.provider === 'claude' ? 'Claude' : 'Grok'} what to post.</p>
                <p className="text-muted-foreground">
                  It works in this tab with the accounts you’re already signed in to: YouTube, LinkedIn, Instagram, X, Reddit, Slack, and Hashnode. It fills everything in, then waits for you to approve before anything is published.
                </p>
                <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                  <li>“Write a LinkedIn post about our launch and post it.”</li>
                  <li>“Make an 8-second clip of steam over coffee and upload it to YouTube as an unlisted Short.”</li>
                  <li>“Post this thread on X: …”</li>
                </ul>
                {keyMissing && (
                  <Button variant="outline" onClick={() => setView('settings')}>
                    <KeyRound /> Add your {settings.provider === 'claude' ? 'Anthropic' : 'xAI'} key
                  </Button>
                )}
              </div>
            )}
            {run?.steps.map((step, i) => <StepView key={i} step={step} />)}
            {run?.posts.map((post) => (
              <a key={post.url} href={post.url} target="_blank" rel="noreferrer" className="block rounded-lg bg-p4-soft px-3 py-2 text-xs text-p4-ink underline">
                Posted on {post.network}: {post.title}
              </a>
            ))}
            {pending && <ApprovalCard pending={pending} />}
            {progress && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> {progress}
              </p>
            )}
            {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
            {syncNote && syncNote !== 'Saved' && <p className="text-[11px] text-muted-foreground">{syncNote}</p>}
            <div ref={bottom} />
          </div>
        )}
      </main>

      {view === 'chat' && (
        <footer className="border-t border-border p-2">
          {readOnly ? (
            <Button variant="outline" className="w-full" onClick={newChat}>
              <Plus /> Start a new chat
            </Button>
          ) : (
            <div className="rounded-xl border border-border bg-card focus-within:ring-2 focus-within:ring-p1">
              <textarea
                rows={3}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
                placeholder={keyMissing ? 'Add your API key in Settings first' : 'What should it post, and where?'}
                className="block w-full resize-none bg-transparent px-3 py-2 outline-none"
              />
              <div className="flex items-center gap-1 px-2 pb-2">
                <input ref={fileInput} type="file" accept="video/*,image/*" multiple hidden onChange={(e) => void attach(e.target.files).then(() => (e.target.value = ''))} />
                <Button variant="ghost" className="px-2" aria-label="Attach a video or image" onClick={() => fileInput.current?.click()}>
                  <Paperclip />
                </Button>
                <span className="flex-1" />
                {running ? (
                  <Button variant="danger" onClick={stop}>
                    <CircleStop /> Stop
                  </Button>
                ) : (
                  <Button onClick={() => void send()} disabled={!input.trim() || keyMissing} aria-label="Send">
                    <ArrowUp />
                  </Button>
                )}
              </div>
            </div>
          )}
        </footer>
      )}
    </div>
  )
}

export function useSettings() {
  const [settings, setSettingsState] = useState<Settings | null>(null)
  useEffect(() => {
    loadSettings().then(setSettingsState)
  }, [])
  const setSettings = useCallback((next: Settings) => {
    setSettingsState(next)
    void saveSettings(next)
  }, [])
  return { settings, setSettings }
}
