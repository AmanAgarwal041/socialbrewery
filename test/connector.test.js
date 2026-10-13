import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  assertPublicUrl,
  isPrivateAddress,
  isVideoId,
  rowToMetrics,
  shapeVideo,
} from '../src/performance.js';
import { connectorTokenFrom, handleRpc, MCP_TOOLS } from '../src/mcp.js';
import { runWithOrg } from '../src/context.js';

const inOrg = (config, fn) => runWithOrg({ org: { id: 'a'.repeat(24), name: 'Test' }, config, user: null, role: 'owner' }, fn);
import { linkedinPostUrn, toLittleText, uploadVideo } from '../src/linkedin.js';

test('LinkedIn commentary escapes reserved characters and keeps hashtags clickable', () => {
  assert.equal(
    toLittleText('a loop shows up as a spike (and on your bill).'),
    'a loop shows up as a spike \\(and on your bill\\).',
  );
  assert.equal(
    toLittleText('Ship it #AIAgents #LLM_Ops'),
    'Ship it {hashtag|\\#|AIAgents} {hashtag|\\#|LLM\\_Ops}',
  );
  assert.equal(
    toLittleText('Watch https://youtu.be/abc?t=1#top and see [docs] @team *bold* ~x~ <b> {a|b} #1 \\'),
    'Watch https://youtu.be/abc?t=1\\#top and see \\[docs\\] \\@team \\*bold\\* \\~x\\~ \\<b\\> \\{a\\|b\\} \\#1 \\\\',
  );
});


test('LinkedIn native video upload dry-runs with mocked fetch', async () => {
  const previousFetch = globalThis.fetch;
  const directory = await mkdtemp(join(tmpdir(), 'socialbrewery-video-'));
  const filePath = join(directory, 'clip.mp4');
  await writeFile(filePath, Buffer.from('test'));
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || 'GET', body: init.body };
    calls.push(call);
    if (call.url.includes('initializeUpload')) {
      return new Response(JSON.stringify({
        value: {
          video: 'urn:li:video:test',
          uploadInstructions: [{ firstByte: 0, lastByte: 3, uploadUrl: 'https://upload.example/part' }],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (call.url === 'https://upload.example/part') {
      return new Response(null, { status: 200, headers: { etag: '"etag-1"' } });
    }
    if (call.url.includes('finalizeUpload')) return new Response(null, { status: 200 });
    throw new Error(`Unexpected mocked URL: ${call.url}`);
  };
  try {
    const videoUrn = await uploadVideo({ token: 'test-token', owner: 'urn:li:person:test', filePath, bytes: 4 });
    assert.equal(videoUrn, 'urn:li:video:test');
    assert.deepEqual(calls.map((call) => [call.method, call.url]), [
      ['POST', 'https://api.linkedin.com/rest/videos?action=initializeUpload'],
      ['PUT', 'https://upload.example/part'],
      ['POST', 'https://api.linkedin.com/rest/videos?action=finalizeUpload'],
    ]);
    const finalize = JSON.parse(calls[2].body);
    assert.deepEqual(finalize.finalizeUploadRequest, {
      video: 'urn:li:video:test',
      uploadToken: '',
      uploadedPartIds: ['etag-1'],
    });
  } finally {
    globalThis.fetch = previousFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('LinkedIn post URN is read from a URN or a post link', () => {
  assert.equal(linkedinPostUrn('urn:li:share:7380000000000000000'), 'urn:li:share:7380000000000000000');
  assert.equal(
    linkedinPostUrn('https://www.linkedin.com/feed/update/urn%3Ali%3Aactivity%3A7380000000000000001'),
    'urn:li:activity:7380000000000000001',
  );
  assert.throws(() => linkedinPostUrn('https://www.linkedin.com/in/someone'));
  assert.ok(MCP_TOOLS.some((tool) => tool.name === 'comment_linkedin'));
});

test('performance rows keep only returned metrics', () => {
  const metrics = rowToMetrics(
    [{ name: 'views' }, { name: 'averageViewDuration' }],
    [120, 8.5],
  );
  assert.equal(metrics.views, 120);
  assert.equal(metrics.averageViewDuration, 8.5);
  const video = shapeVideo({
    id: 'abcdefghijk',
    snippet: { title: 'Kettle' },
    statistics: { viewCount: '4', likeCount: '1' },
  });
  assert.equal(video.views, 4);
  assert.equal(video.shortsUrl, 'https://www.youtube.com/shorts/abcdefghijk');
  assert.equal(isVideoId(video.id), true);
  assert.equal(isVideoId('short'), false);
});

test('remote video URLs stay public https', () => {
  assert.equal(isPrivateAddress('127.0.0.1'), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.throws(() => assertPublicUrl('http://cdn.example/video.mp4'), /https/);
  assert.throws(() => assertPublicUrl('https://127.0.0.1/video.mp4'), /public/);
  assert.equal(assertPublicUrl('https://cdn.example/a.mp4').hostname, 'cdn.example');
});

test('Grok connector lists YouTube tools and requires its token', async () => {
  await inOrg({ CONNECTOR_TOKEN: 'token-token-token-token' }, async () => {
    const init = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    assert.equal(init.result.serverInfo.name, 'socialbrewery');
    const tools = await handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = tools.result.tools.map((tool) => tool.name);
    assert.deepEqual(names, MCP_TOOLS.map((tool) => tool.name));
    assert.ok(names.includes('post_youtube_short'));
    assert.ok(names.includes('analyze_youtube_video'));
    assert.ok(names.includes('update_youtube_video'));
    assert.ok(names.includes('post_linkedin'));
    assert.ok(names.includes('post_instagram_reel'));
    const notice = await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(notice, null);

    const url = new URL('http://127.0.0.1:3847/mcp?token=token-token-token-token');
    assert.equal(connectorTokenFrom({ headers: {} }, url), 'token-token-token-token');
    assert.equal(connectorTokenFrom({ headers: { authorization: 'Bearer abc' } }, new URL('http://127.0.0.1/mcp')), 'abc');
  });
});

test('X post ids parse from ids and links', async () => {
  const { xPostId } = await import('../src/x.js');
  assert.equal(xPostId('1845678901234567890'), '1845678901234567890');
  assert.equal(xPostId('https://x.com/openlit/status/1845678901234567890?s=20'), '1845678901234567890');
  assert.equal(xPostId('https://twitter.com/a/statuses/1845678901234567890'), '1845678901234567890');
  assert.throws(() => xPostId('https://x.com/openlit'));
});

test('X chunked video upload dry-runs with mocked fetch', async () => {
  const { uploadXVideo } = await import('../src/x.js');
  const previousFetch = globalThis.fetch;
  const directory = await mkdtemp(join(tmpdir(), 'socialbrewery-x-'));
  const filePath = join(directory, 'clip.mp4');
  const bytes = 5 * 1024 * 1024;
  await writeFile(filePath, Buffer.alloc(bytes, 1));
  const calls = [];
  let polls = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET', body: init.body });
    const json = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('/media/upload/initialize')) return json({ data: { id: '777' } });
    if (u.includes('/append')) return new Response(null, { status: 204 });
    if (u.endsWith('/finalize')) return json({ data: { id: '777', processing_info: { state: 'pending', check_after_secs: 0 } } });
    if (u.includes('command=STATUS')) {
      polls += 1;
      return json({ data: { id: '777', processing_info: { state: 'succeeded' } } });
    }
    return new Response('{}', { status: 404 });
  };
  try {
    const id = await uploadXVideo({ token: 't', filePath, bytes, mime: 'video/mp4' });
    assert.equal(id, '777');
    const init = JSON.parse(calls[0].body);
    assert.deepEqual(init, { media_type: 'video/mp4', media_category: 'tweet_video', total_bytes: bytes });
    const appends = calls.filter((c) => c.url.includes('/append'));
    assert.equal(appends.length, 2);
    assert.deepEqual(appends.map((c) => c.body.get('segment_index')), ['0', '1']);
    assert.equal(polls, 1);
  } finally {
    globalThis.fetch = previousFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('Hashnode tags are slugged, deduped, and capped at five', async () => {
  const { hashnodeTags } = await import('../src/hashnode.js');
  assert.deepEqual(hashnodeTags('AI Agents, #javascript, ai agents'), [
    { slug: 'ai-agents', name: 'AI Agents' },
    { slug: 'javascript', name: 'javascript' },
  ]);
  assert.equal(hashnodeTags(['a', 'b', 'c', 'd', 'e', 'f']).length, 5);
});

test('Hashnode explains the Pro plan redirect and bad tokens', async () => {
  const { hashnodeGql } = await import('../src/hashnode.js');
  const previousFetch = globalThis.fetch;
  const seen = [];
  try {
    await inOrg({ HASHNODE_TOKEN: 'test-token' }, async () => {
      globalThis.fetch = async (url, init) => {
        seen.push(init);
        return new Response('', { status: 301, headers: { Location: 'https://hashnode.com/announcements/graphql-api' } });
      };
      await assert.rejects(hashnodeGql('{ me { id } }'), /Pro plan/);
      assert.equal(seen[0].redirect, 'manual');
      assert.equal(seen[0].headers.Authorization, 'test-token');

      globalThis.fetch = async () =>
        new Response(JSON.stringify({ errors: [{ message: 'nope', extensions: { code: 'UNAUTHENTICATED' } }] }), { status: 200 });
      await assert.rejects(hashnodeGql('{ me { id } }'), /rejected the token/);
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('Slack text escapes control characters but keeps links and mentions', async () => {
  const { slackText } = await import('../src/slack.js');
  assert.equal(slackText('a < b & c > d'), 'a &lt; b &amp; c &gt; d');
  assert.equal(
    slackText('See <https://openlit.io|OpenLIT> & ping <!here> or <@U123>'),
    'See <https://openlit.io|OpenLIT> &amp; ping <!here> or <@U123>',
  );
});

test('Slack message links parse to channel and thread ts', async () => {
  const { parseSlackLink } = await import('../src/slack.js');
  assert.deepEqual(parseSlackLink('https://acme.slack.com/archives/C0123ABCD/p1727771234123456'), {
    channel: 'C0123ABCD',
    ts: '1727771234.123456',
  });
  assert.deepEqual(
    parseSlackLink('https://acme.slack.com/archives/C0123ABCD/p1727779999000001?thread_ts=1727771234.123456&cid=C0123ABCD'),
    { channel: 'C0123ABCD', ts: '1727771234.123456' },
  );
  assert.throws(() => parseSlackLink('general'));
});

test('Slack API errors become plain instructions', async () => {
  const { slackApi } = await import('../src/slack.js');
  const previousFetch = globalThis.fetch;
  try {
    await inOrg({ SLACK_BOT_TOKEN: 'xoxb-test' }, async () => {
      globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: 'missing_scope', needed: 'files:write' }));
      await assert.rejects(slackApi('files.getUploadURLExternal'), /files:write/);
      globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: 'not_in_channel' }));
      await assert.rejects(slackApi('chat.postMessage'), /\/invite @Socialbrewery/);
      let seen;
      globalThis.fetch = async (url, init) => {
        seen = { url: String(url), init };
        return new Response(JSON.stringify({ ok: true, ts: '1.2' }));
      };
      await slackApi('chat.postMessage', { channel: 'C1', text: 'hi', thread_ts: undefined });
      assert.equal(seen.url, 'https://slack.com/api/chat.postMessage');
      assert.equal(seen.init.headers.Authorization, 'Bearer xoxb-test');
      assert.equal(seen.init.body.get('text'), 'hi');
      assert.equal(seen.init.body.has('thread_ts'), false);
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('Reddit subreddit names and post ids parse from names and links', async () => {
  const { subredditName, redditFullname } = await import('../src/reddit.js');
  assert.equal(subredditName('r/selfhosted'), 'selfhosted');
  assert.equal(subredditName('/r/LocalLLaMA/'), 'LocalLLaMA');
  assert.equal(subredditName('https://www.reddit.com/r/node/comments/abc123/x/'), 'node');
  assert.throws(() => subredditName('r/has space'));
  assert.equal(redditFullname('t3_1abcde'), 't3_1abcde');
  assert.equal(redditFullname('https://www.reddit.com/r/node/comments/1abcde/my_post/'), 't3_1abcde');
  assert.equal(redditFullname('https://www.reddit.com/r/node/comments/1abcde/my_post/kx9z1q2/'), 't1_kx9z1q2');
  assert.equal(redditFullname('1abcde'), 't3_1abcde');
  assert.throws(() => redditFullname('not a post'));
});

test('Reddit errors become plain instructions', async () => {
  const { redditError } = await import('../src/reddit.js');
  assert.equal(redditError(200, { json: { errors: [] } }), null);
  assert.match(redditError(200, { json: { errors: [['NO_SELFS', 'no', 'kind']] } }).message, /only allows link posts/);
  assert.match(redditError(200, { json: { errors: [['SUBMIT_VALIDATION_FLAIR_REQUIRED', 'x', 'flair']] } }).message, /flair/);
  assert.match(redditError(200, { json: { errors: [['RATELIMIT', 'Take a break for 9 minutes.', 'ratelimit']] } }).message, /9 minutes/);
  assert.match(redditError(401, {}).message, /Connect Reddit again/);
  assert.match(redditError(429, {}).message, /rate limiting/);
  assert.equal(redditError(503, {}).status, 502);
});

test('Reddit manual mode builds a pre-filled submit link', async () => {
  const { redditSubmitUrl, redditRulesUrl } = await import('../src/reddit.js');
  const text = new URL(redditSubmitUrl({ subreddit: 'r/selfhosted', title: 'My tool', text: 'Hello **there**' }));
  assert.equal(text.origin + text.pathname, 'https://www.reddit.com/r/selfhosted/submit');
  assert.equal(text.searchParams.get('type'), 'TEXT');
  assert.equal(text.searchParams.get('title'), 'My tool');
  assert.equal(text.searchParams.get('text'), 'Hello **there**');
  const link = new URL(redditSubmitUrl({ subreddit: 'node', title: 'Read this', url: 'https://example.com/a?b=1', text: 'ignored' }));
  assert.equal(link.searchParams.get('type'), 'LINK');
  assert.equal(link.searchParams.get('url'), 'https://example.com/a?b=1');
  assert.equal(link.searchParams.has('text'), false);
  assert.equal(redditRulesUrl('r/node'), 'https://www.reddit.com/r/node/about/rules');
  assert.throws(() => redditSubmitUrl({ subreddit: 'bad name', title: 'x' }));
});

test('Instagram webhook payloads become short event records', async () => {
  const { summarizeEvents, validSignature } = await import('../src/instagram-webhooks.js');
  const { createHmac } = await import('node:crypto');
  const events = summarizeEvents({
    object: 'instagram',
    entry: [
      { id: '1', time: 5, changes: [{ field: 'comments', value: { id: 'c', text: 'hi', from: { username: 'a' }, media: { id: 'm' } } }] },
      { id: '1', time: 6, messaging: [{ sender: { id: 's' }, timestamp: 7, message: { mid: 'x', text: 'dm', is_echo: true } }] },
    ],
  });
  assert.deepEqual(events.map((e) => [e.field, e.text, e.from]), [['comments', 'hi', 'a'], ['messages', 'dm', 's']]);
  assert.equal(events[1].echo, true);
  assert.notEqual(events[0].id, events[1].id);
  assert.deepEqual(summarizeEvents({}), []);
  const raw = Buffer.from('{"a":1}');
  const sig = `sha256=${createHmac('sha256', 'k').update(raw).digest('hex')}`;
  assert.equal(validSignature(raw, sig, 'k'), true);
  assert.equal(validSignature(raw, sig, 'other'), false);
  assert.equal(validSignature(raw, 'sha1=abc', 'k'), false);
  assert.equal(validSignature(raw, sig, ''), false);
});
