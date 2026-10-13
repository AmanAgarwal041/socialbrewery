import { randomBytes } from 'node:crypto';
import { addPost, clearNetworkToken, readNetworkToken, writeNetworkToken } from './store.js';
import { cfg } from './context.js';

const GQL = 'https://gql.hashnode.com';
const PRO_REQUIRED =
  'Hashnode only answers API calls for publications on the Pro plan. Upgrade the blog under Dashboard → Billing, then try again.';

function token() {
  const value = String(cfg.HASHNODE_TOKEN || '').trim();
  if (!value) {
    const err = new Error('Add your Hashnode personal access token in Settings (an organisation admin can do this).');
    err.status = 400;
    throw err;
  }
  return value;
}

export async function hashnodeGql(query, variables = {}) {
  const res = await fetch(GQL, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', Authorization: token() },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status >= 300 && res.status < 400) {
    const err = new Error(PRO_REQUIRED);
    err.status = 400;
    throw err;
  }
  const data = await res.json().catch(() => null);
  if (!data) {
    const err = new Error(`Hashnode did not answer (${res.status}).`);
    err.status = 502;
    throw err;
  }
  if (data.errors?.length) {
    const first = data.errors[0];
    const code = first.extensions?.code || '';
    let message = first.message || 'Hashnode rejected the request.';
    if (code === 'UNAUTHENTICATED') message = 'Hashnode rejected the token. Create a new one under Account settings → Developer, paste it in Settings, and reconnect.';
    else if (code === 'FORBIDDEN' && /pro|plan|subscription/i.test(message)) message = PRO_REQUIRED;
    const err = new Error(message);
    err.status = 400;
    throw err;
  }
  return data.data;
}

function pickPublication(publications, wanted) {
  const target = String(wanted || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!target) return publications[0];
  return publications.find((pub) => {
    const host = String(pub.url || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    return pub.id.toLowerCase() === target || host === target;
  });
}

export async function connectHashnode() {
  const data = await hashnodeGql(`query Me {
    me {
      id
      username
      name
      profilePicture
      publications(first: 20) { edges { node { id title url } } }
    }
  }`);
  const me = data?.me;
  if (!me?.id) throw new Error('Hashnode did not return your account.');
  const publications = (me.publications?.edges || []).map((edge) => edge.node).filter(Boolean);
  if (!publications.length) throw new Error('This Hashnode account has no blog yet. Create one on hashnode.com first.');
  const publication = pickPublication(publications, cfg.HASHNODE_PUBLICATION);
  if (!publication) {
    throw new Error(
      `No blog matches "${cfg.HASHNODE_PUBLICATION}". Use one of: ${publications.map((p) => p.url).join(', ')}`,
    );
  }
  const picture = typeof me.profilePicture === 'string' && me.profilePicture.startsWith('https:') ? me.profilePicture : '';
  const account = {
    id: me.id,
    username: me.username || '',
    title: publication.title || me.name || `@${me.username}`,
    name: me.name || '',
    picture,
    publication: { id: publication.id, title: publication.title || '', url: publication.url || '' },
    publications: publications.map((p) => ({ id: p.id, title: p.title || '', url: p.url || '' })),
  };
  await writeNetworkToken('hashnode', { account, connectedAt: new Date().toISOString() });
  return account;
}

export async function hashnodeStatus() {
  const stored = await readNetworkToken('hashnode');
  const connected = Boolean(cfg.HASHNODE_TOKEN && stored?.account?.publication?.id);
  return { connected, account: stored?.account || null };
}

export async function disconnectHashnode() {
  await clearNetworkToken('hashnode');
}

async function publication() {
  const stored = await readNetworkToken('hashnode');
  const pub = stored?.account?.publication;
  if (!cfg.HASHNODE_TOKEN || !pub?.id) {
    const err = new Error('Connect Hashnode on the Connectors page first.');
    err.status = 400;
    throw err;
  }
  return pub;
}

export function hashnodeTags(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  const seen = new Set();
  const tags = [];
  for (const raw of list) {
    const name = String(raw || '').trim().replace(/^#+/, '').trim().slice(0, 50);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    tags.push({ slug, name });
    if (tags.length === 5) break;
  }
  return tags;
}

function articleInput({ title, subtitle, content, tags, coverImageUrl, canonicalUrl, slug }) {
  const cleanTitle = String(title || '').trim();
  const markdown = String(content || '').trim();
  if (cleanTitle.length < 6) throw new Error('Hashnode needs a title of at least 6 characters.');
  if (!markdown) throw new Error('Hashnode needs the article body in Markdown.');
  const input = {
    title: cleanTitle.slice(0, 250),
    contentMarkdown: markdown,
    tags: hashnodeTags(tags),
  };
  if (String(subtitle || '').trim()) input.subtitle = String(subtitle).trim().slice(0, 150);
  if (/^https:\/\//.test(String(coverImageUrl || ''))) input.coverImageOptions = { coverImageURL: coverImageUrl };
  if (/^https:\/\//.test(String(canonicalUrl || ''))) input.originalArticleURL = canonicalUrl;
  if (String(slug || '').trim()) input.slug = String(slug).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 250);
  return input;
}

export async function publishHashnode({ title, subtitle, content, tags, coverImageUrl, canonicalUrl, slug, draft, source }) {
  const pub = await publication();
  const input = { ...articleInput({ title, subtitle, content, tags, coverImageUrl, canonicalUrl, slug }), publicationId: pub.id };
  let hashnodeId = '';
  let url = '';
  if (draft) {
    const data = await hashnodeGql(
      `mutation CreateDraft($input: CreateDraftInput!) { createDraft(input: $input) { draft { id slug } } }`,
      { input },
    );
    hashnodeId = data?.createDraft?.draft?.id || '';
    url = hashnodeId ? `https://hashnode.com/draft/${hashnodeId}` : '';
  } else {
    const data = await hashnodeGql(
      `mutation PublishPost($input: PublishPostInput!) { publishPost(input: $input) { post { id slug url } } }`,
      { input },
    );
    hashnodeId = data?.publishPost?.post?.id || '';
    url = data?.publishPost?.post?.url || '';
  }
  const post = {
    id: randomBytes(8).toString('hex'),
    network: 'hashnode',
    title: input.title,
    description: input.contentMarkdown,
    tags: input.tags.map((tag) => tag.name),
    hashnodeId,
    privacyStatus: draft ? 'draft' : '',
    url,
    createdAt: new Date().toISOString(),
    source: source || 'manual',
  };
  await addPost(post);
  return post;
}

export async function updateHashnode({ post, title, subtitle, content, tags, coverImageUrl }) {
  await publication();
  const id = String(post || '').trim();
  if (!id) throw new Error('Give the Hashnode post id.');
  const input = { id };
  if (String(title || '').trim()) input.title = String(title).trim().slice(0, 250);
  if (String(subtitle || '').trim()) input.subtitle = String(subtitle).trim().slice(0, 150);
  if (String(content || '').trim()) input.contentMarkdown = String(content).trim();
  if (tags != null && String(tags).trim()) input.tags = hashnodeTags(tags);
  if (/^https:\/\//.test(String(coverImageUrl || ''))) input.coverImageOptions = { coverImageURL: coverImageUrl };
  if (Object.keys(input).length === 1) throw new Error('Say what to change on the Hashnode post.');
  const data = await hashnodeGql(
    `mutation UpdatePost($input: UpdatePostInput!) { updatePost(input: $input) { post { id title url } } }`,
    { input },
  );
  const updated = data?.updatePost?.post;
  return { hashnodeId: updated?.id || id, title: updated?.title || input.title || '', url: updated?.url || '' };
}

export async function listHashnodePosts(limit = 20) {
  const pub = await publication();
  const first = Math.min(50, Math.max(1, Number(limit) || 20));
  const data = await hashnodeGql(
    `query Posts($id: ObjectId!, $first: Int!) {
      publication(id: $id) {
        posts(first: $first) {
          edges { node {
            id title url brief publishedAt views reactionCount responseCount readTimeInMinutes
            coverImage { url }
            tags { name }
          } }
        }
      }
    }`,
    { id: pub.id, first },
  );
  return (data?.publication?.posts?.edges || []).map(({ node }) => ({
    id: node.id,
    title: node.title || '',
    url: node.url || '',
    brief: node.brief || '',
    publishedAt: node.publishedAt || '',
    views: Number.isFinite(node.views) ? node.views : null,
    reactions: Number.isFinite(node.reactionCount) ? node.reactionCount : null,
    comments: Number.isFinite(node.responseCount) ? node.responseCount : null,
    readTime: node.readTimeInMinutes || null,
    cover: typeof node.coverImage?.url === 'string' && node.coverImage.url.startsWith('https:') ? node.coverImage.url : '',
    tags: (node.tags || []).map((tag) => tag.name),
  }));
}
