# Video Studio knowledge pack

Everything an AI agent (Claude or Grok, connected through the Socialbrewery MCP connector) needs to
make launch videos, product Shorts and promos in a consistent, brand-configurable style.

- `guides/` house rules: style, copy, voice and audio, images, YouTube SEO, distribution, review.
- `motion/` motion style presets. Each one is a recipe the agent can follow scene by scene.
- `playbooks/` step-by-step agent workflows (launch video, product Short, explainer promo).
- `templates/` HyperFrames compositions (HTML + GSAP) with `{{placeholders}}` filled from a brand kit.
- `brands/` brand kits (JSON). `default.json` is neutral; `openlit.json` is a worked example.
- `fonts/` bundled fonts (SIL Open Font License 1.1, see `fonts/OFL-*.txt`).
- `vendor/` third-party MIT skills (brag, cinetic), vendored with attribution. See `LICENSES.md`.

Edit the Markdown here, then run `node scripts/build-studio-pack.mjs` to regenerate `src/studio-pack.js`
(the server reads the pack from that module so it also works on Cloudflare Workers).
