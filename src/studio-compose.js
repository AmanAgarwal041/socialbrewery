// The pure part of Video Studio: scene validation and filling the HyperFrames composition template.
// No imports and no I/O, so the Chrome extension bundles it too (it renders compositions in the
// browser for free). src/studio.js wraps it with the bundled template and brand kits.

export const FORMATS = {
  '9x16': { w: 1080, h: 1920, u: 20, hsize: 6.4, shotw: '92%', capy: '300px' },
  '16x9': { w: 1920, h: 1080, u: 20, hsize: 5.2, shotw: '72%', capy: '70px' },
};
export const TEMPLATES = {
  'short-vertical': { format: '9x16', description: 'Vertical Short, 1080x1920, 20 to 60 s.' },
  'launch-landscape': { format: '16x9', description: 'Landscape launch or promo, 1920x1080, 30 to 90 s.' },
};
export const EFFECTS = ['focus', 'zoom-through', 'rack', 'hinge', 'slats', 'shutter', 'pillars', 'endcard', 'pop', 'kinetic', 'split', 'wipe', 'counter'];
const MAX_SCENES = 30;

/** JSON Schema for one scene, shared by the MCP connector, Brew, and the Chrome extension. */
export const SCENE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kicker: { type: 'string', description: 'Small mono label above the headline.' },
    headline: { type: 'string', description: 'On-screen headline, max about 8 words. No em dashes.' },
    highlight: { type: 'string', description: 'One word of the headline to color with the accent.' },
    sub: { type: 'string' },
    image: { type: 'string', description: 'REAL screenshot: https URL, data:image URI, or assets/<file> from add_studio_asset.' },
    label: { type: 'string', description: 'Corner label, e.g. "STYLIZED TRANSITION" for anything illustrative.' },
    focus: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, scale: { type: 'number' } }, description: 'Zoom target in % of the screenshot and the zoom scale.' },
    effect: { type: 'string', enum: EFFECTS, description: 'Entry effect. zoom-through/shutter also style the exit of the previous scene. endcard shows loader, CTA, and question. pop: soft clay-like squash-in. kinetic: words land one at a time. split: headline halves slide in from both sides. wipe: accent panel wipes away. counter: counts stat.value up.' },
    stat: { type: 'object', properties: { value: { type: 'number' }, prefix: { type: 'string' }, suffix: { type: 'string' }, decimals: { type: 'integer' } }, required: ['value'], description: 'A REAL number shown big and counted up (effect "counter"), e.g. { value: 40, suffix: "%" }. Never invent one.' },
    pillars: { type: 'array', items: { type: 'number' }, description: 'For effect "pillars": measured bar heights from the real chart.' },
    captions: { type: 'array', items: { type: 'object', properties: { at: { type: 'number' }, text: { type: 'string' } } }, description: 'Burned-in caption chunks, seconds from scene start.' },
    duration: { type: 'number', description: 'Seconds. Match the voiceover line length.' },
  },
};


const HEX = /^#[0-9a-f]{3,8}$/i;

export function normalizeBrand(input = {}, base) {
  const out = structuredClone(base);
  if (input.id) out.id = String(input.id).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40);
  for (const key of ['name', 'tagline', 'logoUrl', 'website', 'github', 'notes']) {
    if (input[key] != null) out[key] = String(input[key]).slice(0, 500);
  }
  for (const [key, value] of Object.entries(input.colors || {})) {
    if (!HEX.test(String(value))) throw new Error(`Brand color ${key} must be a hex color like #C2410C.`);
    out.colors[key] = value;
  }
  if (input.fonts) out.fonts = { ...out.fonts, ...input.fonts };
  if (input.voice) out.voice = { ...out.voice, ...input.voice };
  if (input.cta) out.cta = { ...out.cta, ...input.cta };
  if (Array.isArray(input.keywords)) out.keywords = input.keywords.map(String).slice(0, 30);
  return out;
}

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const noDashes = (s) => String(s ?? '').replace(/\s*[\u2013\u2014]\s*/g, ', ');

function imageSrc(src) {
  const value = String(src || '');
  if (!value) return '';
  if (/^https:\/\//i.test(value) || /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value) || /^assets\/[\w.-]+$/.test(value)) return value;
  throw new Error('Scene images must be https URLs, data:image URIs, or assets/<file> from add_studio_asset.');
}

function headlineHtml(text, highlight) {
  return noDashes(text).split(/\s+/).filter(Boolean).map((word) => {
    const hl = highlight && word.toLowerCase().replace(/[^\w]/g, '') === String(highlight).toLowerCase().replace(/[^\w]/g, '');
    return `<span class="w${hl ? ' hl' : ''}">${escapeHtml(word)}</span>`;
  }).join(' ');
}

export function normalizeScenes(scenes) {
  if (!Array.isArray(scenes) || !scenes.length) throw new Error('Give at least one scene.');
  if (scenes.length > MAX_SCENES) throw new Error(`At most ${MAX_SCENES} scenes.`);
  return scenes.map((s, i) => {
    const duration = Number(s.duration || 4);
    if (!(duration >= 0.5 && duration <= 30)) throw new Error(`Scene ${i + 1}: duration must be 0.5 to 30 seconds.`);
    const effect = s.effect || (s.pillars ? 'pillars' : 'focus');
    if (!EFFECTS.includes(effect)) throw new Error(`Scene ${i + 1}: effect must be one of ${EFFECTS.join(', ')}.`);
    const pillars = Array.isArray(s.pillars) ? s.pillars.map(Number).filter((n) => n > 0).slice(0, 12) : [];
    if (effect === 'pillars' && !pillars.length) throw new Error(`Scene ${i + 1}: pillars needs the measured bar heights from the real chart.`);
    const stat = s.stat && Number.isFinite(Number(s.stat.value))
      ? { value: Number(s.stat.value), prefix: noDashes(s.stat.prefix).slice(0, 8), suffix: noDashes(s.stat.suffix).slice(0, 12), decimals: Math.min(3, Math.max(0, Math.floor(Number(s.stat.decimals) || 0))) }
      : null;
    if (effect === 'counter' && !stat) throw new Error(`Scene ${i + 1}: counter needs stat.value, a real number to count up to.`);
    const captions = Array.isArray(s.captions) ? s.captions.map((c) => ({ at: Math.max(0, Number(c.at) || 0), text: noDashes(c.text).slice(0, 80) })) : [];
    return {
      kicker: noDashes(s.kicker).slice(0, 60),
      headline: noDashes(s.headline).slice(0, 140),
      highlight: s.highlight ? String(s.highlight) : '',
      sub: noDashes(s.sub).slice(0, 220),
      image: imageSrc(s.image),
      label: noDashes(s.label || (pillars.length ? 'STYLIZED TRANSITION' : '')).slice(0, 40),
      focus: s.focus ? { x: Number(s.focus.x ?? 50), y: Number(s.focus.y ?? 50), scale: Number(s.focus.scale ?? 1.6) } : null,
      effect,
      pillars,
      stat,
      captions,
      duration,
    };
  });
}

function sceneHtml(s, i, start, brand, end) {
  const parts = [];
  if (s.kicker) parts.push(`<div class="kicker">${escapeHtml(s.kicker)}</div>`);
  if (s.effect === 'endcard') {
    parts.push('<div class="loader"><b></b><b></b><b></b></div>');
    if (s.headline) parts.push(`<div class="headline">${headlineHtml(s.headline, s.highlight)}</div>`);
    if (end.cta?.label) parts.push(`<div class="btn">${escapeHtml(noDashes(end.cta.label))}</div>`);
    if (end.cta?.url) parts.push(`<div class="url">${escapeHtml(end.cta.url.replace(/^https?:\/\//, ''))}</div>`);
    if (end.question) parts.push(`<div class="question">${escapeHtml(noDashes(end.question))}</div>`);
  } else {
    if (s.headline) parts.push(`<div class="headline">${headlineHtml(s.headline, s.highlight)}</div>`);
    if (s.stat) parts.unshift(`<div class="stat">${escapeHtml(s.stat.prefix)}<span class="num" data-value="${s.stat.value}" data-decimals="${s.stat.decimals}">${(0).toFixed(s.stat.decimals)}</span>${escapeHtml(s.stat.suffix)}</div>`);
    if (s.sub) parts.push(`<div class="sub">${escapeHtml(s.sub)}</div>`);
    if (s.pillars.length) {
      const max = Math.max(...s.pillars);
      parts.push(`<div class="pillars">${s.pillars.map((h) => `<div class="pillar" style="height:${Math.round((h / max) * 100)}%"></div>`).join('')}${s.label ? `<div class="label">${escapeHtml(s.label)}</div>` : ''}</div>`);
    } else if (s.image) {
      parts.push(`<div class="shot"><img src="${escapeHtml(s.image)}" alt="" />${s.label ? `<div class="label">${escapeHtml(s.label)}</div>` : ''}</div>`);
    }
  }
  const slats = s.effect === 'slats' ? `<div class="slats">${'<i></i>'.repeat(8)}</div>` : s.effect === 'wipe' ? '<div class="wipe"></div>' : '';
  const caps = s.captions.map((c, k) => {
    const next = s.captions[k + 1]?.at ?? s.duration;
    const dur = Math.max(0.2, next - c.at);
    return `    <div class="clip caption" id="cap-${i}-${k}" data-start="${(start + c.at).toFixed(3)}" data-duration="${dur.toFixed(3)}" data-track-index="3">${escapeHtml(c.text)}</div>`;
  });
  return [`    <div class="scene" id="s${i}">${parts.join('')}${slats}</div>`, ...caps].join('\n');
}

/** Fills a composition template (studio/templates/composition.html) from a brand kit and scenes. */
export function composeHtml(template, { format = '9x16', brand, scenes, cta, question, audio }) {
  const f = FORMATS[format];
  if (!f) throw new Error('format must be 9x16 or 16x9.');
  const kit = brand;
  const list = normalizeScenes(scenes);
  const total = list.reduce((sum, s) => sum + s.duration, 0);
  const vars = {
    ...Object.fromEntries(Object.entries(kit.colors).map(([k, v]) => [`--${k}`, v])),
    '--sans': `"${kit.fonts?.sans || 'Inter'}"`,
    '--mono': `"${kit.fonts?.mono || 'Geist Mono'}"`,
    '--u': `${f.u}px`,
    '--hsize': f.hsize,
    '--shotw': f.shotw,
    '--capy': f.capy,
  };
  let at = 0;
  const end = { cta: cta || kit.cta, question };
  const html = list.map((s, i) => { const out = sceneHtml(s, i, at, kit, end); at += s.duration; return out; }).join('\n');
  const audioTag = audio ? `  <audio id="vo" src="${escapeHtml(audio)}" data-start="0" data-duration="${total.toFixed(3)}" data-track-index="2"></audio>` : '';
  const spec = JSON.stringify({ scenes: list.map(({ duration, effect, focus }) => ({ duration, effect, focus })) }).replace(/</g, '\\u003c');
  const fill = {
    W: String(f.w),
    H: String(f.h),
    DURATION: total.toFixed(3),
    CSS_VARS: Object.entries(vars).map(([k, v]) => `${k}: ${v};`).join(' '),
    SCENES_HTML: html,
    AUDIO: audioTag,
    SPEC_JSON: spec,
  };
  const out = template.replace(/\{\{(\w+)\}\}/g, (m, key) => (Object.hasOwn(fill, key) ? fill[key] : m));
  return { html: out, duration: Number(total.toFixed(3)), width: f.w, height: f.h, scenes: list };
}

