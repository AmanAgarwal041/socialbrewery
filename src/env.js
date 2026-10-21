import fs from 'node:fs/promises';
import path from 'node:path';
import { envFile } from './paths.js';

// Server-wide settings: they live in .env and only the operator of the server changes them.
export const SYSTEM_FIELDS = [
  { key: 'HOST', label: 'Host', secret: false, help: '127.0.0.1 keeps the app on this computer. Use 0.0.0.0 only behind HTTPS.' },
  { key: 'PORT', label: 'Port', secret: false, help: 'Port the server listens on.' },
  { key: 'APP_URL', label: 'App URL', secret: false, help: 'Public address of the app. Every OAuth redirect starts with it.' },
  { key: 'CLERK_PUBLISHABLE_KEY', label: 'Clerk publishable key', secret: false, help: 'pk_test_… or pk_live_… from the Clerk dashboard (API keys). Sign-in and organisations run on Clerk.' },
  { key: 'CLERK_SECRET_KEY', label: 'Clerk secret key', secret: true, help: 'sk_test_… or sk_live_… from the same page.' },
];

// Per-organisation settings: encrypted in data/orgs/<id>/config.json and edited by organisation admins.
export const ORG_FIELDS = [
  {
    key: 'AGENT_PROVIDER',
    label: 'Assistant',
    secret: false,
    help: 'Who runs Brew by default and writes drafts: grok or claude. Brew\'s Grok/Claude tabs switch per message. Video clips are always generated with Grok.',
  },
  {
    key: 'XAI_API_KEY',
    label: 'xAI API key',
    secret: true,
    help: 'From console.x.ai. Grok uses it to write and post, and every assistant uses it to generate clips.',
  },
  {
    key: 'XAI_MODEL',
    label: 'Grok chat model',
    secret: false,
    help: 'Default grok-4.6. Change this to the chat model shown in your xAI console if a request fails.',
  },
  {
    key: 'XAI_VIDEO_MODEL',
    label: 'Grok video model',
    secret: false,
    help: 'Default grok-imagine-video-1.5. Used when Grok generates a Short.',
  },
  {
    key: 'ANTHROPIC_API_KEY',
    label: 'Anthropic API key',
    secret: true,
    help: 'From console.anthropic.com. Used when the assistant or the reviews are set to Claude.',
  },
  {
    key: 'CLAUDE_MODEL',
    label: 'Claude model',
    secret: false,
    help: 'Default claude-opus-5-5. Also claude-sonnet-5-5, claude-haiku-4-5, or claude-fable-5-1.',
  },
  {
    key: 'ANALYSIS_PROVIDER',
    label: 'Analysis provider',
    secret: false,
    help: 'Who writes the performance review: grok, claude, or openai.',
  },
  {
    key: 'OPENAI_API_KEY',
    label: 'OpenAI API key',
    secret: true,
    help: 'From platform.openai.com. Used only when a video review is set to OpenAI.',
  },
  {
    key: 'OPENAI_MODEL',
    label: 'OpenAI model',
    secret: false,
    help: 'Default gpt-5.6-terra. Change this to a chat model from your OpenAI account if a review fails.',
  },
  {
    key: 'YOUTUBE_CLIENT_ID',
    label: 'YouTube client ID',
    secret: false,
    help: 'OAuth client ID from Google Cloud. Application type: Web.',
  },
  {
    key: 'YOUTUBE_CLIENT_SECRET',
    label: 'YouTube client secret',
    secret: true,
    help: 'OAuth client secret from the same Google Cloud credential.',
  },
  {
    key: 'LINKEDIN_CLIENT_ID',
    label: 'LinkedIn client ID',
    secret: false,
    help: 'From LinkedIn Developers. Products: Sign In with LinkedIn using OpenID Connect, and Share on LinkedIn.',
  },
  {
    key: 'LINKEDIN_CLIENT_SECRET',
    label: 'LinkedIn client secret',
    secret: true,
    help: 'OAuth client secret from the same LinkedIn app.',
  },
  {
    key: 'INSTAGRAM_APP_ID',
    label: 'Instagram app ID',
    secret: false,
    help: 'Instagram app ID from the Meta App Dashboard (Instagram API with Instagram Login).',
  },
  {
    key: 'INSTAGRAM_APP_SECRET',
    label: 'Instagram app secret',
    secret: true,
    help: 'Instagram app secret from the same Meta app.',
  },
  {
    key: 'X_CLIENT_ID',
    label: 'X client ID',
    secret: false,
    help: 'OAuth 2.0 Client ID from the X Developer Console (Keys and tokens), not the API key.',
  },
  {
    key: 'X_CLIENT_SECRET',
    label: 'X client secret',
    secret: true,
    help: 'OAuth 2.0 Client Secret for a confidential (Web App) client. Leave empty for a public client.',
  },
  {
    key: 'HASHNODE_TOKEN',
    label: 'Hashnode access token',
    secret: true,
    help: 'Personal access token from hashnode.com → Account settings → Developer. The blog must be on Hashnode Pro for API access.',
  },
  {
    key: 'HASHNODE_PUBLICATION',
    label: 'Hashnode blog',
    secret: false,
    help: 'Blog host (e.g. blog.example.com) or publication id to post to. Leave empty to use your first blog.',
  },
  {
    key: 'SLACK_BOT_TOKEN',
    label: 'Slack bot token',
    secret: true,
    help: 'Bot User OAuth Token (xoxb-…) from your Slack app → OAuth & Permissions, after Install to Workspace.',
  },
  {
    key: 'SLACK_DEFAULT_CHANNEL',
    label: 'Slack default channel',
    secret: false,
    help: 'Channel used when none is named, e.g. #announcements. Optional.',
  },
  {
    key: 'REDDIT_CLIENT_ID',
    label: 'Reddit client ID',
    secret: false,
    help: 'Optional. Reddit works without keys (it opens a pre-filled submit page). Only for approved or pre-2025 web apps from reddit.com/prefs/apps.',
  },
  {
    key: 'REDDIT_CLIENT_SECRET',
    label: 'Reddit client secret',
    secret: true,
    help: 'The secret of the same Reddit web app.',
  },
  {
    key: 'RESEND_API_KEY',
    label: 'Resend API key',
    secret: true,
    help: 'From resend.com → API Keys. Emails to your leads are sent through your Resend account.',
  },
  {
    key: 'EMAIL_FROM',
    label: 'From address',
    secret: false,
    help: 'For example: Ada at Acme <hello@acme.com>. The domain must be verified in Resend.',
  },
  {
    key: 'EMAIL_REPLY_TO',
    label: 'Reply-to address',
    secret: false,
    help: 'Optional. Where replies go, if not the from address.',
  },
  {
    key: 'EMAIL_POSTAL_ADDRESS',
    label: 'Postal address',
    secret: false,
    help: 'Required by anti-spam laws (CAN-SPAM, CASL). Shown at the bottom of every email.',
  },
  {
    key: 'RESEND_WEBHOOK_SECRET',
    label: 'Resend webhook secret',
    secret: true,
    help: 'Optional, recommended. whsec_… from the webhook you add in Resend, so bounces and spam complaints stop future emails.',
  },
  {
    key: 'MCP_PUBLIC_URL',
    label: 'Grok connector public URL',
    secret: false,
    help: 'Optional. HTTPS origin of a tunnel to this app when the server runs on localhost. Grok and Instagram cannot reach localhost. Example: https://your-name.trycloudflare.com',
  },
];

const ORG_KEYS = new Set([...ORG_FIELDS.map((field) => field.key), 'CONNECTOR_TOKEN']);
const SYSTEM_KEYS = new Set(SYSTEM_FIELDS.map((field) => field.key));

const BLOCKED = new Set([
  'PATH',
  'NODE_OPTIONS',
  'NODE_PATH',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'HOME',
  'SHELL',
  'USER',
  'LOGNAME',
]);

export const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export function systemDefaults() {
  return {
    HOST: '127.0.0.1',
    PORT: '3847',
    APP_URL: 'http://127.0.0.1:3847',
    CLERK_PUBLISHABLE_KEY: '',
    CLERK_SECRET_KEY: '',
  };
}

export function orgDefaults() {
  return {
    XAI_API_KEY: '',
    AGENT_PROVIDER: 'grok',
    ANTHROPIC_API_KEY: '',
    CLAUDE_MODEL: 'claude-opus-5-5',
    XAI_MODEL: 'grok-4.6',
    XAI_VIDEO_MODEL: 'grok-imagine-video-1.5',
    ANALYSIS_PROVIDER: 'grok',
    OPENAI_API_KEY: '',
    OPENAI_MODEL: 'gpt-5.6-terra',
    YOUTUBE_CLIENT_ID: '',
    YOUTUBE_CLIENT_SECRET: '',
    LINKEDIN_CLIENT_ID: '',
    LINKEDIN_CLIENT_SECRET: '',
    INSTAGRAM_APP_ID: '',
    INSTAGRAM_APP_SECRET: '',
    X_CLIENT_ID: '',
    X_CLIENT_SECRET: '',
    HASHNODE_TOKEN: '',
    HASHNODE_PUBLICATION: '',
    SLACK_BOT_TOKEN: '',
    SLACK_DEFAULT_CHANNEL: '',
    REDDIT_CLIENT_ID: '',
    REDDIT_CLIENT_SECRET: '',
    RESEND_API_KEY: '',
    EMAIL_FROM: '',
    EMAIL_REPLY_TO: '',
    EMAIL_POSTAL_ADDRESS: '',
    RESEND_WEBHOOK_SECRET: '',
    MCP_PUBLIC_URL: '',
    CONNECTOR_TOKEN: '',
  };
}

export function parseEnv(text) {
  const out = Object.create(null);
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const cleaned = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = cleaned.indexOf('=');
    if (eq <= 0) continue;
    const key = cleaned.slice(0, eq).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) continue;
    let value = cleaned.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = unescapeQuoted(value.slice(1, -1));
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function unescapeQuoted(value) {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '\\' && i + 1 < value.length) {
      const next = value[i + 1];
      i += 1;
      if (next === 'n') out += '\n';
      else if (next === '"') out += '"';
      else if (next === '\\') out += '\\';
      else out += next;
    } else {
      out += value[i];
    }
  }
  return out;
}

function quote(value) {
  const text = String(value ?? '');
  if (text === '') return '';
  if (/^[A-Za-z0-9_./:@%+-]+$/.test(text)) return text;
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

export function serializeEnv(values) {
  const lines = [
    '# Socialbrewery server settings.',
    '# Organisation keys (AI, networks, connector) are not here: they are encrypted per organisation.',
    '# Variables set on the process (a service manager, a hosting dashboard) override the values below.',
    '',
  ];
  for (const field of SYSTEM_FIELDS) {
    lines.push(`${field.key}=${quote(values[field.key] ?? '')}`);
  }
  for (const key of Object.keys(values).sort()) {
    if (SYSTEM_KEYS.has(key) || !values[key]) continue;
    lines.push(`${key}=${quote(values[key])}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function normalizeSystem(values) {
  const errors = [];
  const warnings = [];
  const host = String(values.HOST || '127.0.0.1').trim();
  const port = Number(values.PORT || 3847);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('PORT must be an integer from 1 to 65535.');
  let url;
  try {
    url = new URL(values.APP_URL || `http://127.0.0.1:${port}`);
  } catch {
    errors.push('APP_URL must be a valid URL.');
  }
  if (url && url.protocol !== 'http:' && url.protocol !== 'https:') errors.push('APP_URL must be http or https.');
  if (url && url.protocol === 'http:' && (!LOOPBACK.has(host) || !LOOPBACK.has(url.hostname))) {
    warnings.push('The app is reachable beyond this computer over plain http. Put it behind HTTPS so sign-in cookies stay private.');
  }
  return { host, port, appUrl: url ? url.origin : '', errors, warnings };
}

export function normalizeOrgSettings(input, current = {}, clear = []) {
  const incoming = input && typeof input === 'object' ? input : {};
  const cleared = new Set(Array.isArray(clear) ? clear : []);
  const values = { ...orgDefaults(), ...current };
  const errors = [];

  for (const field of ORG_FIELDS) {
    const raw = incoming[field.key];
    if (raw != null && typeof raw !== 'string' && typeof raw !== 'number') {
      errors.push(`${field.label} must be text.`);
      continue;
    }
    const text = raw == null ? '' : String(raw).trim();
    if (text.length > 8000) errors.push(`${field.label} is too long.`);
    if (/[\r\n]/.test(text)) errors.push(`${field.label} cannot contain a new line.`);
    if (field.secret) {
      // Secrets are never sent to the browser, so a blank field means "keep the saved one".
      if (cleared.has(field.key)) values[field.key] = '';
      else if (text) values[field.key] = text;
    } else if (raw != null) {
      values[field.key] = text;
    }
  }

  if (values.MCP_PUBLIC_URL) {
    values.MCP_PUBLIC_URL = values.MCP_PUBLIC_URL.replace(/\/mcp\/?$/, '').replace(/\/$/, '');
    let publicUrl;
    try {
      publicUrl = new URL(values.MCP_PUBLIC_URL);
    } catch {
      errors.push('Public URL must be a valid URL.');
    }
    if (publicUrl) {
      if (publicUrl.protocol !== 'https:' && !LOOPBACK.has(publicUrl.hostname)) errors.push('Public URL must be https.');
      values.MCP_PUBLIC_URL = publicUrl.origin;
    }
  }

  if (!values.XAI_MODEL) values.XAI_MODEL = orgDefaults().XAI_MODEL;
  if (!values.XAI_VIDEO_MODEL) values.XAI_VIDEO_MODEL = orgDefaults().XAI_VIDEO_MODEL;
  if (!values.OPENAI_MODEL) values.OPENAI_MODEL = orgDefaults().OPENAI_MODEL;
  if (!values.CLAUDE_MODEL) values.CLAUDE_MODEL = orgDefaults().CLAUDE_MODEL;
  const provider = String(values.ANALYSIS_PROVIDER || 'grok').toLowerCase();
  if (!['grok', 'claude', 'openai'].includes(provider)) errors.push('Analysis provider must be grok, claude, or openai.');
  else values.ANALYSIS_PROVIDER = provider;
  if (values.EMAIL_FROM) {
    const match = /^\s*(?:"?([^"<]*)"?\s*<([^>]+)>|([^\s<>]+))\s*$/.exec(values.EMAIL_FROM);
    const address = String(match?.[2] || match?.[3] || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address)) errors.push('From address must look like Name <hello@yourdomain.com>.');
  }
  if (values.EMAIL_REPLY_TO && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.EMAIL_REPLY_TO.trim())) errors.push('Reply-to must be an email address.');
  if (values.RESEND_WEBHOOK_SECRET && !/^whsec_[A-Za-z0-9+/=]+$/.test(values.RESEND_WEBHOOK_SECRET.trim())) errors.push('The Resend webhook secret starts with whsec_.');
  const agent = String(values.AGENT_PROVIDER || 'grok').toLowerCase();
  if (!['grok', 'claude'].includes(agent)) errors.push('Assistant must be grok or claude.');
  else values.AGENT_PROVIDER = agent;

  return { values, errors };
}

export function orgSettingsView(config) {
  return ORG_FIELDS.map((field) => ({
    key: field.key,
    label: field.label,
    secret: field.secret,
    help: field.help,
    value: field.secret ? '' : config[field.key] ?? '',
    set: Boolean(config[field.key]),
  }));
}

export function appUrl() {
  const raw = process.env.APP_URL || `http://127.0.0.1:${process.env.PORT || 3847}`;
  return raw.replace(/\/$/, '');
}

export function secureCookies() {
  return appUrl().startsWith('https:');
}

export async function writeEnv(values) {
  const text = serializeEnv(values);
  const tmp = `${envFile}.${process.pid}.tmp`;
  const handle = await fs.open(tmp, 'w', 0o600);
  try {
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, envFile);
}

async function readEnvValues() {
  try {
    return parseEnv(await fs.readFile(envFile, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return Object.create(null);
  }
}

// Variables already set on the process (a service manager, a hosting dashboard) win over .env.
export async function loadEnv() {
  await fs.mkdir(path.dirname(envFile), { recursive: true });
  const parsed = await readEnvValues();
  const fileValues = { ...systemDefaults(), ...parsed };
  if (SYSTEM_FIELDS.some((field) => !Object.prototype.hasOwnProperty.call(parsed, field.key))) await writeEnv(fileValues);
  const values = { ...fileValues };
  for (const [key, value] of Object.entries(fileValues)) {
    if (BLOCKED.has(key) || ORG_KEYS.has(key)) continue;
    if (process.env[key]) values[key] = process.env[key];
    else if (value) process.env[key] = value;
  }
  for (const field of SYSTEM_FIELDS) if (process.env[field.key]) values[field.key] = process.env[field.key];
  return values;
}

// Keys from before organisations existed, for moving into the first organisation.
export async function legacyOrgSettings() {
  const parsed = await readEnvValues();
  const legacy = {};
  for (const key of ORG_KEYS) if (parsed[key]) legacy[key] = parsed[key];
  return legacy;
}

export async function stripLegacyOrgSettings() {
  const parsed = await readEnvValues();
  const kept = Object.create(null);
  for (const [key, value] of Object.entries(parsed)) if (!ORG_KEYS.has(key)) kept[key] = value;
  await writeEnv({ ...systemDefaults(), ...kept });
  for (const key of ORG_KEYS) delete process.env[key];
}
