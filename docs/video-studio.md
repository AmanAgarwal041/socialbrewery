# Video Studio

Video Studio lets Claude, Grok, or OpenAI make launch videos, product Shorts, and promos through the Socialbrewery
connector, in a consistent brand style, and hand the MP4 straight to the posting tools.

It has two parts:

1. **A knowledge pack** in `studio/`: style guide, copy rules, voice and audio rules, image creation, YouTube SEO,
   distribution, a review checklist, motion styles, agent playbooks, a HyperFrames + GSAP composition template,
   brand kits, bundled OFL fonts, and the vendored MIT skills brag and cinetic.
2. **Tools** that turn a scene list into a composition, narrate it, and render it.

## How the agent sees it

| MCP feature | What is there |
|---|---|
| Prompts | `make_launch_video`, `make_product_short`, `make_explainer_promo` (playbook + rules + brand kit in one message) |
| Resources | every pack file as `studio://<path>`, e.g. `studio://motion/cinematic.md`, `studio://vendor/cinetic/references/camera.md` |
| Tools | `list_video_styles`, `get_video_playbook`, `list_studio_docs`, `get_studio_doc`, `save_brand_kit`, `add_studio_asset`, `generate_voiceover`, `create_video_project`, `update_video_project`, `get_video_project`, `render_video`, `get_render_status` |

Clients that do not show MCP prompts or resources (Grok today) get the same content through `get_video_playbook` and `get_studio_doc`.

## Flow

1. `list_video_styles` then `get_video_playbook { playbook, style, brand }`.
2. Optional: `save_brand_kit` for your own colors, fonts, voice, CTA, keywords. `openlit` is a worked example, `default` is neutral.
3. Real screenshots: public https URLs, or `add_studio_asset { name, url | base64 }` which returns `assets/<name>`.
4. `generate_voiceover { text, brand, speed }` returns `voiceoverId` and its duration.
5. `create_video_project { template, formats, brand, scenes[], cta, question, voiceoverId }`.
   Scene fields: `kicker`, `headline`, `highlight`, `sub`, `image`, `focus {x,y,scale}`, `label`, `captions[{at,text}]`,
   `duration`, `effect` (`focus`, `zoom-through`, `rack`, `hinge`, `slats`, `shutter`, `pillars`, `endcard`, `pop`, `kinetic`, `split`, `wipe`, `counter`), `pillars` (measured bar heights), `stat {value, prefix, suffix, decimals}` (a real number for `counter`).
6. `render_video { projectId, format }` then poll `get_render_status { jobId }` until `done`. You get a `mediaId`.
7. Post with `post_youtube_short { mediaId }`, then `post_linkedin { linkUrl: <YouTube URL> }`, `post_slack`, and so on,
   only after the user approves each post.

Em and en dashes in on-screen text are replaced automatically. Pillars require real measured heights and get a
"STYLIZED TRANSITION" label. Broken image URLs stop the render with a clear error instead of rendering blank.

## Free rendering

Compositions are HTML + GSAP, so rendering needs only Chrome. There are three free ways (also in `studio/guides/rendering.md`):

1. **Chrome extension.** `make_motion_video` composes the scenes with `src/studio-compose.js` (the same code the server uses), opens a render tab, seeks the GSAP timeline frame by frame over the DevTools Protocol, screenshots each frame, and encodes an H.264 MP4 with WebCodecs ([Mediabunny](https://mediabunny.dev), MPL-2.0). GSAP and the fonts are inlined, so it needs no server, no key, and no video API, and it works with Claude, Grok, or OpenAI. A 16 s vertical video takes about a minute. No audio yet; images are https URLs or `file:<id>` of an attached image. It returns a four-frame contact sheet so the agent can check its work.
2. **Node server.** `render_video` below (HyperFrames, Apache 2.0, plus ffmpeg), with voiceover audio.
3. **Any machine or free CI runner** with Node 22+ and ffmpeg: save the composition from `get_video_project`, put `studio/fonts/` next to it as `fonts/`, and run `npx hyperframes@0.8.79 render`.

Motion styles for these effects: `kinetic-typography` (kinetic, split, counter, wipe) and `soft-pop` (pop, a clay-like squash-in on warm colors).

## Requirements

| Feature | Needs |
|---|---|
| Pack, prompts, resources, projects | Nothing. Works on Node and on the Cloudflare deploy. |
| `render_video` | Node server with `ffmpeg`/`ffprobe` on PATH, `npx` (Node 22+), and network access the first time (`npx` fetches `hyperframes@0.8.79`, which downloads headless Chrome; GSAP loads from jsDelivr). Not available on Workers. |
| `generate_voiceover` with ElevenLabs | **Settings → AI models → ElevenLabs API key**. Speed changes need ffmpeg. |
| Kokoro fallback | `pip install kokoro-onnx soundfile`, and `kokoro-v1.0.onnx` + `voices-v1.0.bin` in `<SOCIALBREWERY_HOME>/kokoro/`. |

Renders take about 10 to 60 seconds for a short clip on an Apple Silicon Mac. Jobs live in memory, so a restart forgets them (the MP4 stays in the media library).

## Editing the pack

Edit Markdown, JSON, or HTML under `studio/`, then run `node scripts/build-studio-pack.mjs`. `npm test` fails if
`src/studio-pack.js` is stale. Licenses for vendored skills and fonts are in `studio/LICENSES.md`.
