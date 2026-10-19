import { useEffect, useState } from 'react'
import { Download, KeyRound, MousePointerClick, Puzzle, ShieldCheck } from 'lucide-react'
import { CopyField, PageHeader } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// Built by `npm run ext:package` into web/public/downloads, so it ships with the dashboard.
const ZIP = '/downloads/socialbrewery-extension.zip'
const INFO = '/downloads/socialbrewery-extension.json'

type Info = { version: string; bytes: number; builtAt: string }

const STEPS = [
  'Download the zip and unzip it. Keep the folder somewhere it will stay, such as Documents.',
  'Open Chrome’s extensions page (copy the address below into the address bar).',
  'Turn on Developer mode, top right.',
  'Click Load unpacked and choose the unzipped socialbrewery-extension folder.',
  'Pin Socialbrewery from the puzzle-piece menu, then click it to open the side panel.',
  'In the panel’s Settings, add your Anthropic key (Claude) or xAI key (Grok).',
]

export function ExtensionPage() {
  const [info, setInfo] = useState<Info | null>(null)

  useEffect(() => {
    fetch(INFO)
      .then((res) => (res.ok ? res.json() : null))
      .then(setInfo)
      .catch(() => setInfo(null))
  }, [])

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Chrome extension"
        title="Post from your own browser"
        icon={Puzzle}
        iconClass="bg-palette text-ink"
        description="Claude or Grok writes the post, then fills it in on YouTube, LinkedIn, Instagram, X, Reddit, Slack, or Hashnode in the tabs you’re already signed in to. No connections to set up, and nothing goes live until you approve it."
        actions={
          <Button asChild>
            <a href={ZIP} download="socialbrewery-extension.zip">
              <Download /> Download{info ? ` v${info.version}` : ''}
            </a>
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Install it</CardTitle>
            <CardDescription>
              {info ? `Version ${info.version} · ${(info.bytes / 1024 / 1024).toFixed(1)} MB · built ${new Date(info.builtAt).toLocaleDateString()}` : 'Takes about a minute.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="space-y-3 text-sm">
              {STEPS.map((step, index) => (
                <li key={index} className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-p4-soft text-xs font-semibold text-p4-ink">{index + 1}</span>
                  <span className="text-muted-foreground">{step}</span>
                </li>
              ))}
            </ol>
            <CopyField label="Extensions page" value="chrome://extensions" />
            <p className="text-xs text-muted-foreground">
              To update, download the new zip, replace the folder’s contents, and click the reload arrow on the extension’s card in chrome://extensions.
            </p>
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="size-4" /> No account needed
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              It runs on your own Anthropic or xAI key, which stays in your browser. Sign in to Socialbrewery only if you want your runs saved: signed in here, the
              extension is signed in too, and what it posts shows up in your organisation’s Posts.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4" /> You approve every post
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              The agent fills everything in, then stops with a screenshot before it clicks Post, Share, Publish, or Send. Chrome shows a “debugging this browser” bar
              while it works in a tab.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MousePointerClick className="size-4" /> Rather not install anything?
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Connect your networks under Connectors and use Brew here, or ask Grok or Claude through the connector.
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
