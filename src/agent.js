import { randomUUID } from 'node:crypto';
import { claudeChat } from './claude.js';
import { generateShort, grokChat } from './grok.js';
import { analyzeVideo } from './analysis.js';
import { listChannelVideos, publishShort, updateVideo } from './youtube.js';
import { commentOnLinkedIn, postToHashnode, postToLinkedIn, postToSlack, postToX, replyOnSlack, replyOnX, postToReddit, commentOnReddit, redditRules } from './actions.js';
import { listHashnodePosts } from './hashnode.js';
import { listSlackChannels } from './slack.js';
import { publishInstagramReel } from './instagram.js';
import { getMedia, loadHistory, saveHistory } from './store.js';
import { cfg } from './context.js';

const SYSTEM_TEMPLATE = `You are {{NAME}}, the posting agent inside Socialbrewery. You help one person publish to the channels they connected: YouTube Shorts, LinkedIn, Instagram Reels, X, a Hashnode blog, Slack, and Reddit.

You can:
- generate_short_video: make a new vertical clip (9:16, up to 15 seconds) from a prompt.
- upload_youtube_short: upload a clip to YouTube. Do this only when the person asked you to post, publish, or upload to YouTube.
- list_youtube_videos: recent uploads with view, like, and comment counts.
- analyze_youtube_video: how one video performed and what to improve. Use the 11-character video id. Pass provider claude or openai when the person wants Claude or OpenAI to write that review.
- update_youtube_video: change the title, description, tags, or privacy of a video already on YouTube. Change only the fields the person named.
- post_linkedin: post text, text with a link preview card (linkUrl, e.g. a YouTube video or an article), or a video with text, to LinkedIn. Use linkUrl when the person wants one link shown as a card; put other links in firstComment.
- comment_linkedin: add a comment under an existing LinkedIn post, using its URN or link.
- post_instagram_reel: post a Reel to Instagram. Needs a mediaId. A public tunnel URL must be set in Settings.
- post_x: post text, or a video with text, to X (Twitter). Keep text within 280 characters (links count as 23). Put links or a follow-up in firstReply.
- reply_x: reply under an existing X post, using its id or link. Use it to continue a thread.
- publish_hashnode_article: publish a Markdown article to Hashnode, or save it as a draft. Write a real article with headings, not a social caption. Use draft true unless they clearly asked to publish.
- list_hashnode_articles: recent Hashnode articles with views, reactions, and comments.
- post_slack: post a message (optionally with a mediaId video) to a Slack channel. Use Slack mrkdwn: *bold*, _italic_, <https://url|label>. If they did not name a channel, omit it to use the default; if that fails, call list_slack_channels and ask which one.
- reply_slack: reply in the thread of a Slack message, using its link.
- list_slack_channels: channels the Slack app can see.
- reddit_subreddit_rules: a subreddit's rules, allowed post types (text, link, or any), and flairs. Call it before every post_reddit.
- post_reddit: submit a text post (Markdown text) or a link post (url) to one subreddit. Write like a community member, not an ad: a plain, specific title and no hashtags. Pass flairId when the subreddit needs flair.
- comment_reddit: comment on a Reddit post or reply to a comment, using its link.
- If Reddit API keys are not connected, reddit_subreddit_rules returns a rulesUrl and post_reddit returns a submitUrl instead of posting. Share both links and say plainly that the person still has to click Post on Reddit. Never claim it was posted.
- Use generate_short_video first when they want a new clip for LinkedIn, Instagram, or X.

Rules:
- If they attached a video, use that mediaId unless they asked for a new generated clip.
- If they want a new clip, generate it first, then upload the returned mediaId.
- Post only to the network they named. If they did not name one, ask which network.
- Prefer the privacy they named for YouTube. If they did not name one, use the preferred privacy in their message. Otherwise use unlisted.
- Titles are at most 100 characters for YouTube. Put #Shorts in the YouTube description. Tags are short phrases without a hash.
- Reddit: post only to a subreddit the person named, one subreddit per request, and never cross-post the same content to several subreddits. If the rules forbid self-promotion or the post type, say so instead of posting.
- Never invent a YouTube, LinkedIn, Instagram, X, Hashnode, Slack, or Reddit link or a view count. Only share numbers returned by the tools.
- Do not change privacy, title, description, or tags unless the person asked for that change.
- If a tool returns an error, explain it in plain language and say what to fix. Do not pretend the upload worked.
- Keep replies short.`;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'generate_short_video',
      description: 'Generate a vertical YouTube Short with Grok video. Returns a mediaId you can upload.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          prompt: {
            type: 'string',
            description: 'What the clip shows, including motion and mood. It is framed 9:16.',
          },
          duration: {
            type: 'integer',
            description: 'Length in seconds from 1 to 15. Use 8 when the person does not choose.',
          },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'upload_youtube_short',
      description: 'Upload a video to the connected YouTube channel as a Short. Call only when the person asked to post, publish, or upload.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mediaId: { type: 'string', description: 'mediaId of an attached or generated video.' },
          title: { type: 'string', description: 'YouTube title, 100 characters or fewer.' },
          description: { type: 'string', description: 'YouTube description. Include #Shorts.' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Short topic tags without #.',
          },
          privacyStatus: {
            type: 'string',
            enum: ['public', 'unlisted', 'private'],
          },
        },
        required: ['mediaId', 'title', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_youtube_videos',
      description: 'List recent videos on the connected channel with view, like, and comment counts.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          limit: { type: 'integer', description: 'How many videos, up to 20. Default 10.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_youtube_video',
      description: 'Review how one YouTube video performed and what to improve. videoId is the 11-character id. Set provider to claude or openai when the person wants Claude or OpenAI to write the review.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          videoId: { type: 'string' },
          provider: {
            type: 'string',
            enum: ['grok', 'claude', 'openai'],
            description: 'Who writes the review. Use claude or openai when the person asks for one. Otherwise omit it.',
          },
        },
        required: ['videoId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_youtube_video',
      description: 'Edit title, description, tags, or privacy on a video already uploaded. Omit fields that should stay the same.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          videoId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          privacyStatus: { type: 'string', enum: ['public', 'unlisted', 'private'] },
        },
        required: ['videoId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'post_linkedin',
      description: 'Post text, text with a link preview card, or a video with text to the connected LinkedIn profile.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          commentary: { type: 'string' },
          title: { type: 'string' },
          mediaId: { type: 'string' },
          linkUrl: { type: 'string', description: 'Optional http(s) link shown as a preview card. Ignored when a video is attached.' },
          linkTitle: { type: 'string', description: 'Optional card title.' },
          linkDescription: { type: 'string', description: 'Optional card description.' },
          linkThumbnailUrl: { type: 'string', description: 'Optional https image for the card. YouTube links get their thumbnail automatically.' },
          firstComment: { type: 'string', description: 'Optional comment added under the post after publishing.' },
        },
        required: ['commentary'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'comment_linkedin',
      description: 'Comment as the connected LinkedIn member on a LinkedIn post.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          post: { type: 'string', description: 'Post URN or post link.' },
          text: { type: 'string' },
        },
        required: ['post', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'post_instagram_reel',
      description: 'Post a Reel to the connected Instagram professional account. Needs mediaId.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mediaId: { type: 'string' },
          caption: { type: 'string' },
          title: { type: 'string' },
        },
        required: ['mediaId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'post_x',
      description: 'Post text, or a video with text, to the connected X account.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', description: 'Post text, 280 characters or fewer. Links count as 23.' },
          mediaId: { type: 'string' },
          firstReply: { type: 'string', description: 'Optional reply posted under it right away.' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reply_x',
      description: 'Reply as the connected X account under an X post.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          post: { type: 'string', description: 'X post id or link.' },
          text: { type: 'string' },
        },
        required: ['post', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'publish_hashnode_article',
      description: 'Publish a Markdown article to the connected Hashnode blog, or save it as a draft.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: 'At least 6 characters.' },
          subtitle: { type: 'string' },
          content: { type: 'string', description: 'Full article body in Markdown.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Up to 5 topic tags.' },
          coverImageUrl: { type: 'string' },
          draft: { type: 'boolean', description: 'true saves a draft instead of publishing.' },
        },
        required: ['title', 'content', 'draft'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_hashnode_articles',
      description: 'List recent articles on the connected Hashnode blog with views, reactions, and comments.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          limit: { type: 'integer', description: 'Up to 50. Default 10.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'post_slack',
      description: 'Post a message, optionally with a video, to a channel in the connected Slack workspace.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          channel: { type: 'string', description: 'Channel like #announcements. Omit to use the default channel.' },
          text: { type: 'string', description: 'Message in Slack mrkdwn.' },
          mediaId: { type: 'string' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reply_slack',
      description: 'Reply in the thread of a Slack message.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          post: { type: 'string', description: 'Slack message link.' },
          text: { type: 'string' },
        },
        required: ['post', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_slack_channels',
      description: 'List channels the Slack app can see.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reddit_subreddit_rules',
      description: 'Read a subreddit\'s rules, allowed post types, and flairs before posting there.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { subreddit: { type: 'string', description: 'Subreddit name like r/selfhosted.' } },
        required: ['subreddit'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'post_reddit',
      description: 'Submit a text or link post to one subreddit the person named.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          subreddit: { type: 'string', description: 'Subreddit name like r/selfhosted.' },
          title: { type: 'string', description: 'Up to 300 characters.' },
          text: { type: 'string', description: 'Markdown body for a text post.' },
          url: { type: 'string', description: 'https link for a link post instead of text.' },
          flairId: { type: 'string', description: 'Flair id from reddit_subreddit_rules.' },
          flairText: { type: 'string' },
          nsfw: { type: 'boolean' },
          spoiler: { type: 'boolean' },
          firstComment: { type: 'string', description: 'Optional comment to add under the post.' },
        },
        required: ['subreddit', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'comment_reddit',
      description: 'Comment on a Reddit post or reply to a comment.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          post: { type: 'string', description: 'Reddit post or comment link.' },
          text: { type: 'string', description: 'Markdown comment.' },
        },
        required: ['post', 'text'],
      },
    },
  },
];

function parseArgs(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function trimModel(messages, max = 40) {
  if (messages.length <= max) return messages;
  let start = messages.length - max;
  while (start < messages.length && messages[start].role !== 'user') start += 1;
  if (start >= messages.length) {
    start = messages.length - max;
    while (start > 0 && messages[start].role !== 'user') start -= 1;
  }
  return messages.slice(start);
}

function assistantMessage(message) {
  const next = {
    role: 'assistant',
    content: message.content ?? null,
  };
  if (message.tool_calls?.length) next.tool_calls = message.tool_calls;
  // Claude's raw blocks (thinking included), replayed to Claude within the same request.
  if (message._claude) next._claude = message._claude;
  return next;
}

// Brew runs on the organisation's chosen assistant unless a message picks one (the Grok/Claude
// tabs under Brew's text area). Video generation always uses Grok Imagine.
export const AGENT_PROVIDERS = ['grok', 'claude'];

export function agentProvider(requested) {
  if (AGENT_PROVIDERS.includes(requested)) return requested;
  return cfg.AGENT_PROVIDER === 'claude' ? 'claude' : 'grok';
}

export function agentName(provider = agentProvider()) {
  return provider === 'claude' ? 'Claude' : 'Grok';
}

/** Whether each assistant has its API key, so the tabs can say which one is ready. */
export function agentsReady() {
  return { grok: Boolean(cfg.XAI_API_KEY), claude: Boolean(cfg.ANTHROPIC_API_KEY) };
}

function systemPrompt(provider) {
  return SYSTEM_TEMPLATE.replace('{{NAME}}', agentName(provider));
}

// Grok gets the plain OpenAI shape; Claude's extra field stays out of its requests.
function forGrok(messages) {
  return messages.map(({ _claude, ...rest }) => rest);
}

export async function runAgent({ text, mediaId, privacyStatus, madeForKids, provider: requested, send, signal }) {
  const provider = agentProvider(requested);
  if (provider === 'claude' && !cfg.ANTHROPIC_API_KEY) {
    throw new Error('Add your Anthropic API key in Settings (an organisation admin can do this), or switch the assistant to Grok.');
  }
  if (provider === 'grok' && !cfg.XAI_API_KEY) {
    throw new Error('Add your xAI API key in Settings (an organisation admin can do this).');
  }
  const spoken = String(text || '').trim() || (mediaId ? 'Post the attached video as a YouTube Short.' : '');
  if (!spoken) throw new Error('Write a message or attach a video.');

  let media = null;
  if (mediaId) {
    media = await getMedia(mediaId);
    if (!media) throw new Error('That attached video is no longer available.');
  }

  const history = await loadHistory();
  const modelText = [
    spoken,
    media ? `Attached video mediaId: ${media.id} (${media.name}).` : 'No video is attached.',
    `Preferred privacy: ${privacyStatus || 'unlisted'}.`,
    `Made for kids: ${madeForKids ? 'yes' : 'no'}. Leave this as the user set it.`,
  ].join('\n');

  history.model.push({ role: 'user', content: modelText });
  history.model = trimModel(history.model);
  const userItem = {
    id: randomUUID(),
    role: 'user',
    content: spoken,
    mediaId: media?.id || '',
    mediaName: media?.name || '',
    at: new Date().toISOString(),
  };
  history.display.push(userItem);
  await saveHistory(history);

  for (let step = 0; step < 5; step += 1) {
    if (signal?.aborted) throw new Error('Stopped.');
    send('status', { text: step === 0 ? `${agentName(provider)} is thinking…` : `${agentName(provider)} is continuing…` });
    const messages = [{ role: 'system', content: systemPrompt(provider) }, ...history.model];
    const message = provider === 'claude' ? await claudeChat({ messages, tools: TOOLS }) : await grokChat({ messages: forGrok(messages), tools: TOOLS });
    history.model.push(assistantMessage(message));
    if (message.content) {
      const item = {
        id: randomUUID(),
        role: 'assistant',
        content: String(message.content),
        at: new Date().toISOString(),
      };
      history.display.push(item);
      send('message', item);
    }
    const calls = message.tool_calls || [];
    if (!calls.length) {
      await saveHistory(history);
      return;
    }
    for (const call of calls) {
      if (signal?.aborted) throw new Error('Stopped.');
      const name = call.function?.name || '';
      const args = parseArgs(call.function?.arguments);
      send('status', { text: statusFor(name) });
      let result;
      try {
        result = await runTool(name, args, { madeForKids, send, signal });
      } catch (err) {
        result = { error: err.message || 'That step failed.' };
      }
      history.model.push({
        role: 'tool',
        tool_call_id: call.id || randomUUID(),
        name,
        content: JSON.stringify(result),
      });
      const item = {
        id: randomUUID(),
        role: 'tool',
        tool: name,
        content: summarize(name, result),
        mediaId: result.mediaId || '',
        url: result.url || '',
        error: Boolean(result.error),
        at: new Date().toISOString(),
      };
      history.display.push(item);
      send('message', item);
      await saveHistory(history);
    }
  }

  const note = 'I stopped after several steps. Send "continue" if you still want this posted.';
  history.model.push({ role: 'assistant', content: note });
  const item = { id: randomUUID(), role: 'assistant', content: note, at: new Date().toISOString() };
  history.display.push(item);
  send('message', item);
  await saveHistory(history);
}

function statusFor(name) {
  if (name === 'generate_short_video') return 'Grok is generating a vertical clip…';
  if (name === 'upload_youtube_short') return 'Uploading to YouTube…';
  if (name === 'list_youtube_videos') return 'Reading the channel…';
  if (name === 'analyze_youtube_video') return 'Reviewing how the video performed…';
  if (name === 'update_youtube_video') return 'Updating the video on YouTube…';
  if (name === 'post_linkedin') return 'Posting to LinkedIn…';
  if (name === 'comment_linkedin') return 'Commenting on LinkedIn…';
  if (name === 'post_instagram_reel') return 'Publishing an Instagram Reel…';
  if (name === 'post_x') return 'Posting to X…';
  if (name === 'reply_x') return 'Replying on X…';
  if (name === 'publish_hashnode_article') return 'Sending the article to Hashnode…';
  if (name === 'list_hashnode_articles') return 'Reading the Hashnode blog…';
  if (name === 'post_slack') return 'Posting to Slack…';
  if (name === 'reply_slack') return 'Replying in the Slack thread…';
  if (name === 'list_slack_channels') return 'Reading Slack channels…';
  if (name === 'reddit_subreddit_rules') return 'Reading the subreddit rules…';
  if (name === 'post_reddit') return 'Posting to Reddit…';
  if (name === 'comment_reddit') return 'Commenting on Reddit…';
  return 'Working…';
}

function summarize(name, result) {
  if (result.error) return result.error;
  if (name === 'generate_short_video') return 'Generated a vertical clip.';
  if (name === 'upload_youtube_short') return `Posted to YouTube: ${result.url}`;
  if (name === 'list_youtube_videos') return `Found ${result.videos?.length || 0} videos.`;
  if (name === 'analyze_youtube_video') return result.analysis || 'Reviewed the video.';
  if (name === 'update_youtube_video') return `Updated ${result.title || 'the video'}.`;
  if (name === 'post_linkedin') {
    const posted = result.url ? `Posted to LinkedIn: ${result.url}` : 'Posted to LinkedIn.';
    return [posted, result.thumbnailError, result.commentError].filter(Boolean).join(' ');
  }
  if (name === 'comment_linkedin') return 'Commented on LinkedIn.';
  if (name === 'post_instagram_reel') return result.url ? `Posted to Instagram: ${result.url}` : 'Posted to Instagram.';
  if (name === 'post_x') {
    const posted = result.url ? `Posted to X: ${result.url}` : 'Posted to X.';
    return result.replyError ? `${posted} ${result.replyError}` : posted;
  }
  if (name === 'reply_x') return result.url ? `Replied on X: ${result.url}` : 'Replied on X.';
  if (name === 'publish_hashnode_article') {
    const verb = result.draft ? 'Saved a Hashnode draft' : 'Published on Hashnode';
    return result.url ? `${verb}: ${result.url}` : `${verb}.`;
  }
  if (name === 'list_hashnode_articles') return `Found ${result.articles?.length || 0} Hashnode articles.`;
  if (name === 'post_slack') {
    const where = result.channel ? ` in #${result.channel}` : '';
    return result.url ? `Posted to Slack${where}: ${result.url}` : `Posted to Slack${where}.`;
  }
  if (name === 'reply_slack') return result.url ? `Replied in Slack: ${result.url}` : 'Replied in the Slack thread.';
  if (name === 'list_slack_channels') return `Found ${result.channels?.length || 0} Slack channels.`;
  if (name === 'reddit_subreddit_rules') {
    return result.manual ? `Rules of r/${result.name}: ${result.rulesUrl}` : `Read the rules of r/${result.name} (${result.rules?.length || 0} rules).`;
  }
  if (name === 'post_reddit') {
    if (result.manual) return `Draft ready for r/${result.subreddit}. Open Reddit to post it: ${result.submitUrl}`;
    const posted = result.url ? `Posted to r/${result.subreddit}: ${result.url}` : `Posted to r/${result.subreddit}.`;
    return result.commentError ? `${posted} ${result.commentError}` : posted;
  }
  if (name === 'comment_reddit') return result.url ? `Commented on Reddit: ${result.url}` : 'Commented on Reddit.';
  return 'Done.';
}

async function runTool(name, args, { madeForKids, send, signal }) {
  if (name === 'generate_short_video') {
    const record = await generateShort({
      prompt: args.prompt,
      duration: args.duration,
      signal,
      onProgress: (text) => send('status', { text }),
    });
    return { mediaId: record.id, duration: record.duration, name: record.name };
  }
  if (name === 'upload_youtube_short') {
    const post = await publishShort({
      mediaId: args.mediaId,
      title: args.title,
      description: args.description,
      tags: args.tags,
      privacyStatus: args.privacyStatus,
      madeForKids,
      source: 'agent',
    });
    return { mediaId: post.mediaId, youtubeId: post.youtubeId, url: post.url, title: post.title };
  }
  if (name === 'list_youtube_videos') {
    const videos = await listChannelVideos(args.limit || 10);
    return { videos };
  }
  if (name === 'analyze_youtube_video') {
    const review = await analyzeVideo(args.videoId, { provider: args.provider });
    return { videoId: review.videoId, title: review.title, analysis: review.analysis, performance: review.performance };
  }
  if (name === 'update_youtube_video') {
    return updateVideo(args);
  }
  if (name === 'post_linkedin') {
    return postToLinkedIn({
      mediaId: args.mediaId,
      commentary: args.commentary,
      title: args.title,
      linkUrl: args.linkUrl,
      linkTitle: args.linkTitle,
      linkDescription: args.linkDescription,
      linkThumbnailUrl: args.linkThumbnailUrl,
      firstComment: args.firstComment,
      source: 'agent',
    });
  }
  if (name === 'comment_linkedin') {
    return commentOnLinkedIn({ post: args.post, text: args.text });
  }
  if (name === 'post_instagram_reel') {
    const post = await publishInstagramReel({
      mediaId: args.mediaId,
      caption: args.caption,
      title: args.title,
      source: 'agent',
    });
    return { instagramId: post.instagramId, url: post.url, title: post.title, mediaId: post.mediaId };
  }
  if (name === 'post_x') {
    const result = await postToX({
      mediaId: args.mediaId,
      text: args.text,
      firstReply: args.firstReply,
      source: 'agent',
    });
    return { ...result, mediaId: args.mediaId || '' };
  }
  if (name === 'reply_x') {
    return replyOnX({ post: args.post, text: args.text });
  }
  if (name === 'publish_hashnode_article') {
    return postToHashnode({ ...args, source: 'agent' });
  }
  if (name === 'list_hashnode_articles') {
    return { articles: await listHashnodePosts(args.limit || 10) };
  }
  if (name === 'post_slack') {
    const result = await postToSlack({ channel: args.channel, text: args.text, mediaId: args.mediaId, source: 'agent' });
    return { ...result, mediaId: args.mediaId || '' };
  }
  if (name === 'reply_slack') {
    return replyOnSlack({ post: args.post, text: args.text });
  }
  if (name === 'list_slack_channels') {
    const channels = await listSlackChannels();
    return { channels: channels.map((c) => ({ name: c.name, private: c.isPrivate, member: c.isMember })) };
  }
  if (name === 'reddit_subreddit_rules') {
    return redditRules({ subreddit: args.subreddit });
  }
  if (name === 'post_reddit') {
    return postToReddit({ ...args, source: 'agent' });
  }
  if (name === 'comment_reddit') {
    return commentOnReddit({ post: args.post, text: args.text });
  }
  return { error: `Unknown tool: ${name}` };
}
