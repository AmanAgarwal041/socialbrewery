const PRIVACY = new Set(['public', 'unlisted', 'private']);

export function clampTitle(title) {
  const clean = String(title || '').replace(/\s+/g, ' ').trim();
  const base = clean || 'Short';
  return Array.from(base).slice(0, 100).join('');
}

export function clampDescription(description) {
  let text = String(description || '').trim();
  if (!/#shorts\b/i.test(text)) {
    text = text ? `${text}\n\n#Shorts` : '#Shorts';
  }
  return text.slice(0, 5000);
}

export function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || '').split(',');
  const out = [];
  let total = 0;
  for (const tag of list) {
    const clean = String(tag).replace(/^#/, '').replace(/\s+/g, ' ').trim().slice(0, 30);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (out.some((item) => item.toLowerCase() === key)) continue;
    const separator = out.length ? 1 : 0;
    if (total + clean.length + separator > 400) break;
    out.push(clean);
    total += clean.length + separator;
  }
  if (!out.some((tag) => tag.toLowerCase() === 'shorts')) out.unshift('Shorts');
  return out.slice(0, 15);
}

export function normalizePrivacy(value) {
  const privacy = String(value || '').toLowerCase();
  return PRIVACY.has(privacy) ? privacy : 'unlisted';
}

export function clampSeconds(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 8;
  return Math.min(15, Math.max(1, n));
}

export function buildVideoUpdate(current, patch = {}) {
  const videoId = current?.id;
  if (!/^[a-zA-Z0-9_-]{11}$/.test(String(videoId || ''))) {
    throw new Error('That is not a YouTube video id.');
  }
  const snippetIn = current.snippet || {};
  const statusIn = current.status || {};
  const parts = [];
  const body = { id: videoId };
  const titleGiven = patch.title != null && String(patch.title).trim() !== '';
  const descriptionGiven = patch.description != null;
  const tagsGiven = patch.tags != null;
  if (titleGiven || descriptionGiven || tagsGiven) {
    parts.push('snippet');
    const snippet = {
      title: titleGiven ? clampTitle(patch.title) : (snippetIn.title || 'Short'),
      description: descriptionGiven ? clampDescription(patch.description) : String(snippetIn.description || ''),
      tags: tagsGiven ? normalizeTags(patch.tags) : (Array.isArray(snippetIn.tags) ? snippetIn.tags : []),
      categoryId: String(snippetIn.categoryId || '22'),
    };
    if (snippetIn.defaultLanguage) snippet.defaultLanguage = snippetIn.defaultLanguage;
    if (snippetIn.defaultAudioLanguage) snippet.defaultAudioLanguage = snippetIn.defaultAudioLanguage;
    body.snippet = snippet;
  }
  if (patch.privacyStatus != null && String(patch.privacyStatus).trim() !== '') {
    const privacy = String(patch.privacyStatus).toLowerCase();
    if (!PRIVACY.has(privacy)) throw new Error('Privacy must be public, unlisted, or private.');
    parts.push('status');
    const status = {
      privacyStatus: privacy,
      selfDeclaredMadeForKids: Boolean(statusIn.selfDeclaredMadeForKids),
    };
    if (typeof statusIn.embeddable === 'boolean') status.embeddable = statusIn.embeddable;
    if (statusIn.license) status.license = statusIn.license;
    if (typeof statusIn.publicStatsViewable === 'boolean') status.publicStatsViewable = statusIn.publicStatsViewable;
    body.status = status;
  }
  if (!parts.length) throw new Error('Say what to change: title, description, tags, or privacy.');
  return { parts, body };
}

export function buildVideoBody({ title, description, tags, privacyStatus, madeForKids }) {
  return {
    snippet: {
      title: clampTitle(title),
      description: clampDescription(description),
      tags: normalizeTags(tags),
      categoryId: '22',
    },
    status: {
      privacyStatus: normalizePrivacy(privacyStatus),
      selfDeclaredMadeForKids: Boolean(madeForKids),
    },
  };
}
