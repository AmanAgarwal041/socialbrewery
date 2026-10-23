import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type FormEvent,
  type ReactNode,
  type SVGProps,
} from "react";
import {
  AudioLines,
  Bot,
  Building2,
  CheckCircle2,
  CircleDashed,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Palette as PaletteIcon,
  Plug,
  RotateCcw,
  Save,
  Send,
  Settings as SettingsIcon,
  Share2,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  HashnodeIcon,
  InstagramIcon,
  LinkedinIcon,
  RedditIcon,
  SlackIcon,
  XIcon,
  YoutubeIcon,
} from "@/components/brand-icons";
import { PageHeader } from "@/components/common";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  api,
  postJson,
  sendJson,
  type SettingField,
  type Settings,
} from "@/lib/api";
import { useAppState } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import {
  PALETTE,
  PRESETS,
  applyPalette,
  resetPalette,
  savedPalette,
  type Palette,
} from "@/theme";

type Group = {
  id: string;
  title: string;
  description: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  tone: string;
  keys: string[];
  // Keys that must be set for the badge to say "Connected". Empty: always optional.
  required: string[][];
  wide?: boolean;
};

const GROUPS: Group[] = [
  {
    id: "grok-ai",
    title: "Grok (xAI)",
    description:
      "Runs Brew and writes drafts when the assistant is Grok. Every assistant uses it to generate clips.",
    icon: Bot,
    tone: "bg-p1-soft text-p1-ink",
    keys: ["AGENT_PROVIDER", "XAI_API_KEY", "XAI_MODEL", "XAI_VIDEO_MODEL"],
    required: [["XAI_API_KEY"]],
    wide: true,
  },
  {
    id: "claude",
    title: "Claude (Anthropic)",
    description: "Used when the assistant or the reviews are set to Claude.",
    icon: Bot,
    tone: "bg-p2-soft text-p2-ink",
    keys: ["ANTHROPIC_API_KEY", "CLAUDE_MODEL"],
    required: [["ANTHROPIC_API_KEY"]],
  },
  {
    id: "openai",
    title: "Reviews and OpenAI",
    description:
      "Who writes performance reviews, and the OpenAI key if that is OpenAI.",
    icon: Bot,
    tone: "bg-p3-soft text-p3-ink",
    keys: ["ANALYSIS_PROVIDER", "OPENAI_API_KEY", "OPENAI_MODEL"],
    required: [],
  },
  {
    id: "elevenlabs",
    title: "ElevenLabs",
    description:
      "Voiceovers for Video Studio. Without it, a local Kokoro install is used if present.",
    icon: AudioLines,
    tone: "bg-p4-soft text-p4-ink",
    keys: ["ELEVENLABS_API_KEY"],
    required: [["ELEVENLABS_API_KEY"]],
  },
  {
    id: "youtube",
    title: "YouTube",
    description: "OAuth client from Google Cloud.",
    icon: YoutubeIcon,
    tone: "bg-p1-soft text-p1-ink",
    keys: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"],
    required: [["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"]],
  },
  {
    id: "linkedin",
    title: "LinkedIn",
    description: "App credentials from LinkedIn Developers.",
    icon: LinkedinIcon,
    tone: "bg-p3-soft text-p3-ink",
    keys: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
    required: [["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"]],
  },
  {
    id: "instagram",
    title: "Instagram",
    description:
      "Instagram API with Instagram Login, from the Meta App Dashboard.",
    icon: InstagramIcon,
    tone: "bg-p2-soft text-p2-ink",
    keys: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"],
    required: [["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"]],
  },
  {
    id: "x",
    title: "X",
    description: "OAuth 2.0 client from the X Developer Console.",
    icon: XIcon,
    tone: "bg-p4-soft text-p4-ink",
    keys: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
    required: [["X_CLIENT_ID"]],
  },
  {
    id: "hashnode",
    title: "Hashnode",
    description:
      "Personal access token. API access needs the blog on Hashnode Pro.",
    icon: HashnodeIcon,
    tone: "bg-p1-soft text-p1-ink",
    keys: ["HASHNODE_TOKEN", "HASHNODE_PUBLICATION"],
    required: [["HASHNODE_TOKEN"]],
  },
  {
    id: "slack",
    title: "Slack",
    description: "Bot token from your Slack app, after Install to Workspace.",
    icon: SlackIcon,
    tone: "bg-p2-soft text-p2-ink",
    keys: ["SLACK_BOT_TOKEN", "SLACK_DEFAULT_CHANNEL"],
    required: [["SLACK_BOT_TOKEN"]],
  },
  {
    id: "reddit",
    title: "Reddit",
    description:
      "Optional. Reddit works without keys. Web app credentials from reddit.com/prefs/apps.",
    icon: RedditIcon,
    tone: "bg-p3-soft text-p3-ink",
    keys: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"],
    required: [],
  },
  {
    id: "grok",
    title: "Public connector URL",
    description:
      "Public tunnel URL for grok.com, claude.ai and Instagram when the server runs on localhost.",
    icon: Plug,
    tone: "bg-p4-soft text-p4-ink",
    keys: ["MCP_PUBLIC_URL"],
    required: [],
  },
];

const EMAIL_SHARED = ["EMAIL_POSTAL_ADDRESS", "EMAIL_REPLY_TO"];
const EMAIL_RESEND = ["RESEND_API_KEY", "EMAIL_FROM", "RESEND_WEBHOOK_SECRET"];
const EMAIL_SMTP = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURITY",
  "SMTP_USERNAME",
  "SMTP_PASSWORD",
  "SMTP_FROM_NAME",
  "SMTP_FROM_EMAIL",
];

type TabId = "ai" | "social" | "email" | "connector" | "organisation";
const TABS: {
  id: TabId;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  description: string;
  groups: string[];
}[] = [
  {
    id: "ai",
    label: "AI models",
    icon: Bot,
    description: "Grok, Claude, OpenAI and ElevenLabs keys.",
    groups: ["grok-ai", "claude", "openai", "elevenlabs"],
  },
  {
    id: "social",
    label: "Social accounts",
    icon: Share2,
    description:
      "App credentials for each network. Connect the accounts themselves on the Connectors page.",
    groups: [
      "youtube",
      "linkedin",
      "instagram",
      "x",
      "hashnode",
      "slack",
      "reddit",
    ],
  },
  {
    id: "email",
    label: "Email",
    icon: Mail,
    description:
      "How campaigns reach your leads: Resend or your own SMTP server.",
    groups: [],
  },
  {
    id: "connector",
    label: "Connector / MCP",
    icon: Plug,
    description: "Let Grok and Claude use Socialbrewery as a connector.",
    groups: ["grok"],
  },
  {
    id: "organisation",
    label: "Organisation",
    icon: Building2,
    description: "Members, roles and how the dashboard looks.",
    groups: [],
  },
];
const TAB_IDS = new Set<string>(TABS.map((t) => t.id));
// Old links (/settings#youtube, /settings#email) still land on the right tab.
function tabFor(hash: string): TabId {
  const id = hash.replace(/^#/, "");
  if (TAB_IDS.has(id)) return id as TabId;
  if (id === "email") return "email";
  return TABS.find((t) => t.groups.includes(id))?.id || "ai";
}

function StatusBadge({ ok, optional }: { ok: boolean; optional?: boolean }) {
  if (ok)
    return (
      <Badge
        variant="secondary"
        className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      >
        <CheckCircle2 /> Connected
      </Badge>
    );
  if (optional) return <Badge variant="outline">Optional</Badge>;
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <CircleDashed /> Missing
    </Badge>
  );
}

function groupReady(group: Group, byKey: Map<string, SettingField>) {
  return (
    group.required.length > 0 &&
    group.required.some((set) => set.every((k) => byKey.get(k)?.set))
  );
}

function Field({
  field,
  value,
  cleared,
  onChange,
  onClear,
}: {
  field: SettingField;
  value: string;
  cleared: boolean;
  onChange: (v: string) => void;
  onClear: () => void;
}) {
  const [shown, setShown] = useState(false);
  const id = `setting-${field.key}`;
  const saved = field.secret && field.set && !cleared;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{field.label}</Label>
        {saved ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Lock className="size-3" /> Saved, encrypted
            <button
              type="button"
              className="ml-1 inline-flex items-center rounded p-0.5 hover:bg-muted hover:text-foreground"
              onClick={onClear}
              aria-label={`Remove ${field.label}`}
            >
              <X className="size-3" />
            </button>
          </span>
        ) : (
          <code className="font-mono text-[10px] text-muted-foreground">
            {cleared ? "will be removed" : field.key}
          </code>
        )}
      </div>
      {field.key === "EMAIL_PROVIDER" || field.key === "SMTP_SECURITY" ? (
        <Select
          value={
            value || (field.key === "EMAIL_PROVIDER" ? "resend" : "starttls")
          }
          onValueChange={onChange}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.key === "EMAIL_PROVIDER" ? (
              <>
                <SelectItem value="resend">Resend (API)</SelectItem>
                <SelectItem value="smtp">SMTP (your mail server)</SelectItem>
              </>
            ) : (
              <>
                <SelectItem value="tls">TLS / SSL (port 465)</SelectItem>
                <SelectItem value="starttls">STARTTLS (port 587)</SelectItem>
                {value === "none" && (
                  <SelectItem value="none">
                    None (this computer only)
                  </SelectItem>
                )}
              </>
            )}
          </SelectContent>
        </Select>
      ) : field.key === "ANALYSIS_PROVIDER" ||
        field.key === "AGENT_PROVIDER" ? (
        <Select value={value || "grok"} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="grok">Grok</SelectItem>
            <SelectItem value="claude">Claude</SelectItem>
            {field.key === "ANALYSIS_PROVIDER" && (
              <SelectItem value="openai">OpenAI</SelectItem>
            )}
          </SelectContent>
        </Select>
      ) : (
        <div className="relative">
          <Input
            id={id}
            type={field.secret && !shown ? "password" : "text"}
            value={value}
            placeholder={saved ? "•••••••• type to replace" : undefined}
            onChange={(e) => onChange(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className={cn("font-mono text-xs", field.secret && "pr-10")}
          />
          {field.secret && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="absolute top-1/2 right-1 -translate-y-1/2"
              onClick={() => setShown(!shown)}
              aria-label={shown ? `Hide ${field.label}` : `Show ${field.label}`}
            >
              {shown ? <EyeOff /> : <Eye />}
            </Button>
          )}
        </div>
      )}
      {field.help && (
        <p className="text-xs text-muted-foreground">{field.help}</p>
      )}
    </div>
  );
}

function EmailSettings({
  byKey,
  values,
  renderField,
  dirty,
  ready,
}: {
  byKey: Map<string, SettingField>;
  values: Record<string, string>;
  renderField: (f: SettingField) => ReactNode;
  dirty: boolean;
  ready: boolean;
}) {
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState<"" | "verify" | "test">("");
  const chosen =
    (values.EMAIL_PROVIDER || "resend") === "smtp" ? "smtp" : "resend";
  const pick = (keys: string[]) =>
    keys.map((k) => byKey.get(k)).filter(Boolean) as SettingField[];
  const providerField = byKey.get("EMAIL_PROVIDER");

  async function run(kind: "verify" | "test") {
    setBusy(kind);
    try {
      if (kind === "verify") {
        const r = await postJson<{ message: string }>("/api/email/verify", {});
        toast.success(r.message);
      } else {
        const r = await postJson<{ to: string }>("/api/email/test", { to });
        toast.success(`Test email sent to ${r.to}.`);
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-p3-soft text-p3-ink">
              <Mail className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Sending</CardTitle>
                <StatusBadge ok={ready} />
              </div>
              <CardDescription>
                Every email includes your postal address and an unsubscribe
                link, whichever provider sends it.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {providerField && renderField(providerField)}
          {pick(EMAIL_SHARED).map(renderField)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>
              {chosen === "smtp" ? "SMTP server" : "Resend"}
            </CardTitle>
            <Badge variant="outline">
              {chosen === "smtp"
                ? "Needs the Node server, not Cloudflare"
                : "Works everywhere"}
            </Badge>
          </div>
          <CardDescription>
            {chosen === "smtp"
              ? "Google Workspace, Microsoft 365, Amazon SES, Postmark, Mailgun or your own server. Use an app password where your provider asks for one."
              : "Verify your sending domain in Resend and create an API key. Add the webhook secret so bounces and complaints stop future emails."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {pick(chosen === "smtp" ? EMAIL_SMTP : EMAIL_RESEND).map(renderField)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Check it works</CardTitle>
          <CardDescription>
            {dirty
              ? "Save your changes first: these use the saved settings."
              : "Sign in to the provider without sending, or send yourself one test email."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={dirty || busy !== ""}
            onClick={() => run("verify")}
          >
            {busy === "verify" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <ShieldCheck />
            )}{" "}
            Verify connection
          </Button>
          <div className="flex flex-1 gap-2">
            <Input
              type="email"
              placeholder="you@example.com"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="text-xs"
              aria-label="Send test email to"
            />
            <Button
              type="button"
              size="sm"
              disabled={dirty || busy !== "" || !to}
              onClick={() => run("test")}
            >
              {busy === "test" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Send />
              )}{" "}
              Send test email
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Appearance() {
  const [palette, setPalette] = useState<Palette>(savedPalette());
  function choose(next: Palette) {
    setPalette(next);
    applyPalette(next, true);
  }
  function setSwatch(index: number, color: string) {
    const next = [...palette] as Palette;
    next[index] = color.toUpperCase();
    choose(next);
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="bg-palette flex size-9 items-center justify-center rounded-xl text-ink">
            <PaletteIcon className="size-4" />
          </span>
          <div>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>
              Four swatches color the whole platform. The default lives in{" "}
              <code className="font-mono text-xs">web/src/theme.ts</code> as{" "}
              <code className="font-mono text-xs">PALETTE</code>. Changes here
              stay in this browser.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PRESETS.map((preset) => {
            const active = preset.palette.join() === palette.join();
            return (
              <button
                key={preset.name}
                type="button"
                onClick={() => choose(preset.palette)}
                className={cn(
                  "rounded-2xl border p-3 text-left transition hover:shadow-md",
                  active && "border-p1 ring-4 ring-p1/25",
                )}
              >
                <div className="flex h-10 overflow-hidden rounded-xl">
                  {preset.palette.map((c) => (
                    <span
                      key={c}
                      className="flex-1"
                      style={{ background: c }}
                    />
                  ))}
                </div>
                <p className="mt-2 text-sm font-medium">{preset.name}</p>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-end gap-4">
          {palette.map((color, index) => (
            <label key={index} className="flex items-center gap-2 text-xs">
              <input
                type="color"
                value={color}
                onChange={(e) => setSwatch(index, e.target.value)}
                className="size-9 cursor-pointer rounded-lg border bg-transparent p-0.5"
                aria-label={`Swatch ${index + 1}`}
              />
              <span className="font-mono text-muted-foreground">{color}</span>
            </label>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => {
              resetPalette();
              setPalette(PALETTE);
            }}
          >
            <RotateCcw /> Reset
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  const { org, canManage, refresh } = useAppState();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabId>(() => tabFor(window.location.hash));

  function apply(data: Settings) {
    setSettings(data);
    setValues(
      Object.fromEntries(data.managed.map((f) => [f.key, f.value || ""])),
    );
    setCleared(new Set());
  }

  async function load() {
    apply(await api<Settings>("/api/settings"));
  }

  useEffect(() => {
    if (canManage) load().catch((err) => toast.error(err.message));
  }, [canManage, org?.id]);

  const byKey = useMemo(
    () => new Map((settings?.managed || []).map((f) => [f.key, f])),
    [settings],
  );
  const dirty = useMemo(() => {
    if (!settings) return false;
    return (
      cleared.size > 0 ||
      settings.managed.some((f) => (f.value || "") !== (values[f.key] || ""))
    );
  }, [settings, values, cleared]);

  const renderField = (field: SettingField) => (
    <Field
      key={field.key}
      field={field}
      value={values[field.key] || ""}
      cleared={cleared.has(field.key)}
      onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
      onClear={() => setCleared((prev) => new Set(prev).add(field.key))}
    />
  );
  const provider =
    (byKey.get("EMAIL_PROVIDER")?.value || "resend") === "smtp"
      ? "smtp"
      : "resend";
  const emailReady =
    Boolean(byKey.get("EMAIL_POSTAL_ADDRESS")?.set) &&
    (provider === "smtp"
      ? Boolean(
          byKey.get("SMTP_HOST")?.set && byKey.get("SMTP_FROM_EMAIL")?.set,
        )
      : Boolean(
          byKey.get("RESEND_API_KEY")?.set && byKey.get("EMAIL_FROM")?.set,
        ));

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const data = await sendJson<{ managed: SettingField[] }>(
        "/api/settings",
        "POST",
        { values, clear: [...cleared] },
      );
      apply({
        managed: data.managed,
        redirectUri: settings?.redirectUri || "",
      });
      toast.success("Settings saved and encrypted.");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4 pb-24">
      <PageHeader
        eyebrow={org?.name || "Organisation"}
        title="Settings"
        icon={SettingsIcon}
        iconClass="bg-palette text-ink"
        description="API keys and app credentials for this organisation. They are encrypted at rest, every post uses them, and saved secrets are never shown again."
      />
      {!canManage ? (
        <>
          <Alert>
            <Lock />
            <AlertTitle>Only owners and admins can change keys</AlertTitle>
            <AlertDescription>
              Ask an owner or admin of {org?.name || "this organisation"} to add
              or rotate keys and connected accounts.
            </AlertDescription>
          </Alert>
          <Appearance />
        </>
      ) : !settings ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-56 rounded-2xl" />
          ))}
        </div>
      ) : (
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as TabId);
            window.history.replaceState(null, "", `#${v}`);
          }}
          orientation="vertical"
          className="flex-col gap-4 md:flex-row md:items-start"
        >
          <TabsList className="h-auto! w-full max-w-full flex-row! justify-start overflow-x-auto md:sticky md:top-20 md:w-60 md:shrink-0 md:flex-col! md:items-stretch">
            {TABS.map((t) => {
              const groups = t.groups
                .map((id) => GROUPS.find((g) => g.id === id)!)
                .filter((g) => g.required.length);
              const done =
                t.id === "email"
                  ? emailReady
                    ? 1
                    : 0
                  : groups.filter((g) => groupReady(g, byKey)).length;
              const total = t.id === "email" ? 1 : groups.length;
              return (
                <TabsTrigger
                  key={t.id}
                  value={t.id}
                  className="w-auto! flex-none justify-start gap-2 px-3 py-2 md:w-full!"
                >
                  <t.icon className="size-4" />
                  <span className="flex-1 text-left">{t.label}</span>
                  {total > 0 && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 text-[10px] tabular-nums",
                        done === total
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {done}/{total}
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {TABS.map((t) => (
            <TabsContent
              key={t.id}
              value={t.id}
              className="min-w-0 flex-1 space-y-4"
            >
              <div>
                <h2 className="text-lg font-semibold">{t.label}</h2>
                <p className="text-sm text-muted-foreground">{t.description}</p>
              </div>
              {t.id === "email" && (
                <EmailSettings
                  byKey={byKey}
                  values={values}
                  renderField={renderField}
                  dirty={dirty}
                  ready={emailReady}
                />
              )}
              {t.id === "connector" && (
                <Card>
                  <CardHeader>
                    <CardTitle>Connector token</CardTitle>
                    <CardDescription>
                      The token Grok and Claude use to reach this organisation.
                      It is never shown here; copy or rotate it on the connector
                      pages.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link to="/connectors/grok">Grok connector</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link to="/connectors/claude">Claude connector</Link>
                    </Button>
                  </CardContent>
                </Card>
              )}
              {t.id === "organisation" && (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle>Members and roles</CardTitle>
                      <CardDescription>
                        Invite people, change roles, and rename{" "}
                        {org?.name || "the organisation"}.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button asChild variant="outline" size="sm">
                        <Link to="/organisation">
                          <Users /> Manage organisation
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                  <Appearance />
                </>
              )}
              <div className="grid gap-4 xl:grid-cols-2">
                {t.groups.map((id) => {
                  const group = GROUPS.find((g) => g.id === id)!;
                  const fields = group.keys
                    .map((k) => byKey.get(k))
                    .filter(Boolean) as SettingField[];
                  if (!fields.length) return null;
                  return (
                    <Card
                      key={group.id}
                      id={group.id}
                      className={cn(
                        "scroll-mt-20",
                        group.wide && "xl:col-span-2",
                      )}
                    >
                      <CardHeader>
                        <div className="flex items-start gap-3">
                          <span
                            className={cn(
                              "flex size-9 shrink-0 items-center justify-center rounded-xl",
                              group.tone,
                            )}
                          >
                            <group.icon className="size-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <CardTitle>{group.title}</CardTitle>
                              <StatusBadge
                                ok={groupReady(group, byKey)}
                                optional={!group.required.length}
                              />
                            </div>
                            <CardDescription>
                              {group.description}
                            </CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent
                        className={cn(
                          "grid gap-4",
                          group.wide && "md:grid-cols-2",
                        )}
                      >
                        {fields.map(renderField)}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Not saved</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div
        className={cn(
          "fixed right-4 bottom-4 left-4 z-20 mx-auto flex max-w-xl items-center gap-3 rounded-2xl border bg-card/95 px-4 py-3 shadow-xl backdrop-blur transition md:left-[calc(var(--sidebar-width)+1rem)]",
          dirty || saving
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-4 opacity-0",
        )}
      >
        <span className="flex-1 text-sm">You have unsaved changes.</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={saving}
          onClick={() => settings && apply(settings)}
        >
          Discard
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />} Save
        </Button>
      </div>
    </form>
  );
}
