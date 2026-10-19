# Socialbrewery

A local app for posting YouTube Shorts, LinkedIn posts, Instagram Reels, X posts, Hashnode articles, Slack messages, and Reddit posts. Grok writes the caption, can generate a vertical clip, and uploads it to the accounts you connect.

People sign in with Clerk. Everything that posts belongs to an **organisation**: the xAI and OpenAI keys, every network's app credentials and connected accounts, posts, media, chat history, and the Grok connector. Each organisation keeps its own, encrypted on disk, so several teams can share one server without seeing each other's keys or accounts.

It runs on `127.0.0.1` by default. Set `HOST` and an https `APP_URL` in `.env` to serve it to a team.

## Start

Node.js 20 or newer. No extra packages.

```bash
cd socialbrewery
npm start
```

Open [http://127.0.0.1:3847](http://127.0.0.1:3847).

## Sign-in and organisations

Sign-in, people, and organisations run on [Clerk](https://clerk.com). Whoever runs the server sets it up once, then restarts (see `.env.example`):

1. Create an application at [dashboard.clerk.com](https://dashboard.clerk.com) and pick the sign-in methods (Google, GitHub, email, …).
2. Turn on **Organizations** (Configure → Organizations). Socialbrewery always works inside an organisation, so turning off personal accounts there ("Membership required") is a good fit.
3. Copy **API keys** into `.env`: `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. On Clerk's production instance, add your `APP_URL` domain.

Until the keys are set, the sign-in page shows these steps.

- Each Clerk organisation has its own Socialbrewery organisation, created the first time someone opens it. On a fresh install, the very first one also takes over the old single-user keys from `.env`, the connected accounts, posts, and media, and those keys are removed from `.env`.
- Organisations made with the sign-in that Socialbrewery had before Clerk carry over: the first Clerk organisation one of its owners opens as an admin, signed in with the same verified email, takes over its keys, connected accounts, and posts.
- Members, invites, roles, and the name are managed in Clerk, from **Organisation** in the sidebar. Roles: **admin** (keys, connected accounts, invites, the connector URL) and **member** (post, Brew, analysis with the organisation's accounts). A custom Clerk role named `owner` also counts as admin; any other custom role counts as member.
- Anyone can create more organisations from the switcher at the top of the sidebar. Each starts empty.

### Encryption

Organisation settings and account tokens are encrypted with AES-256-GCM under a master key, bound to the organisation they belong to. The key comes from `SOCIALBREWERY_MASTER_KEY` (32 random bytes, base64) or, if that is unset, from `.master.key`, which is created next to `.env` on first start. **Back it up**: without it, stored keys and tokens cannot be read. Saved secrets are never sent back to the browser; Settings shows them as "Saved, encrypted", and you replace or remove them.

### Deploy on Cloudflare Workers (Free plan)

The same app runs as a Worker on the Workers Free plan, with no server to keep running:

- The routes in `src/server.js` run inside the Worker through `node:http` support (`worker/index.js`).
- The dashboard in `public/` is served as Static Assets.
- Users, organisations, encrypted settings and tokens, posts, and history are JSON documents in a D1 database.
- Videos live in D1 too, split into pieces, unless you add an R2 bucket. The Worker streams uploads and playback itself.

1. `npm install` (installs Wrangler; the app itself still has no runtime dependencies).
2. `npx wrangler d1 create socialbrewery`, then paste the printed `database_id` into `wrangler.jsonc`.
3. In `wrangler.jsonc`, set `APP_URL` to your `https://socialbrewery.<subdomain>.workers.dev` URL or custom domain.
4. Add the secrets:
   ```bash
   npx wrangler secret put SOCIALBREWERY_MASTER_KEY   # openssl rand -base64 32, and keep a copy
   npx wrangler secret put CLERK_PUBLISHABLE_KEY      # pk_live_… (or put it in "vars" in wrangler.jsonc)
   npx wrangler secret put CLERK_SECRET_KEY           # sk_live_…
   ```
5. `npm run cf:deploy`. The D1 tables are created on the first request. Until the key, `APP_URL`, and the D1 binding are set, the Worker answers with a list of what is missing.
6. Point the network OAuth apps at redirect URIs that start with `APP_URL`, and add the domain to your Clerk production instance.

To try it locally first, put `SOCIALBREWERY_MASTER_KEY`, `APP_URL=http://127.0.0.1:8787`, and the Clerk test keys in `.dev.vars` (ignored by git), then run `npm run cf:dev`. This uses a local D1.

**Where videos go.** Attached videos, Grok-generated Shorts, and videos the grok.com connector fetches from a `videoUrl` all have to be stored before they can be posted. By default they are kept in D1:

- Each video is split into 1.4 MB pieces, stored as text because D1 rows hold at most 2 MB.
- A video can be at most 25 MB (`D1_VIDEO_MAX_MB`).
- Once all stored videos pass 350 MB (`D1_VIDEO_BUDGET_MB`), the oldest are deleted to make room, because a free D1 database holds 500 MB.
- Grok clips are a few MB each, so roughly a hundred fit. A deleted video stays in the library list, and posting it again asks you to attach or generate it again.

For larger or more videos, use R2 instead (10 GB free, but Cloudflare asks for a payment method before enabling it):
1. `npx wrangler r2 bucket create socialbrewery-media`
2. Uncomment `r2_buckets` in `wrangler.jsonc`, then deploy.

Videos can then be up to 100 MB, and nothing is deleted.

Free plan limits that matter:

- **Requests to outside services.** Each request may call outside services 50 times. A Grok run spends this budget on chat turns, on video status checks (every 15 seconds on Workers, so up to about 30 per generated video), and on uploads. Over the grok.com connector each tool call is its own request. In the dashboard chat, generating a video and posting it in two messages is safer than doing both in one.
- **CPU time.** Each request gets 10 ms of CPU time. Waiting on the network does not count, but converting large videos stored in D1 and very long agent runs can hit it. If they do, Workers Paid ($5/month) raises the limit without code changes.
- **Simultaneous writes.** Writes from requests that run at the same moment are not merged, so the last write wins. That is fine for a small team.
- **Lost key.** Without `SOCIALBREWERY_MASTER_KEY` nothing encrypted can be read, so the app refuses to run until it is set.

### Deploy with Cloudflare Tunnel

Socialbrewery runs on any machine with Node.js 20 (a VM, a home server, a Mac). Cloudflare Tunnel puts it on your domain over HTTPS without opening a port: `cloudflared` connects out to Cloudflare, and the app keeps listening on `127.0.0.1`.

1. Install `cloudflared` (`brew install cloudflared`, or see [Cloudflare's downloads](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)) and log in: `cloudflared tunnel login`.
2. Create the tunnel and its DNS record:
   ```bash
   cloudflared tunnel create socialbrewery
   cloudflared tunnel route dns socialbrewery brew.example.com
   ```
3. Copy `cloudflare/config.example.yml` to `cloudflare/config.yml` (git-ignored) and fill in the tunnel ID, credentials file, and hostname.
4. In `.env`, keep `HOST=127.0.0.1` and set `APP_URL=https://brew.example.com`. Update every network OAuth app to redirect URIs that start with that URL (each Connection tab shows them), and add the domain to Clerk.
5. Start both, each under a service manager (launchd, systemd, pm2) so they come back after a reboot:
   ```bash
   npm start
   npm run tunnel
   ```

With an https `APP_URL`, Socialbrewery's cookies are `Secure`, the Grok connector and Instagram use that URL directly (no `MCP_PUBLIC_URL` needed), and the Instagram webhook callback URL is ready for Meta. Variables set on the process override `.env`, so a service manager can supply `APP_URL` and the Clerk keys instead.

Limits to know:

- Cloudflare accepts request bodies up to 100 MB on the Free and Pro plans, so larger video uploads fail at Cloudflare even though the app allows 200 MB. Long Grok runs are kept open with a keepalive every 20 seconds, under Cloudflare's 100-second idle limit.
- Run one copy of the app. Data lives on the machine's disk, so it cannot run on Cloudflare Workers or Pages, or on several machines at once.
- Back up the data folder and the master key together (see below).

## Dashboard

The UI is a React + [shadcn/ui](https://ui.shadcn.com) dashboard. Its source is in `web/`, and the built files are committed in `public/`, so `npm start` needs no install.

- **Overview**: post counts, connector status, setup checklist, and a quick prompt into Brew.
- **Brew**: chat with Grok. Pick a target network, attach or drop a video, watch each step (clip generated, uploaded, posted) as it happens, and stop a run.
- **Connectors → YouTube / LinkedIn / Instagram / X / Hashnode / Slack / Reddit**: each has Overview, Posts, Compose, Analysis, and Connection tabs. YouTube posts can be edited, LinkedIn posts can get a comment, X posts can get a reply, Hashnode Analysis shows article views, reactions, and comments, Slack posts get thread replies and show reactions, Reddit posts can get a comment and Analysis shows score, comments, upvote ratio, and removals, and YouTube Analysis shows channel stats with AI reviews.
- **Connectors → Grok connector**: the URL and tools for grok.com.
- **Organisation**: members, roles, invites, and the name (Clerk's organisation profile).
- **Settings**: this organisation's keys grouped by service (owners and admins), plus Appearance.

The whole palette comes from one constant, `PALETTE` in `web/src/theme.ts` (default [#9FA1FF #B5BAFF #AEE2FF #D9F9DF](https://colorhunt.co/palette/9fa1ffb5baffaee2ffd9f9df)). Every color, including shadcn’s tokens, is derived from those four swatches in `web/src/index.css`. Settings → Appearance switches palettes in the browser without a rebuild.

To change the dashboard:

```bash
npm run web:dev     # Vite on :5173, proxied to the app on :3847
npm run web:build   # rebuilds public/
```

## Post a Short

1. In [console.x.ai](https://console.x.ai/), create an API key. Paste it into **Settings** and save.
2. In Google Cloud, enable [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com). Create an OAuth client of type **Web application**. Add the redirect URI shown on the YouTube page (`http://127.0.0.1:3847/api/youtube/callback` unless you changed the port). Add your Google account as a test user on the consent screen.
3. Paste the client ID and secret into **Settings**, save, then **Connect YouTube**. Reconnect if the channel was linked before analytics was added.
4. On **Brew**, ask Grok to generate a clip and post it, or attach an mp4, mov, or webm and tell Grok to post that. On **YouTube**, use **Analyze** for views, watch time, and what to change. Set **Analysis provider** to `openai` and add an OpenAI API key when that review should come from OpenAI. The default is Grok. Default privacy is unlisted.

## LinkedIn, Instagram, X, Hashnode, Slack, and Reddit

1. Create a LinkedIn app with **Sign In with LinkedIn using OpenID Connect** and **Share on LinkedIn**. Add the redirect URI from **Connectors** (`http://127.0.0.1:3847/api/linkedin/callback` unless you changed the port). Paste the client ID and secret into Settings, save, then **Connect LinkedIn**. A LinkedIn post can carry a video or one link shown as a preview card (Compose → **Link preview**, or ask Grok). YouTube links get their thumbnail automatically; any other thumbnail must be a public https image.
2. Create a Meta app with **Instagram API with Instagram Login**, permissions `instagram_business_basic` and `instagram_business_content_publish`. Add the Instagram redirect URI from Connectors. Paste the Instagram app ID and secret into Settings, save, then **Connect Instagram**. Reels need a public tunnel: set **Grok connector public URL** to that https origin so Instagram can fetch `/api/media/...`. Optional webhooks (new comments and messages): Connectors → Instagram → Connection shows a per-organisation **Callback URL** (`/webhooks/instagram/<org>`) and **Verify token** for Meta App Dashboard → Configure webhooks. Every delivery must carry a valid `X-Hub-Signature-256` from that organisation's Instagram app secret; duplicates from Meta's retries are dropped. Meta only sends them once the app is Live with Advanced Access.
3. In the [X Developer Console](https://console.x.com), create an app and add API credits (posting through the X API is paid). Under **User authentication settings**, turn on OAuth 2.0 with **Read and write** permissions and type **Web App**, and add the callback `http://127.0.0.1:3847/api/x/callback`. Paste the OAuth 2.0 **Client ID** and **Client Secret** (not the API key) into Settings, save, then **Connect X**. Posts are text or text with a video, 280 characters for standard accounts (links count as 23). Use a reply to build a thread or add links.
4. Hashnode: since May 2026 the [GraphQL API needs your blog on Hashnode Pro](https://hashnode.com/announcements/graphql-api) (blog dashboard → Billing). Generate a personal access token at [hashnode.com/settings/developer](https://hashnode.com/settings/developer), paste it into Settings as **Hashnode access token**, and add **Hashnode blog** (e.g. `blog.example.com`) if you have more than one blog. Save, then **Connect Hashnode**. There is no OAuth redirect; Connect just checks the token and picks the blog. Articles are Markdown with up to 5 tags, and can be saved as drafts.
5. Slack: on **Connectors → Slack → Connection**, copy the app manifest. At [api.slack.com/apps](https://api.slack.com/apps?new_app=1) choose **Create New App → From a manifest**, paste it, then **Install to Workspace**. Under **Basic Information → Display Information**, upload the app icon from the same page (`/socialbrewery-icon.png`, 1024×1024; regenerate with `python3 scripts/make-icon.py [512-2000]`). Copy the **Bot User OAuth Token** (`xoxb-…`) into Settings, optionally set a default channel like `#announcements`, save, then **Connect Slack**. The app joins public channels by itself when it posts; for private channels run `/invite @Socialbrewery` first. Messages use Slack mrkdwn, can carry a video, and can be replied to in-thread. Slack's OAuth requires an https redirect, so Socialbrewery uses the bot token instead.
6. Reddit works **without API keys**. Since November 2025 Reddit has closed self-service API keys (reddit.com/prefs/apps just loops back to the Responsible Builder Policy). Postiz and other tools need the same keys, so they hit the same wall. In manual mode, Compose (or Grok in Brew) drafts the post and opens Reddit's own submit page with the subreddit, title, and text or link filled in; you click **Post**, then paste the post link back to track it under Posts. One-click posting, comments, flair, and stats need approved keys: request them with [Reddit's API access form](https://support.reddithelp.com/hc/en-us/requests/new?ticket_form_id=14868593862164&tf_42139884615700=api_request_type_developer_clone) (Connectors → Reddit → Connection has request text to copy). If you are approved, or have a web app from before November 2025, set its redirect URI to `http://127.0.0.1:3847/api/reddit/callback`, put the client ID and secret in Settings, and click **Connect Reddit**.

You can also post yourself without the agent from each connector’s **Compose** tab.

## Ask Grok on grok.com

Socialbrewery is a custom connector. Grok’s connector page cannot call localhost, so expose the app with a tunnel first:

```bash
cloudflared tunnel --url http://127.0.0.1:3847
```

Put the `https://….trycloudflare.com` origin into **Settings** as **Grok connector public URL**, then save. (If the app itself is served on https, that is used and no tunnel is needed.) Open **Connectors → Grok connector**, copy the URL, and in [grok.com/connectors](https://grok.com/connectors) choose **New Connector → Custom**. Paste that URL.

Each organisation has its own connector URL. Its token decides which organisation's keys and accounts Grok posts with, so only owners and admins can see it, and **Rotate token** replaces it at once.

Then ask Grok things like “Post an unlisted Short of rain on a copper kettle”, “Post this to LinkedIn”, “Publish a Reel”, “How did my latest video do?”, or “Change that video’s title and make it public.” The connector can post to YouTube, LinkedIn, Instagram, and X, reply on X, publish, edit, and list Hashnode articles, post and reply in Slack, read subreddit rules, post and comment on Reddit, generate a clip and post it, list recent YouTube videos, review analytics, and edit YouTube title, description, tags, or privacy. Reconnect YouTube once so Google grants that edit permission.

YouTube Shorts are normal video uploads. This app sends a vertical idea to Grok (`9:16`, up to 15 seconds) and adds `#Shorts` to the description. The default YouTube quota allows a handful of uploads per day.

If a Google test app is left in testing mode, the refresh token expires after 7 days. Reconnect YouTube, or publish the consent screen.

## What is stored

| Path | Contents |
|---|---|
| `.env` | Server settings and Clerk keys |
| `.master.key` | Encryption master key (unless `SOCIALBREWERY_MASTER_KEY` is set) |
| `data/system/orgs.json` | Organisations and the Clerk organisation each belongs to (people and memberships are in Clerk) |
| `data/orgs/<id>/config.json` | The organisation's keys, encrypted |
| `data/orgs/<id>/token-<network>.json` | Connected account tokens, encrypted |
| `data/orgs/<id>/media/` | Attached and generated videos |
| `data/orgs/<id>/posts.json`, `history.json`, `analyses.json` | Posts, Grok chat, performance reviews |

Running with Node, everything lives in one folder: the app directory, or `SOCIALBREWERY_HOME` when that is set. On Cloudflare Workers the same paths are keys: JSON files are rows in the D1 `documents` table (`npx wrangler d1 export socialbrewery --remote --output backup.sql` backs them up), and videos are rows in `media_files`/`media_pieces` (or objects in the R2 bucket). Back up that whole folder, including `.master.key` (or keep `SOCIALBREWERY_MASTER_KEY` somewhere safe); the encrypted files are useless without the key.

Instagram fetches Reels through short-lived signed links (`/public/media/...`, valid for 2 hours); everything else under `/api` needs a signed-in member of the organisation.

## Tests

```bash
npm test
```
