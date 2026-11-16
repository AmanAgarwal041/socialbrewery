// Motion-graphics videos rendered for free in this browser. The agent (Claude, Grok, or OpenAI) writes
// scenes; src/studio-compose.js turns them into the same HyperFrames + GSAP composition the server
// renders with `npx hyperframes`. Here a render tab loads it, the DevTools Protocol seeks the GSAP
// timeline frame by frame and screenshots each frame, and WebCodecs (through Mediabunny) encodes an
// MP4. No video API, no key, no upload: the file stays in this browser for upload_file.

import { BufferTarget, CanvasSource, getFirstEncodableVideoCodec, Mp4OutputFormat, Output, QUALITY_HIGH } from 'mediabunny'
import gsapSource from 'gsap/dist/gsap.min.js?raw'
import interUrl from '../../../studio/fonts/Inter.ttf?url'
import monoUrl from '../../../studio/fonts/GeistMono.ttf?url'
import template from '../../../studio/templates/composition.html?raw'
import defaultBrand from '../../../studio/brands/default.json'
import { composeHtml, normalizeBrand, type Brand } from '../../../src/studio-compose.js'
import { addFile, getFile, type MediaFile } from '../storage'

const PROTOCOL = '1.3'

// The same Video Studio docs the connector serves (studio/), bundled for the agent.
const STYLES = import.meta.glob('../../../studio/motion/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const GUIDES = import.meta.glob(['../../../studio/guides/copy-rules.md', '../../../studio/guides/style-guide.md'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const styleId = (file: string) => file.split('/').pop()!.replace(/\.md$/, '')

/** The style list and house rules, or one style in full. */
export function motionGuide(style: string) {
  const entry = Object.entries(STYLES).find(([file]) => styleId(file) === style)
  if (entry) return entry[1]
  const list = Object.entries(STYLES).map(([file, text]) => `- ${styleId(file)}: ${/^>\s+(.+)$/m.exec(text)?.[1] || ''}`)
  return [
    'Motion styles (call get_motion_guide with one id to read it in full):',
    ...list,
    '',
    'Scene effects: focus, zoom-through, rack, hinge, slats, shutter, pillars (needs real measured bar heights), endcard (last scene: loader, CTA, question), pop, kinetic, split, wipe, counter (needs a real stat.value).',
    'In this browser: no add_studio_asset or voiceover; scene images are https URLs or file:<id> from list_files. Keep headlines to about 8 words, no em dashes, one highlight word.',
    '',
    ...Object.values(GUIDES),
  ].join('\n')
}
const MAX_SECONDS = 90
const SHEET_AT = [0.15, 0.4, 0.65, 0.9]

export type MotionInput = {
  format?: '9x16' | '16x9'
  brand?: Record<string, unknown>
  scenes: Record<string, unknown>[]
  cta?: { label?: string; url?: string }
  question?: string
  fps?: number
}

export type MotionResult = { file: MediaFile; seconds: number; width: number; height: number; codec: string; sheet: string }

type Target = chrome.debugger.Debuggee
const cdp = <T = unknown>(target: Target, method: string, params?: Record<string, unknown>) => chrome.debugger.sendCommand(target, method, params) as unknown as Promise<T>

async function dataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function fontDataUrl(url: string) {
  return dataUrl(new Blob([await (await fetch(url)).arrayBuffer()], { type: 'font/ttf' }))
}

/** Scene images may name a file the user attached here ("file:<id>"); it is inlined as a data URI. */
async function inlineImages(scenes: Record<string, unknown>[]) {
  return Promise.all(
    scenes.map(async (scene) => {
      const image = typeof scene.image === 'string' ? scene.image : ''
      if (!image.startsWith('file:')) return scene
      const file = await getFile(image.slice(5))
      if (!file || !/^image\/(png|jpe?g|webp|gif)$/.test(file.mime)) throw new Error(`Scene image ${image} is not an attached png, jpeg, webp, or gif. Call list_files.`)
      if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} is over 8 MB; attach a smaller screenshot.`)
      return { ...scene, image: await dataUrl(file.blob) }
    }),
  )
}

/** The composition as one self-contained page: GSAP and fonts inlined, so the render tab needs no files. */
export async function buildComposition(input: MotionInput) {
  const brand = normalizeBrand((input.brand || {}) as Record<string, unknown>, normalizeBrand({}, defaultBrand as Brand))
  const out = composeHtml(template, { format: input.format || '9x16', brand, scenes: await inlineImages(input.scenes || []), cta: input.cta, question: input.question })
  if (out.duration > MAX_SECONDS) throw new Error(`That is ${out.duration.toFixed(1)} s; render at most ${MAX_SECONDS} s in the browser.`)
  const [inter, mono] = await Promise.all([fontDataUrl(interUrl), fontDataUrl(monoUrl)])
  const html = out.html
    .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/gsap@[^"]+"><\/script>/, () => `<script>${gsapSource.replace(/<\/script/gi, '<\\/script')}</script>`)
    .replace('url("fonts/Inter.ttf")', () => `url("${inter}")`)
    .replace('url("fonts/GeistMono.ttf")', () => `url("${mono}")`)
  return { ...out, html }
}

// Runs in the render tab. HyperFrames shows a clip only between data-start and data-start +
// data-duration; this does the same, then seeks the timeline and waits for the frame to paint.
const SETUP = `window.__sbSeek = function (t) {
  document.querySelectorAll('#root [data-start][data-duration]').forEach(function (el) {
    var start = Number(el.getAttribute('data-start')), end = start + Number(el.getAttribute('data-duration'));
    el.style.visibility = t >= start && t < end ? '' : 'hidden';
  });
  window.__timelines.main.seek(t, false);
  return new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(function () { resolve(true); }); }); });
};
(async function () {
  await document.fonts.ready;
  await Promise.all(Array.from(document.images).map(function (img) { return img.complete ? 0 : new Promise(function (r) { img.onload = img.onerror = r; }); }));
  return Boolean(window.__timelines && window.__timelines.main);
})()`

async function evaluate(target: Target, expression: string) {
  const res = await cdp<{ result?: { value?: unknown }; exceptionDetails?: { text?: string; exception?: { description?: string } } }>(target, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (res.exceptionDetails) throw new Error(`The composition failed: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'script error'}`)
  return res.result?.value
}

function decode(base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  return createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }))
}

async function contactSheet(frames: ImageBitmap[], width: number, height: number) {
  const scale = 480 / Math.max(width, height)
  const w = Math.round(width * scale)
  const h = Math.round(height * scale)
  const canvas = new OffscreenCanvas(w * 2 + 12, h * 2 + 12)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#111'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  frames.forEach((frame, i) => ctx.drawImage(frame, (i % 2) * (w + 12), Math.floor(i / 2) * (h + 12), w, h))
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
  return (await dataUrl(blob)).split(',')[1]
}

export async function renderMotionVideo(input: MotionInput, { signal, onProgress }: { signal: AbortSignal; onProgress: (text: string) => void }): Promise<MotionResult> {
  const composition = await buildComposition(input)
  const { width, height, duration } = composition
  const fps = input.fps === 24 || input.fps === 60 ? input.fps : 30
  const frames = Math.max(1, Math.round(duration * fps))

  const codec = await getFirstEncodableVideoCodec(['avc', 'vp9'], { width, height })
  if (!codec) throw new Error('This browser cannot encode H.264 or VP9 video (WebCodecs). Update Chrome and try again.')

  const [previous] = await chrome.tabs.query({ active: true, currentWindow: true })
  // An active tab keeps painting; background tabs are throttled and would stall the screenshots.
  const tab = await chrome.tabs.create({ url: 'about:blank', active: true })
  const target: Target = { tabId: tab.id! }
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  const source = new CanvasSource(canvas, { codec, bitrate: QUALITY_HIGH })
  output.addVideoTrack(source, { frameRate: fps })
  const sheetFrames = new Map(SHEET_AT.map((at) => [Math.min(frames - 1, Math.floor(at * frames)), null as ImageBitmap | null]))
  let started = false

  try {
    onProgress('Opening the render tab…')
    await chrome.debugger.attach(target, PROTOCOL)
    await cdp(target, 'Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await cdp(target, 'Emulation.setScrollbarsHidden', { hidden: true }).catch(() => {})
    await cdp(target, 'Page.enable')
    const { frameTree } = await cdp<{ frameTree: { frame: { id: string } } }>(target, 'Page.getFrameTree')
    await cdp(target, 'Page.setDocumentContent', { frameId: frameTree.frame.id, html: composition.html })
    if (!(await evaluate(target, SETUP))) throw new Error('The composition did not build its timeline.')

    await output.start()
    started = true
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) throw new Error('Stopped.')
      const t = i / fps
      await evaluate(target, `window.__sbSeek(${t})`)
      const shot = await cdp<{ data: string }>(target, 'Page.captureScreenshot', { format: 'jpeg', quality: 92, fromSurface: true, clip: { x: 0, y: 0, width, height, scale: 1 } })
      const bitmap = await decode(shot.data)
      ctx.drawImage(bitmap, 0, 0, width, height)
      if (sheetFrames.has(i)) sheetFrames.set(i, bitmap)
      else bitmap.close()
      await source.add(t, 1 / fps, i % (fps * 2) === 0 ? { keyFrame: true } : undefined)
      if (i % fps === 0) onProgress(`Rendering ${Math.floor(t)} of ${Math.ceil(duration)} s…`)
    }
    onProgress('Finishing the MP4…')
    await output.finalize()
  } catch (err) {
    if (started) await output.cancel().catch(() => {})
    throw err
  } finally {
    await chrome.debugger.detach(target).catch(() => {})
    await chrome.tabs.remove(target.tabId!).catch(() => {})
    if (previous?.id) await chrome.tabs.update(previous.id, { active: true }).catch(() => {})
  }

  const buffer = (output.target as BufferTarget).buffer
  if (!buffer) throw new Error('The render produced no video.')
  const sheet = await contactSheet([...sheetFrames.values()].filter((f): f is ImageBitmap => !!f), width, height)
  sheetFrames.forEach((f) => f?.close())
  const file = await addFile(new Blob([buffer], { type: 'video/mp4' }), `motion-${Date.now()}.mp4`, 'render')
  return { file, seconds: duration, width, height, codec, sheet }
}

// Development builds only (vite build --mode development): lets a local test drive a render and read
// the result back. Production builds drop this block.
if (import.meta.env.MODE === 'development') {
  Object.assign(globalThis, {
    __sbRenderMotion: async (input: MotionInput) => {
      const result = await renderMotionVideo(input, { signal: new AbortController().signal, onProgress: (text) => console.info('[motion]', text) })
      const file = await getFile(result.file.id)
      return { ...result, video: await dataUrl(file!.blob) }
    },
  })
}
