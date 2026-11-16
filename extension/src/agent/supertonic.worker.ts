// The free voice: Supertonic 3 text to speech, run in this browser with ONNX Runtime Web (WebGPU, or
// WebAssembly on the CPU). Adapted from Supertone's MIT-licensed web example
// (github.com/supertone-inc/supertonic/tree/main/web). The model weights (OpenRAIL-M) are not bundled:
// they download once from Hugging Face at a pinned revision and stay in this browser's Cache Storage.
// Supertonic reads plain text (a Unicode index, no phonemizer), so nothing GPL is involved.

import * as ort from 'onnxruntime-web/webgpu'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'

const REVISION = '3cadd1ee6394adea1bd021217a0e650ede09a323'
const BASE = `https://huggingface.co/Supertone/supertonic-3/resolve/${REVISION}`
const CACHE = `supertonic-3-${REVISION.slice(0, 8)}`
const MODELS = ['duration_predictor', 'text_encoder', 'vector_estimator', 'vocoder'] as const
const SUPERTONIC_VOICES = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5']
const LANGS = ['en', 'ko', 'ja', 'ar', 'bg', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi', 'fr', 'hi', 'hr', 'hu', 'id', 'it', 'lt', 'lv', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'vi']

ort.env.wasm.wasmPaths = { wasm: wasmUrl }
ort.env.wasm.proxy = false

type Config = { ae: { sample_rate: number; base_chunk_size: number }; ttl: { chunk_compress_factor: number; latent_dim: number } }
type Style = { ttl: ort.Tensor; dp: ort.Tensor }
type Engine = { cfg: Config; indexer: number[]; sessions: Record<(typeof MODELS)[number], ort.InferenceSession>; gpu: boolean }

let engine: Promise<Engine> | null = null
const styles = new Map<string, Promise<Style>>()
let report: (text: string) => void = () => {}

async function cached(url: string, label: string, size?: number) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(url)
  if (hit) return hit
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Could not download the free voice (${label}: HTTP ${res.status}).`)
  const total = Number(res.headers.get('content-length')) || size || 0
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let got = 0
  let shown = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    got += value.length
    if (total > 20e6 && got - shown > 10e6) {
      shown = got
      report(`Downloading the free voice, once (${label}: ${Math.round(got / 1e6)} of ${Math.round(total / 1e6)} MB)…`)
    }
  }
  const blob = new Blob(parts as BlobPart[])
  await cache.put(url, new Response(blob, { headers: { 'content-type': res.headers.get('content-type') || 'application/octet-stream' } }))
  return new Response(blob)
}

async function load(): Promise<Engine> {
  const cfg = (await (await cached(`${BASE}/onnx/tts.json`, 'config')).json()) as Config
  const indexer = (await (await cached(`${BASE}/onnx/unicode_indexer.json`, 'text index')).json()) as number[]
  const bytes: Uint8Array[] = []
  for (const name of MODELS) bytes.push(new Uint8Array(await (await cached(`${BASE}/onnx/${name}.onnx`, name.replace('_', ' '))).arrayBuffer()))
  report('Loading the free voice…')
  const create = async (providers: string[]) => {
    const sessions: ort.InferenceSession[] = []
    for (const [i, b] of bytes.entries()) {
      report(`Loading the free voice on the ${providers[0] === 'webgpu' ? 'GPU' : 'CPU'} (${i + 1} of ${bytes.length})…`)
      sessions.push(await ort.InferenceSession.create(b, { executionProviders: providers, graphOptimizationLevel: 'all' }))
    }
    return Object.fromEntries(MODELS.map((name, i) => [name, sessions[i]])) as Engine['sessions']
  }
  const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator && !!(await (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null))
  let gpuError = ''
  if (hasGpu) {
    try {
      return { cfg, indexer, sessions: await create(['webgpu']), gpu: true }
    } catch (err) {
      gpuError = err instanceof Error ? err.message : String(err)
    }
  }
  try {
    return { cfg, indexer, sessions: await create(['wasm']), gpu: false }
  } catch (err) {
    throw new Error(`${err instanceof Error ? err.message : String(err)}${gpuError ? ` (WebGPU: ${gpuError})` : ''}`)
  }
}

async function style(voice: string): Promise<Style> {
  const json = (await (await cached(`${BASE}/voice_styles/${voice}.json`, `voice ${voice}`)).json()) as Record<'style_ttl' | 'style_dp', { dims: number[]; data: unknown[] }>
  const tensor = (s: { dims: number[]; data: unknown[] }) => new ort.Tensor('float32', Float32Array.from(s.data.flat(Infinity) as number[]), s.dims)
  return { ttl: tensor(json.style_ttl), dp: tensor(json.style_dp) }
}

const REPLACE: [RegExp | string, string][] = [
  [/[–‑—]/g, '-'], ['_', ' '], [/[“”]/g, '"'], [/[‘’´`]/g, "'"], [/[[\]|/#→←]/g, ' '],
  [/[♥☆♡©\\]/g, ''], ['@', ' at '], ['e.g.,', 'for example, '], ['i.e.,', 'that is, '],
]

function prepare(text: string, lang: string) {
  let t = text.normalize('NFKD').replace(/\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]/gu, '')
  for (const [from, to] of REPLACE) t = typeof from === 'string' ? t.replaceAll(from, to) : t.replace(from, to)
  t = t.replace(/ ([,.!?;:'])/g, '$1').replace(/"{2,}/g, '"').replace(/'{2,}/g, "'").replace(/\s+/g, ' ').trim()
  if (!/[.!?;:,'")\]}…。」』】〉》›»]$/.test(t)) t += '.'
  return `<${lang}>${t}</${lang}>`
}

function chunks(text: string, max: number) {
  const out: string[] = []
  for (const para of text.trim().split(/\n\s*\n+/)) {
    let current = ''
    for (const sentence of para.trim().split(/(?<!\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|etc|vs|Inc|Ltd|Co|Corp|St)\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+/)) {
      if (current && current.length + sentence.length + 1 > max) {
        out.push(current)
        current = sentence
      } else current = current ? `${current} ${sentence}` : sentence
    }
    if (current.trim()) out.push(current.trim())
  }
  return out
}

function gaussian() {
  const u1 = Math.max(1e-4, Math.random())
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random())
}

async function infer(e: Engine, text: string, lang: string, s: Style, steps: number, speed: number) {
  const prepared = prepare(text, lang)
  const ids = new BigInt64Array(prepared.length)
  for (let j = 0; j < prepared.length; j++) {
    const code = prepared.charCodeAt(j)
    ids[j] = BigInt(code < e.indexer.length ? e.indexer[code] : -1)
  }
  const textIds = new ort.Tensor('int64', ids, [1, ids.length])
  const textMask = new ort.Tensor('float32', new Float32Array(ids.length).fill(1), [1, 1, ids.length])

  const { duration } = await e.sessions.duration_predictor.run({ text_ids: textIds, style_dp: s.dp, text_mask: textMask })
  const seconds = (duration.data as Float32Array)[0] / speed
  const { text_emb } = await e.sessions.text_encoder.run({ text_ids: textIds, style_ttl: s.ttl, text_mask: textMask })

  const chunk = e.cfg.ae.base_chunk_size * e.cfg.ttl.chunk_compress_factor
  const dim = e.cfg.ttl.latent_dim * e.cfg.ttl.chunk_compress_factor
  const length = Math.max(1, Math.floor((Math.floor(seconds * e.cfg.ae.sample_rate) + chunk - 1) / chunk))
  let xt = new Float32Array(dim * length)
  for (let k = 0; k < xt.length; k++) xt[k] = gaussian()
  const latentMask = new ort.Tensor('float32', new Float32Array(length).fill(1), [1, 1, length])
  const total = new ort.Tensor('float32', new Float32Array([steps]), [1])
  for (let step = 0; step < steps; step++) {
    const out = await e.sessions.vector_estimator.run({
      noisy_latent: new ort.Tensor('float32', xt, [1, dim, length]),
      text_emb,
      style_ttl: s.ttl,
      latent_mask: latentMask,
      text_mask: textMask,
      current_step: new ort.Tensor('float32', new Float32Array([step]), [1]),
      total_step: total,
    })
    xt = new Float32Array(out.denoised_latent.data as Float32Array)
  }
  const { wav_tts } = await e.sessions.vocoder.run({ latent: new ort.Tensor('float32', xt, [1, dim, length]) })
  const wav = wav_tts.data as Float32Array
  return wav.slice(0, Math.min(wav.length, Math.ceil(seconds * e.cfg.ae.sample_rate)))
}

async function speak({ text, voice, speed, lang }: { text: string; voice: string; speed: number; lang: string }) {
  const language = LANGS.includes(lang) ? lang : 'en'
  engine ??= load().catch((err) => {
    engine = null
    throw err
  })
  const e = await engine
  const name = SUPERTONIC_VOICES.includes(voice) ? voice : 'F1'
  if (!styles.has(name)) styles.set(name, style(name).catch((err) => (styles.delete(name), Promise.reject(err))))
  const s = await styles.get(name)!
  const steps = e.gpu ? 10 : 6
  const parts: Float32Array[] = []
  const gap = new Float32Array(Math.floor(0.25 * e.cfg.ae.sample_rate))
  for (const piece of chunks(text, language === 'ko' || language === 'ja' ? 120 : 300)) {
    if (parts.length) parts.push(gap)
    parts.push(await infer(e, piece, language, s, steps, speed))
  }
  const audio = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    audio.set(p, at)
    at += p.length
  }
  return { audio, sampleRate: e.cfg.ae.sample_rate }
}

self.onmessage = async (event: MessageEvent<{ id: number; text: string; voice: string; speed: number; lang: string }>) => {
  const { id } = event.data
  report = (progress) => self.postMessage({ id, progress })
  try {
    const { audio, sampleRate } = await speak(event.data)
    self.postMessage({ id, audio, sampleRate }, { transfer: [audio.buffer] })
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
