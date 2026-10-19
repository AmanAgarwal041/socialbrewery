# Socialbrewery for Chrome

A side-panel agent that does what Socialbrewery's Brew does, but in your own browser: Claude or Grok
writes the post, then fills it in on YouTube, LinkedIn, Instagram, X, Reddit, Slack, or Hashnode in
the tab you're signed in to. There are no API connections to set up. Nothing is published until you
click **Approve** in the side panel.

- **No account needed.** Add your own Anthropic and/or xAI API key in Settings. Keys stay in this
  browser (`chrome.storage.local`) and are only sent to Anthropic or xAI.
- **Sign in only to save progress.** Signed in to Socialbrewery, your runs (what you asked, what the
  agent did, what got posted) are saved to your organisation and follow you to other browsers, and
  posts appear in the dashboard's Posts list. The extension shares the dashboard's Clerk session:
  sign in on the dashboard and the extension is signed in too.
- **Claude or Grok.** Switch at the top of the panel. Claude runs on Claude Opus 5.5 by default
  (adaptive thinking, medium effort, with Anthropic's default refusal fallback); Grok on `grok-4.6`.
  Grok Imagine can also generate a vertical clip to upload.

## Build and load

```bash
cd extension
npm install
npm run build          # writes dist/
```

Open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and pick
`extension/dist`. Click the Socialbrewery icon to open the side panel. `npm run dev` rebuilds on
change (reload the extension afterwards).

The manifest pins a public key, so the extension id is always `lbpmjaljdakmemfoapiecnocaimlekjm`.
When you publish to the Chrome Web Store, replace `key` with the store's public key and update the id
below.

## Turning on saving (once per Clerk instance)

1. Clerk only talks to extensions it knows. Allow this one, with the Clerk secret key of the
   instance Socialbrewery uses:
   ```bash
   CLERK_SECRET_KEY=sk_test_... sh extension/scripts/allow-clerk-origin.sh
   ```
2. The server must accept the extension's sessions: `CLERK_AUTHORIZED_PARTIES` in
   `wrangler.jsonc` (or `.env`) lists `chrome-extension://lbpmjaljdakmemfoapiecnocaimlekjm`.
3. In the panel's Settings, **Socialbrewery address** points at your deployment.

## How it works

- `src/agent/run.ts` is the loop and system prompt; `providers.ts` talks to Claude (official SDK,
  your key, straight from the browser) and Grok (xAI chat completions).
- `tools.ts` is everything the model can do: read the page, screenshot, click, type, keys, scroll,
  navigate, upload a file, generate a clip, record a post. Clicking a publish button, Enter in a
  message box, or a Mod+Enter shortcut stops for your approval, in code, whatever the model says.
- `browser.ts` sends real mouse and keyboard input through the Chrome debugger (Chrome shows a
  "debugging this browser" bar while the agent works), and `page.ts` reads the page, including
  shadow DOM. Native file pickers are intercepted; files go straight into the page's file input.
- `playbooks.ts` holds per-site hints and each site's publish buttons. Sites change their layouts;
  the agent reads the page before it acts, but update a playbook when a flow changes.
- Files you attach or Grok generates live in IndexedDB in this browser and are never uploaded to
  Socialbrewery.

Automating your own accounts can conflict with a network's terms. Keep runs to what you would do
by hand.
