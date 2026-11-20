# Rendering videos for free
> Compositions are HTML + GSAP, so any Chrome can render them frame by frame. No paid video API is needed.

Every option renders the same composition (`templates/composition.html`), seeking the GSAP timeline frame by frame, so output is identical and deterministic.

1. **Chrome extension (free, on your own computer).** The `make_motion_video` tool composes the scenes, opens a render tab, captures every frame through the DevTools Protocol, and encodes an H.264 MP4 in the browser with WebCodecs (Mediabunny muxer). The file lands in the extension's files for `upload_file`. Works with Claude, Grok, or OpenAI and needs no key besides the assistant's. It has a voiceover by default: write a `narration` line per scene; scenes stretch to fit. The voice is the user's choice in Settings (their ElevenLabs or xAI clone, an xAI or OpenAI voice, or the free Supertonic voice that runs on their computer).
2. **Your own Node server (free).** `render_video` runs HyperFrames (Apache 2.0, `npx hyperframes`) with headless Chrome and ffmpeg, including voiceover audio. Needs Node 22+, ffmpeg, and network access the first time. Not available on Cloudflare Workers.
3. **Any machine with Node and ffmpeg.** Save the composition HTML from `get_video_project`, put the `fonts/` folder next to it, and run `npx hyperframes@0.8.79 render` there. A free CI runner (for example GitHub Actions) works the same way.

Check a few frames before a long render: the extension's tool returns a contact sheet of four frames with the MP4.
