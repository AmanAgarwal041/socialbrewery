import { appUrl } from './env.js';
import { analyzeVideo } from './analysis.js';
import { listChannelVideos, updateVideo } from './youtube.js';
import {
  generateAndPost,
  generateAndPostInstagram,
  generateAndPostLinkedIn,
  postToInstagram,
  postToLinkedIn,
  commentOnLinkedIn,
  updateLinkedInPost,
  postToYouTube,
  deleteXPost,
  generateAndPostX,
  postToX,
  replyOnX,
  postToHashnode,
  postToSlack,
  replyOnSlack,
  postToReddit,
  commentOnReddit,
  redditRules,
} from './actions.js';
import { listHashnodePosts, updateHashnode } from './hashnode.js';
import { listSlackChannels } from './slack.js';
import { deleteReddit, listRedditSubreddits } from './reddit.js';
import { cfg, publicOrigin } from './context.js';
import {
  addStudioAsset,
  createVideoProject,
  EFFECTS,
  generateVoiceover,
  getRenderStatus,
  getVideoPlaybook,
  getVideoProject,
  listStudioDocs,
  listVideoStyles,
  readStudioDoc,
  renderVideo,
  saveBrandKit,
  TEMPLATES,
  updateVideoProject,
} from './studio.js';

const HASHNODE_ARTICLE = {
  title: { type: 'string', description: 'Article title, at least 6 characters.' },
  subtitle: { type: 'string', description: 'Optional subtitle, up to 150 characters.' },
  content: { type: 'string', description: 'Full article body in Markdown.' },
  tags: { type: 'array', items: { type: 'string' }, description: 'Up to 5 topic tags, e.g. ["AI", "JavaScript"].' },
  coverImageUrl: { type: 'string', description: 'Optional https URL of a cover image.' },
};

export const MCP_TOOLS = [
  {
    name: 'post_youtube_short',
    description: 'Post a video to the connected YouTube channel as a Short. Use when the user asks to publish, post, or upload to YouTube. Provide mediaId for a file already in Socialbrewery, or an https videoUrl of an mp4, mov, or webm.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        privacyStatus: { type: 'string', enum: ['public', 'unlisted', 'private'] },
        mediaId: { type: 'string' },
        videoUrl: { type: 'string', description: 'Public https URL of the video file.' },
        madeForKids: { type: 'boolean' },
      },
      required: ['title'],
    },
  },
  {
    name: 'generate_and_post_youtube_short',
    description: 'Generate a new vertical YouTube Short with Grok video and upload it to the connected channel. Use when the user wants a new clip created and posted.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        prompt: { type: 'string', description: 'What the 9:16 clip shows.' },
        duration: { type: 'integer', description: 'Seconds from 1 to 15. Default 8.' },
        title: { type: 'string' },
        description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        privacyStatus: { type: 'string', enum: ['public', 'unlisted', 'private'] },
        madeForKids: { type: 'boolean' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'list_youtube_videos',
    description: 'List recent videos on the connected YouTube channel with lifetime views, likes, and comments.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: { type: 'integer', description: 'How many videos to return, up to 20. Default 10.' },
      },
    },
  },
  {
    name: 'analyze_youtube_video',
    description: 'Read YouTube analytics for one video and return how it performed and what to improve. videoId is the 11-character YouTube id. Set provider to openai to have OpenAI write the review.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
        properties: {
          videoId: { type: 'string' },
          provider: {
            type: 'string',
            enum: ['grok', 'claude', 'openai'],
            description: 'Who writes the review. Omit this to use the Analysis provider in Settings.',
          },
        },
      required: ['videoId'],
    },
  },
  {
    name: 'update_youtube_video',
    description: 'Edit a video already on the connected YouTube channel. Change title, description, tags, or privacy. Omit any field you are not changing. videoId is the 11-character YouTube id.',
    inputSchema: {
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
  {
    name: 'post_linkedin',
    description: 'Post text, text with a link preview card (linkUrl), or a video with text, to the connected LinkedIn profile. Use when the user asks to post or publish on LinkedIn.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        commentary: { type: 'string', description: 'Post text. Required unless title is set.' },
        title: { type: 'string', description: 'Optional video title.' },
        mediaId: { type: 'string', description: 'SocialBrewery media ID for a local video.' },
        videoUrl: { type: 'string', description: 'Public https URL of an mp4, mov, or webm.' },
        linkUrl: { type: 'string', description: 'Optional URL to share as a link preview card (article), e.g. a YouTube video. Ignored when a video is attached.' },
        linkTitle: { type: 'string', description: 'Optional title for the link preview card.' },
        linkDescription: { type: 'string', description: 'Optional description for the link preview card.' },
        linkThumbnailUrl: { type: 'string', description: 'Optional image URL for the card thumbnail. YouTube links use the video thumbnail automatically.' },
        firstComment: { type: 'string', description: 'Optional comment to add under the post right after it is published, e.g. links.' },
      },
    },
  },
  {
    name: 'comment_linkedin',
    description: 'Add a comment as the connected LinkedIn member on a LinkedIn post. Use for adding links or follow-ups under a post.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        post: { type: 'string', description: 'Post URN (urn:li:share:…, urn:li:ugcPost:…, urn:li:activity:…) or the post link.' },
        text: { type: 'string', description: 'Comment text, up to 1250 characters.' },
      },
      required: ['post', 'text'],
    },
  },
  {
    name: 'update_linkedin_post',
    description: 'Update the commentary of an existing LinkedIn post without creating a new post.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        post: { type: 'string', description: 'Post URN or LinkedIn post link.' },
        commentary: { type: 'string', description: 'Replacement post text.' },
      },
      required: ['post', 'commentary'],
    },
  },
  {
    name: 'generate_and_post_linkedin',
    description: 'Generate a vertical clip with Grok video and post it to LinkedIn with commentary.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        prompt: { type: 'string' },
        duration: { type: 'integer' },
        commentary: { type: 'string' },
        title: { type: 'string' },
        firstComment: { type: 'string' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'post_instagram_reel',
    description: 'Post a Reel to the connected Instagram professional account. Needs a mediaId or public videoUrl. The app must have a public tunnel URL set so Instagram can fetch the file.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        caption: { type: 'string' },
        title: { type: 'string' },
        mediaId: { type: 'string' },
        videoUrl: { type: 'string' },
      },
    },
  },
  {
    name: 'generate_and_post_instagram_reel',
    description: 'Generate a vertical clip with Grok video and publish it as an Instagram Reel.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        prompt: { type: 'string' },
        duration: { type: 'integer' },
        caption: { type: 'string' },
        title: { type: 'string' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'post_x',
    description: 'Post to the connected X (Twitter) account: text, or a video with text. Keep text within 280 characters unless the account has X Premium.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string', description: 'Post text. Links count as 23 characters.' },
        mediaId: { type: 'string', description: 'SocialBrewery media ID for a video.' },
        videoUrl: { type: 'string', description: 'Public https URL of an mp4, mov, or webm.' },
        firstReply: { type: 'string', description: 'Optional reply posted under it right away, e.g. links or a thread follow-up.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'reply_x',
    description: 'Reply as the connected X account to an X post. Use for threads or adding links under a post.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        post: { type: 'string', description: 'X post id or its x.com / twitter.com link.' },
        text: { type: 'string' },
      },
      required: ['post', 'text'],
    },
  },
  {
    name: 'delete_x_post',
    description: 'Delete a post from the connected X account. Only do this when the user explicitly asks.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        post: { type: 'string', description: 'X post id or its link.' },
      },
      required: ['post'],
    },
  },
  {
    name: 'generate_and_post_x',
    description: 'Generate a vertical clip with Grok video and post it to X with text.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        prompt: { type: 'string' },
        duration: { type: 'integer' },
        text: { type: 'string' },
        firstReply: { type: 'string' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'publish_hashnode_article',
    description: 'Publish a Markdown article to the connected Hashnode blog, or save it as a draft. Use draft unless the user asked to publish.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...HASHNODE_ARTICLE,
        canonicalUrl: { type: 'string', description: 'Original URL when the article was first published elsewhere.' },
        draft: { type: 'boolean', description: 'Save as a draft instead of publishing. Default false.' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'update_hashnode_article',
    description: 'Edit an article already published on the connected Hashnode blog. Omit fields that stay the same.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        post: { type: 'string', description: 'Hashnode post id from list_hashnode_articles.' },
        ...HASHNODE_ARTICLE,
      },
      required: ['post'],
    },
  },
  {
    name: 'list_hashnode_articles',
    description: 'List recent articles on the connected Hashnode blog with views, reactions, and comments.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: { type: 'integer', description: 'How many, up to 50. Default 20.' },
      },
    },
  },
  {
    name: 'post_slack',
    description: 'Post a message, optionally with a video, to a channel in the connected Slack workspace. Uses Slack mrkdwn: *bold*, _italic_, <https://url|label>.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        channel: { type: 'string', description: 'Channel name like #announcements or a channel id. Omit to use the default channel from Settings.' },
        text: { type: 'string' },
        mediaId: { type: 'string', description: 'SocialBrewery media ID of a video to attach.' },
        videoUrl: { type: 'string', description: 'Public https URL of an mp4, mov, or webm to attach.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'reply_slack',
    description: 'Reply in the thread of a Slack message.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        post: { type: 'string', description: 'Slack message link (from Copy link).' },
        text: { type: 'string' },
      },
      required: ['post', 'text'],
    },
  },
  {
    name: 'list_slack_channels',
    description: 'List channels in the connected Slack workspace that the app can see, and whether it is already a member.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'reddit_subreddit_rules',
    description: 'Get a subreddit\'s rules, allowed post types, and post flairs. Always read these before posting to a subreddit.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { subreddit: { type: 'string', description: 'Subreddit name like r/selfhosted.' } },
      required: ['subreddit'],
    },
  },
  {
    name: 'post_reddit',
    description: 'Submit a post to one subreddit the user named, as the connected Reddit account. Text post by default; give url for a link post. Check reddit_subreddit_rules first. Never post the same thing to several subreddits. Without Reddit API keys it returns a submitUrl for the user to open and click Post instead.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        subreddit: { type: 'string', description: 'Subreddit name like r/selfhosted.' },
        title: { type: 'string', description: 'Post title, up to 300 characters.' },
        text: { type: 'string', description: 'Markdown body for a text post.' },
        url: { type: 'string', description: 'https link for a link post (instead of text).' },
        flairId: { type: 'string', description: 'Flair id from reddit_subreddit_rules, if the subreddit needs one.' },
        flairText: { type: 'string' },
        nsfw: { type: 'boolean' },
        spoiler: { type: 'boolean' },
        firstComment: { type: 'string', description: 'Optional comment to add under the post right away.' },
      },
      required: ['subreddit', 'title'],
    },
  },
  {
    name: 'comment_reddit',
    description: 'Comment on a Reddit post, or reply to a comment, as the connected account.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        post: { type: 'string', description: 'Reddit post or comment link, or a t3_/t1_ id.' },
        text: { type: 'string', description: 'Markdown comment text.' },
      },
      required: ['post', 'text'],
    },
  },
  {
    name: 'list_reddit_subreddits',
    description: 'List the subreddits the connected Reddit account has joined.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'delete_reddit_post',
    description: 'Delete a Reddit post or comment made by the connected account. Only when the user explicitly asks to delete.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { post: { type: 'string', description: 'Reddit post or comment link, or a t3_/t1_ id.' } },
      required: ['post'],
    },
  },
];

// Each organisation has its own connector token; the token alone decides which organisation a call runs in.
const STUDIO_SCENE = {
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
    effect: { type: 'string', enum: EFFECTS, description: 'Entry effect. zoom-through/shutter also style the exit of the previous scene. endcard shows loader, CTA, and question.' },
    pillars: { type: 'array', items: { type: 'number' }, description: 'For effect "pillars": measured bar heights from the real chart.' },
    captions: { type: 'array', items: { type: 'object', properties: { at: { type: 'number' }, text: { type: 'string' } } }, description: 'Burned-in caption chunks, seconds from scene start.' },
    duration: { type: 'number', description: 'Seconds. Match the voiceover line length.' },
  },
};

const STUDIO_PROJECT = {
  title: { type: 'string' },
  template: { type: 'string', enum: Object.keys(TEMPLATES) },
  formats: { type: 'array', items: { type: 'string', enum: ['9x16', '16x9'] }, description: 'Cuts to build. Default from the template.' },
  style: { type: 'string', description: 'Motion style id from list_video_styles (for the record and the playbook).' },
  brand: { description: 'Brand kit id (e.g. "default", "openlit", or one saved with save_brand_kit) or an inline brand object.' },
  scenes: { type: 'array', items: STUDIO_SCENE },
  cta: { type: 'object', properties: { label: { type: 'string' }, url: { type: 'string' } } },
  question: { type: 'string', description: 'Open-ended question for the end card.' },
  voiceoverId: { type: 'string', description: 'From generate_voiceover.' },
};

export const STUDIO_TOOLS = [
  {
    name: 'list_video_styles',
    description: 'Video Studio: list motion styles, playbooks, templates, scene effects, brand kits, and guides. Start here before making a launch video, Short, or promo.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'get_video_playbook',
    description: 'Video Studio: get a step-by-step playbook plus the style guide, copy rules, voice rules, an optional motion style, and the brand kit, as one Markdown document. Follow it.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        playbook: { type: 'string', description: 'launch-video, product-short, or explainer-promo. Default launch-video.' },
        style: { type: 'string', description: 'Motion style id, e.g. cinematic, graph-to-3d-pillars, prompt-motion, product-launch, brag-storytelling, pastel-explainer.' },
        brand: { type: 'string', description: 'Brand kit id. Default "default".' },
      },
    },
  },
  {
    name: 'list_studio_docs',
    description: 'Video Studio: list every document in the knowledge pack (guides, motion styles, playbooks, templates, brand kits, vendored brag and cinetic skills) with studio:// URIs.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'get_studio_doc',
    description: 'Video Studio: read one knowledge-pack document by path or studio:// URI, e.g. vendor/cinetic/references/camera.md.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'save_brand_kit',
    description: 'Video Studio: save a brand kit for this organisation (colors as hex, fonts, logo URL, voice, CTA, keywords). Use the id later as brand.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' }, name: { type: 'string' }, tagline: { type: 'string' }, logoUrl: { type: 'string' }, website: { type: 'string' },
        colors: { type: 'object', description: 'bg, ink, muted, accent, button, buttonText, card.' },
        fonts: { type: 'object', description: 'sans and mono font family names (Inter and Geist Mono are bundled).' },
        voice: { type: 'object', description: 'elevenlabsVoiceId, model, speed, kokoroVoice.' },
        cta: { type: 'object', properties: { label: { type: 'string' }, url: { type: 'string' } } },
        keywords: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'add_studio_asset',
    description: 'Video Studio: store a real screenshot or clip for scenes (base64 or a public https URL). Returns image: "assets/<name>" to use in a scene.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { name: { type: 'string', description: 'File name ending in .png, .jpg, .webp, .gif, .svg, .mp4, or .webm.' }, base64: { type: 'string' }, url: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'generate_voiceover',
    description: 'Video Studio: narrate text with ElevenLabs (org key in Settings, brand voice by default) or local Kokoro as a fallback, sped up (default from the brand, 1.25x for OpenLIT). Returns voiceoverId and duration.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string' },
        brand: { type: 'string' },
        voiceId: { type: 'string' },
        model: { type: 'string', description: 'Default eleven_multilingual_v2.' },
        speed: { type: 'number', description: '0.5 to 2. Applied with ffmpeg atempo.' },
        provider: { type: 'string', enum: ['elevenlabs', 'kokoro'] },
      },
      required: ['text'],
    },
  },
  {
    name: 'create_video_project',
    description: 'Video Studio: build a HyperFrames + GSAP composition from scenes, a brand kit, CTA, question, and voiceover. Returns projectId. Show the plan to the user before rendering.',
    inputSchema: { type: 'object', additionalProperties: false, properties: STUDIO_PROJECT, required: ['scenes'] },
  },
  {
    name: 'update_video_project',
    description: 'Video Studio: change any field of a project (scenes, brand, formats, CTA, question, voiceover) and rebuild it.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { projectId: { type: 'string' }, ...STUDIO_PROJECT }, required: ['projectId'] },
  },
  {
    name: 'get_video_project',
    description: 'Video Studio: read a project, including the generated composition HTML per format.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { projectId: { type: 'string' }, includeHtml: { type: 'boolean' } }, required: ['projectId'] },
  },
  {
    name: 'render_video',
    description: 'Video Studio: render a project cut to MP4 with HyperFrames (headless Chrome), master audio to -14 LUFS, and add it to the media library. Starts a job; poll get_render_status. The result mediaId works with post_youtube_short, post_slack, post_x, post_instagram_reel, post_linkedin.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { projectId: { type: 'string' }, format: { type: 'string', enum: ['9x16', '16x9'] }, quality: { type: 'string', enum: ['standard', 'delivery'] } },
      required: ['projectId'],
    },
  },
  {
    name: 'get_render_status',
    description: 'Video Studio: check a render job. When status is done it has mediaId.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { jobId: { type: 'string' } }, required: ['jobId'] },
  },
];

// The connector lists the Video Studio tools after the posting tools.
MCP_TOOLS.push(...STUDIO_TOOLS);

export const MCP_PROMPTS = [
  { name: 'make_launch_video', description: 'Make a launch video from a PR, changelog, or docs page with the Video Studio.', arguments: [{ name: 'source', description: 'PR, docs, or changelog URL', required: true }, { name: 'brand', description: 'Brand kit id' }, { name: 'style', description: 'Motion style id' }], playbook: 'launch-video' },
  { name: 'make_product_short', description: 'Make a vertical product Short on real screenshots with the Video Studio.', arguments: [{ name: 'topic', description: 'What the Short is about', required: true }, { name: 'brand', description: 'Brand kit id' }, { name: 'style', description: 'Motion style id' }], playbook: 'product-short' },
  { name: 'make_explainer_promo', description: 'Make an explainer promo that lands on the product.', arguments: [{ name: 'topic', description: 'Concept to explain', required: true }, { name: 'brand', description: 'Brand kit id' }, { name: 'style', description: 'Motion style id' }], playbook: 'explainer-promo' },
];

async function getPrompt(params) {
  const prompt = MCP_PROMPTS.find((p) => p.name === params?.name);
  if (!prompt) throw new Error(`Unknown prompt: ${params?.name || 'missing'}`);
  const args = params.arguments || {};
  const pack = await getVideoPlaybook({ playbook: prompt.playbook, style: args.style || undefined, brand: args.brand || undefined });
  const subject = args.source || args.topic || '';
  return {
    description: prompt.description,
    messages: [{
      role: 'user',
      content: { type: 'text', text: `${prompt.description}\nSubject: ${subject}\nBrand kit (JSON): ${JSON.stringify(pack.brand)}\n\nFollow this playbook and these rules. Draft first and ask before posting anything.\n\n${pack.text}` },
    }],
  };
}

// The same connector serves Grok (grok.com) and Claude (claude.ai, Claude Desktop, Claude Code). The
// client parameter only labels what each one posts; the token is what grants access.
export const MCP_CLIENTS = ['grok', 'claude'];

export function connectorDetails() {
  const token = cfg.CONNECTOR_TOKEN || '';
  const origin = publicOrigin();
  const base = `${origin || appUrl()}/mcp?token=${encodeURIComponent(token)}`;
  return {
    name: 'Socialbrewery',
    mcpUrl: base,
    claudeUrl: `${base}&client=claude`,
    localOnly: !origin,
    connectorsPage: 'https://grok.com/connectors',
    claudePage: 'https://claude.ai/settings/connectors',
  };
}

export function mcpClientFrom(url) {
  const client = url?.searchParams?.get('client');
  return MCP_CLIENTS.includes(client) ? client : 'grok';
}

// Newest first. The server answers with the client's version when it knows it.
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export function connectorTokenFrom(req, url) {
  const header = String(req.headers.authorization || '');
  const bearer = /^bearer\s+/i.test(header) ? header.replace(/^bearer\s+/i, '').trim() : '';
  return bearer || url?.searchParams?.get('token') || '';
}

export async function handleRpc(message, { client = 'grok' } = {}) {
  const id = message?.id ?? null;
  const method = message?.method;
  if (!method) return rpcError(id, -32600, 'Invalid request.');
  if (method === 'initialize') {
    const requested = message.params?.protocolVersion;
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
      capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, prompts: { listChanged: false } },
      serverInfo: { name: 'socialbrewery', version: '0.2.0' },
    });
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return null;
  if (method === 'ping') return rpcResult(id, {});
  if (method === 'tools/list') return rpcResult(id, { tools: MCP_TOOLS });
  if (method === 'resources/list') {
    return rpcResult(id, { resources: listStudioDocs().map(({ uri, path, title, summary, mimeType }) => ({ uri, name: path, title: title || path, description: summary || undefined, mimeType })) });
  }
  if (method === 'resources/templates/list') return rpcResult(id, { resourceTemplates: [] });
  if (method === 'resources/read') {
    try {
      const doc = readStudioDoc(message.params?.uri);
      const mimeType = doc.path.endsWith('.json') ? 'application/json' : doc.path.endsWith('.html') ? 'text/html' : 'text/markdown';
      return rpcResult(id, { contents: [{ uri: doc.uri, mimeType, text: doc.text }] });
    } catch (err) {
      return rpcError(id, -32002, err.message);
    }
  }
  if (method === 'prompts/list') {
    return rpcResult(id, { prompts: MCP_PROMPTS.map(({ name, description, arguments: args }) => ({ name, description, arguments: args })) });
  }
  if (method === 'prompts/get') {
    try {
      return rpcResult(id, await getPrompt(message.params));
    } catch (err) {
      return rpcError(id, -32602, err.message);
    }
  }
  if (method === 'tools/call') {
    try {
      const data = await callTool(message.params || {}, MCP_CLIENTS.includes(client) ? client : 'grok');
      return rpcResult(id, {
        content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
        isError: false,
      });
    } catch (err) {
      return rpcResult(id, {
        content: [{ type: 'text', text: err.message || 'Tool failed.' }],
        isError: true,
      });
    }
  }
  if (id == null) return null;
  return rpcError(id, -32601, `Unknown method: ${method}`);
}

async function callTool(params, source) {
  const name = params.name;
  const args = params.arguments || {};
  if (name === 'post_youtube_short') {
    return postToYouTube({ ...args, source });
  }
  if (name === 'generate_and_post_youtube_short') {
    return generateAndPost({ ...args, source });
  }
  if (name === 'list_youtube_videos') {
    const limit = Math.min(20, Math.max(1, Number(args.limit) || 10));
    return { videos: await listChannelVideos(limit) };
  }
  if (name === 'analyze_youtube_video') {
    return analyzeVideo(args.videoId, { provider: args.provider });
  }
  if (name === 'update_youtube_video') {
    return updateVideo(args);
  }
  if (name === 'post_linkedin') {
    return postToLinkedIn({ ...args, source });
  }
  if (name === 'comment_linkedin') {
    return commentOnLinkedIn(args);
  }
  if (name === 'update_linkedin_post') {
    return updateLinkedInPost(args);
  }
  if (name === 'generate_and_post_linkedin') {
    return generateAndPostLinkedIn({ ...args, source });
  }
  if (name === 'post_instagram_reel') {
    return postToInstagram({ ...args, source });
  }
  if (name === 'generate_and_post_instagram_reel') {
    return generateAndPostInstagram({ ...args, source });
  }
  if (name === 'post_x') {
    return postToX({ ...args, source });
  }
  if (name === 'reply_x') {
    return replyOnX(args);
  }
  if (name === 'delete_x_post') {
    return deleteXPost(args);
  }
  if (name === 'generate_and_post_x') {
    return generateAndPostX({ ...args, source });
  }
  if (name === 'publish_hashnode_article') {
    return postToHashnode({ ...args, source });
  }
  if (name === 'update_hashnode_article') {
    return updateHashnode(args);
  }
  if (name === 'list_hashnode_articles') {
    return { articles: await listHashnodePosts(args.limit) };
  }
  if (name === 'post_slack') {
    return postToSlack({ ...args, source });
  }
  if (name === 'reply_slack') {
    return replyOnSlack(args);
  }
  if (name === 'list_slack_channels') {
    return { channels: await listSlackChannels() };
  }
  if (name === 'reddit_subreddit_rules') {
    return redditRules(args);
  }
  if (name === 'post_reddit') {
    return postToReddit({ ...args, source });
  }
  if (name === 'comment_reddit') {
    return commentOnReddit(args);
  }
  if (name === 'list_reddit_subreddits') {
    return { subreddits: await listRedditSubreddits() };
  }
  if (name === 'delete_reddit_post') {
    return deleteReddit(args.post);
  }
  if (name === 'list_video_styles') return listVideoStyles();
  if (name === 'get_video_playbook') return getVideoPlaybook(args);
  if (name === 'list_studio_docs') return { docs: listStudioDocs() };
  if (name === 'get_studio_doc') return readStudioDoc(args.path).text;
  if (name === 'save_brand_kit') return saveBrandKit(args);
  if (name === 'add_studio_asset') return addStudioAsset(args);
  if (name === 'generate_voiceover') return generateVoiceover(args);
  if (name === 'create_video_project') return createVideoProject(args);
  if (name === 'update_video_project') return updateVideoProject(args);
  if (name === 'get_video_project') return getVideoProject(args);
  if (name === 'render_video') return renderVideo(args);
  if (name === 'get_render_status') return getRenderStatus(args);
  throw new Error(`Unknown tool: ${name || 'missing'}`);
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
