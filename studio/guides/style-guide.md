# Style guide

Read the active brand kit first (`get_video_playbook` with `brand`, or resource `studio://brands/<id>.json`).
Everything below uses brand tokens, never hard-coded colors.

## Look
- One dark base (`colors.bg`), one ink for text (`colors.ink`), ONE accent (`colors.accent`) that means one thing
  (the moment something matters: a cost spike, a fixed trace, the CTA).
- Buttons and pills: `colors.button` background with `colors.buttonText` text. For OpenLIT that is `#C2410C`
  with WHITE text. Never dark text on an orange button.
- Pastel variant (explainers, Shorts): light paper background, soft pastel cards, thick ink outlines, mono labels.
- Type: `fonts.sans` for headlines (heavy, 700 to 900, tight tracking), `fonts.mono` for labels, code, numbers.
  Headlines max 6 words per line on vertical, 9 on landscape.
- Safe areas: vertical 1080x1920 keep text inside x 90..990, y 220..1500 (captions and app chrome live below).
  Landscape 1920x1080 keep 96 px margins.

## Real product, real data
- Use REAL screenshots or screen recordings of the product. Capture at 2x or 3x device pixel ratio.
- Never invent numbers. If a shot is illustrative or stylized, label it on screen (for example "STYLIZED TRANSITION").
- Zoom into the part of the screenshot the narration talks about (focus pull), do not show a whole dashboard at 30% scale.

## Structure that worked
1. Pain-first hook in the first 3 seconds (a question or a sharp claim the viewer feels: "Your AI agent said Done. It lied.").
2. Show the problem in the real UI.
3. Show the fix, feature by feature, each with one on-screen headline and one zoom.
4. Proof (real chart, real trace, real config).
5. Loader / logo end card, CTA (site, GitHub, or "book a call" link), then an open-ended question.

## Captions
- Burned-in captions on Shorts, 2 to 5 words per chunk, centered at y about 1450 (vertical), heavy weight,
  accent color on the key word. Ship an `.srt` too for YouTube and LinkedIn.

## Bans
Glitch / RGB split, light leaks, neon glows, stock-footage people, crossfade as the default seam,
fake UI, unlabeled made-up metrics, more than one accent color.
