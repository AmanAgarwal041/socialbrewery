// Voiceover for motion videos rendered in this browser. Every video gets a voice by default:
//   - ElevenLabs, when the user added a key and a voice id (their own clone or any library voice),
//   - xAI (Grok) text to speech with the xAI key, including a voice the user cloned from a sample,
//   - OpenAI text to speech with the OpenAI key (gpt-4o-mini-tts, steered by a style instruction),
//   - otherwise Supertonic, free and open, run on this computer (supertonic.worker.ts).
// "auto" picks the first one that is set up, and falls back to the free voice if a paid one fails.

import type { Settings, VoiceProvider } from '../storage'

export const SUPERTONIC_VOICES = [
  { id: 'F1', label: 'Female 1' },
  { id: 'F2', label: 'Female 2' },
  { id: 'F3', label: 'Female 3' },
  { id: 'F4', label: 'Female 4' },
  { id: 'F5', label: 'Female 5' },
  { id: 'M1', label: 'Male 1' },
  { id: 'M2', label: 'Male 2' },
  { id: 'M3', label: 'Male 3' },
  { id: 'M4', label: 'Male 4' },
  { id: 'M5', label: 'Male 5' },
]
export const OPENAI_VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse']
export const XAI_VOICES = ['eve', 'ara', 'leo', 'rex', 'sal']

export const VOICE_PROVIDERS: { id: VoiceProvider; label: string }[] = [
  { id: 'auto', label: 'Automatic (best one set up)' },
  { id: 'supertonic', label: 'Free, on this computer (Supertonic)' },
  { id: 'xai', label: 'xAI voice or your xAI clone' },
  { id: 'openai', label: 'OpenAI voice' },
  { id: 'elevenlabs', label: 'ElevenLabs voice or clone' },
]

type Resolved = Exclude<VoiceProvider, 'auto'>
export type Voice = { provider: Resolved; voice: string; label: string }

export function pickVoice(settings: Settings): Voice {
  const want = settings.voiceProvider
  const eleven = settings.elevenlabsKey && settings.elevenlabsVoiceId
  if (want === 'elevenlabs' || (want === 'auto' && eleven)) {
    if (!eleven) throw new Error('Add an ElevenLabs API key and voice id in Settings → Voiceover.')
    return { provider: 'elevenlabs', voice: settings.elevenlabsVoiceId, label: `ElevenLabs voice ${settings.elevenlabsVoiceId}` }
  }
  if (want === 'xai' || (want === 'auto' && settings.xaiKey)) {
    if (!settings.xaiKey) throw new Error('The xAI voice needs an xAI API key in Settings.')
    const voice = settings.xaiVoice || 'eve'
    return { provider: 'xai', voice, label: `xAI voice ${voice}${XAI_VOICES.includes(voice) ? '' : ' (your clone)'}` }
  }
  if (want === 'openai' || (want === 'auto' && settings.openaiKey)) {
    if (!settings.openaiKey) throw new Error('The OpenAI voice needs an OpenAI API key in Settings.')
    const voice = settings.openaiVoice || 'marin'
    return { provider: 'openai', voice, label: `OpenAI voice ${voice}` }
  }
  const voice = settings.supertonicVoice || 'F1'
  return { provider: 'supertonic', voice, label: `free Supertonic voice ${voice}` }
}

// ---------- providers ----------

async function failed(res: Response, name: string) {
  const body = await res.text().catch(() => '')
  let detail = body.slice(0, 200)
  try {
    const json = JSON.parse(body)
    detail = json.error?.message || json.detail?.message || json.detail || json.error || json.message || detail
  } catch {
    // Not JSON.
  }
  if (res.status === 401 || res.status === 403) return new Error(`${name} rejected the API key (${res.status}). Check it in Settings.`)
  return new Error(`${name} voice failed (${res.status})${detail ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
}

async function elevenlabs(settings: Settings, text: string, speed: number, signal: AbortSignal) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(settings.elevenlabsVoiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': settings.elevenlabsKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: settings.elevenlabsModel || 'eleven_multilingual_v2',
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true, speed: Math.min(1.2, Math.max(0.7, speed)) },
    }),
    signal,
  })
  if (!res.ok) throw await failed(res, 'ElevenLabs')
  return res.arrayBuffer()
}

async function xai(settings: Settings, voice: string, text: string, speed: number, signal: AbortSignal) {
  const res = await fetch('https://api.x.ai/v1/tts', {
    method: 'POST',
    headers: { authorization: `Bearer ${settings.xaiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text, voice_id: voice, language: settings.voiceLanguage || 'en', speed, text_normalization: true, output_format: { codec: 'mp3', sample_rate: 44100, bit_rate: 128000 } }),
    signal,
  })
  if (!res.ok) throw await failed(res, 'xAI')
  // The reference documents JSON with base64 audio; raw audio bytes are accepted too.
  if ((res.headers.get('content-type') || '').includes('json')) {
    const json = (await res.json()) as { audio?: string }
    if (!json.audio) throw new Error('xAI returned no audio.')
    return Uint8Array.from(atob(json.audio), (c) => c.charCodeAt(0)).buffer
  }
  return res.arrayBuffer()
}

async function openai(settings: Settings, voice: string, text: string, signal: AbortSignal) {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { authorization: `Bearer ${settings.openaiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice, input: text, instructions: settings.voiceStyle, response_format: 'mp3' }),
    signal,
  })
  if (!res.ok) throw await failed(res, 'OpenAI')
  return res.arrayBuffer()
}

// One worker for the side panel's lifetime keeps the model loaded between scenes and videos.
let worker: Worker | null = null
let nextId = 0

function supertonic(voice: string, text: string, speed: number, lang: string, signal: AbortSignal, onProgress: (text: string) => void) {
  worker ??= new Worker(new URL('./supertonic.worker.ts', import.meta.url), { type: 'module' })
  const w = worker
  const id = ++nextId
  return new Promise<{ audio: Float32Array; sampleRate: number }>((resolve, reject) => {
    const done = () => {
      w.removeEventListener('message', onMessage)
      signal.removeEventListener('abort', onAbort)
    }
    const onMessage = (e: MessageEvent<{ id: number; progress?: string; error?: string; audio?: Float32Array; sampleRate?: number }>) => {
      if (e.data.id !== id) return
      if (e.data.progress) return onProgress(e.data.progress)
      done()
      if (e.data.error) reject(new Error(`The free voice failed: ${e.data.error}`))
      else resolve({ audio: e.data.audio!, sampleRate: e.data.sampleRate! })
    }
    const onAbort = () => {
      done()
      // A running inference cannot be interrupted, so the worker is replaced.
      w.terminate()
      if (worker === w) worker = null
      reject(new Error('Stopped.'))
    }
    w.addEventListener('message', onMessage)
    signal.addEventListener('abort', onAbort, { once: true })
    w.postMessage({ id, text, voice, speed, lang })
  })
}

const SAMPLE_RATE = 48000

async function synthesize(choice: Voice, settings: Settings, text: string, speed: number, signal: AbortSignal, onProgress: (text: string) => void): Promise<AudioBuffer> {
  if (choice.provider === 'supertonic') {
    const { audio, sampleRate } = await supertonic(choice.voice, text, speed, settings.voiceLanguage || 'en', signal, onProgress)
    const buffer = new AudioBuffer({ length: Math.max(1, audio.length), sampleRate, numberOfChannels: 1 })
    buffer.copyToChannel(audio as Float32Array<ArrayBuffer>, 0)
    return buffer
  }
  const bytes =
    choice.provider === 'elevenlabs'
      ? await elevenlabs(settings, text, speed, signal)
      : choice.provider === 'xai'
        ? await xai(settings, choice.voice, text, speed, signal)
        : await openai(settings, choice.voice, text, signal)
  return new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(bytes)
}

/** Speaks each line (empty lines stay silent), falling back to the free voice in auto mode. */
export async function speakLines(lines: string[], settings: Settings, speed: number, signal: AbortSignal, onProgress: (text: string) => void) {
  let choice = pickVoice(settings)
  let note = ''
  const clips: (AudioBuffer | null)[] = []
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim()
    if (!text) {
      clips.push(null)
      continue
    }
    if (signal.aborted) throw new Error('Stopped.')
    onProgress(`Recording the voiceover (${i + 1} of ${lines.length})…`)
    try {
      clips.push(await synthesize(choice, settings, text, speed, signal, onProgress))
    } catch (err) {
      if (signal.aborted || choice.provider === 'supertonic' || settings.voiceProvider !== 'auto') throw err
      note = `${choice.label} failed (${err instanceof Error ? err.message : String(err)}), so the free voice was used.`
      choice = { provider: 'supertonic', voice: settings.supertonicVoice || 'F1', label: `free Supertonic voice ${settings.supertonicVoice || 'F1'}` }
      clips.length = 0
      i = -1
    }
  }
  return { clips, voice: choice, note }
}

/** Places each clip at its start time and returns one stereo track, peak-normalized. */
export async function mixVoiceover(clips: { buffer: AudioBuffer; at: number }[], seconds: number) {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE)
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -18
  comp.ratio.value = 3
  comp.connect(ctx.destination)
  for (const clip of clips) {
    const src = ctx.createBufferSource()
    src.buffer = clip.buffer
    src.connect(comp)
    src.start(clip.at)
  }
  const out = await ctx.startRendering()
  let peak = 0
  for (let c = 0; c < out.numberOfChannels; c++) for (const v of out.getChannelData(c)) peak = Math.max(peak, Math.abs(v))
  if (peak > 0) {
    const gain = 0.9 / peak
    for (let c = 0; c < out.numberOfChannels; c++) {
      const data = out.getChannelData(c)
      for (let k = 0; k < data.length; k++) data[k] *= gain
    }
  }
  return out
}

/** Creates a custom xAI voice from a sample of the user's own voice (or one they have permission to use). */
export async function cloneXaiVoice(apiKey: string, file: File, name: string) {
  if (file.size > 25 * 1024 * 1024) throw new Error('Use a sample under 25 MB (up to 120 seconds of clear speech).')
  const form = new FormData()
  form.append('file', file, file.name)
  form.append('name', name || 'My voice')
  form.append('use_case', 'narration')
  const res = await fetch('https://api.x.ai/v1/custom-voices', { method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: form })
  if (!res.ok) throw await failed(res, 'xAI')
  const json = (await res.json()) as { voice_id?: string }
  if (!json.voice_id) throw new Error('xAI did not return a voice id.')
  return json.voice_id
}
