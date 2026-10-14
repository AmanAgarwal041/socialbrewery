import { clampTitle } from './shorts.js';
import { generateShort } from './grok.js';
import { importRemoteVideo, publishShort } from './youtube.js';
import { commentLinkedin, publishLinkedin, updateLinkedInPost as updateLinkedInPostApi } from './linkedin.js';
import { publishInstagramReel } from './instagram.js';
import { deleteX, publishX, replyX } from './x.js';
import { publishHashnode } from './hashnode.js';
import { postSlack, replySlack } from './slack.js';
import {
  commentReddit,
  redditApiConnected,
  redditRulesUrl,
  redditSubmitUrl,
  submitReddit,
  subredditDetails,
  subredditName,
} from './reddit.js';

export async function postToYouTube({
  mediaId,
  videoUrl,
  title,
  description,
  tags,
  privacyStatus,
  madeForKids,
  source,
}) {
  let id = mediaId;
  if (!id && videoUrl) {
    const media = await importRemoteVideo(videoUrl);
    id = media.id;
  }
  if (!id) throw new Error('Provide a mediaId or a public https videoUrl.');
  const post = await publishShort({
    mediaId: id,
    title,
    description,
    tags,
    privacyStatus,
    madeForKids,
    source: source || 'connector',
  });
  return {
    youtubeId: post.youtubeId,
    url: post.url,
    title: post.title,
    privacyStatus: post.privacyStatus,
  };
}

export async function generateAndPost({
  prompt,
  duration,
  title,
  description,
  tags,
  privacyStatus,
  madeForKids,
  source,
  signal,
}) {
  const text = String(prompt || '').trim();
  if (!text) throw new Error('Describe the Short to generate.');
  const record = await generateShort({ prompt: text, duration, signal });
  return postToYouTube({
    mediaId: record.id,
    title: title || clampTitle(text),
    description: description || text,
    tags,
    privacyStatus,
    madeForKids,
    source: source || 'grok',
  });
}

export async function postToLinkedIn({ mediaId, videoPath, videoUrl, commentary, title, linkUrl, linkTitle, linkDescription, linkThumbnailUrl, firstComment, source }) {
  let id = mediaId;
  if (!id && videoUrl) {
    const media = await importRemoteVideo(videoUrl);
    id = media.id;
  }
  const post = await publishLinkedin({
    mediaId: id,
    videoPath,
    linkUrl,
    linkTitle,
    linkDescription,
    linkThumbnailUrl,
    commentary: commentary || title,
    title,
    source: source || 'connector',
  });
  const result = {
    linkedinId: post.linkedinId,
    url: post.url,
    title: post.title,
  };
  if (post.link) result.link = post.link;
  if (post.thumbnailError) result.thumbnailError = post.thumbnailError;
  if (String(firstComment || '').trim()) {
    try {
      result.comment = await commentLinkedin({ post: post.linkedinId, text: firstComment });
    } catch (err) {
      result.commentError = `The post is live, but the first comment failed: ${err.message}`;
    }
  }
  return result;
}

export async function commentOnLinkedIn({ post, text }) {
  return commentLinkedin({ post, text });
}

export async function updateLinkedInPost({ post, commentary }) {
  const text = String(commentary || '').trim();
  if (!text) throw new Error('LinkedIn needs post text.');
  return updateLinkedInPostApi(post, text);
}

export async function generateAndPostLinkedIn({ prompt, duration, commentary, title, firstComment, source, signal }) {
  const text = String(prompt || '').trim();
  if (!text) throw new Error('Describe the clip to generate.');
  const record = await generateShort({ prompt: text, duration, signal });
  return postToLinkedIn({
    mediaId: record.id,
    commentary: commentary || text,
    title: title || clampTitle(text),
    firstComment,
    source: source || 'grok',
  });
}

export async function postToInstagram({ mediaId, videoUrl, caption, title, source }) {
  let id = mediaId;
  if (!id && videoUrl) {
    const media = await importRemoteVideo(videoUrl);
    id = media.id;
  }
  if (!id) throw new Error('Provide a mediaId or a public https videoUrl.');
  const post = await publishInstagramReel({
    mediaId: id,
    caption: caption || title,
    title,
    source: source || 'connector',
  });
  return {
    instagramId: post.instagramId,
    url: post.url,
    title: post.title,
  };
}

export async function generateAndPostInstagram({ prompt, duration, caption, title, source, signal }) {
  const text = String(prompt || '').trim();
  if (!text) throw new Error('Describe the Reel to generate.');
  const record = await generateShort({ prompt: text, duration, signal });
  return postToInstagram({
    mediaId: record.id,
    caption: caption || text,
    title: title || clampTitle(text),
    source: source || 'grok',
  });
}

export async function postToX({ mediaId, videoUrl, text, title, firstReply, source }) {
  let id = mediaId;
  if (!id && videoUrl) {
    const media = await importRemoteVideo(videoUrl);
    id = media.id;
  }
  const post = await publishX({
    mediaId: id,
    text: text || title,
    title,
    source: source || 'connector',
  });
  const result = { xId: post.xId, url: post.url, title: post.title };
  if (String(firstReply || '').trim()) {
    try {
      result.reply = await replyX({ post: post.xId, text: firstReply });
    } catch (err) {
      result.replyError = `The post is live, but the reply failed: ${err.message}`;
    }
  }
  return result;
}

export async function replyOnX({ post, text }) {
  return replyX({ post, text });
}

export async function deleteXPost({ post }) {
  return deleteX(post);
}

export async function postToHashnode({ title, subtitle, content, tags, coverImageUrl, canonicalUrl, slug, draft, source }) {
  const post = await publishHashnode({
    title,
    subtitle,
    content,
    tags,
    coverImageUrl,
    canonicalUrl,
    slug,
    draft: Boolean(draft),
    source: source || 'connector',
  });
  return { hashnodeId: post.hashnodeId, url: post.url, title: post.title, draft: Boolean(draft) };
}

export async function postToSlack({ channel, text, mediaId, videoUrl, title, source }) {
  let id = mediaId;
  if (!id && videoUrl) {
    const media = await importRemoteVideo(videoUrl);
    id = media.id;
  }
  const post = await postSlack({ channel, text, title, mediaId: id, source: source || 'connector' });
  return { slackTs: post.slackTs, channel: post.slackChannelName || post.slackChannel, url: post.url };
}

export async function replyOnSlack({ post, text }) {
  return replySlack({ post, text });
}

export async function postToReddit({ subreddit, title, text, url, flairId, flairText, nsfw, spoiler, firstComment, source }) {
  if (!(await redditApiConnected())) {
    if (!String(title || '').trim()) throw new Error('Reddit needs a title.');
    const submitUrl = redditSubmitUrl({ subreddit, title, text, url });
    return {
      manual: true,
      subreddit: subredditName(subreddit),
      url: submitUrl,
      submitUrl,
      note: 'Reddit API keys are not connected, so nothing was posted yet. Open submitUrl: Reddit opens its submit page with the title and text filled in, and the person clicks Post. They can paste the new post link into Socialbrewery to track it.',
    };
  }
  const post = await submitReddit({ subreddit, title, text, url, flairId, flairText, nsfw, spoiler, source: source || 'connector' });
  const result = { redditId: post.redditId, subreddit: post.subreddit, url: post.url, title: post.title };
  if (String(firstComment || '').trim() && post.redditId) {
    try {
      result.comment = await commentReddit({ post: post.redditId, text: firstComment });
    } catch (err) {
      result.commentError = `The post is live, but the comment failed: ${err.message}`;
    }
  }
  return result;
}

export async function commentOnReddit({ post, text }) {
  if (!(await redditApiConnected())) {
    throw new Error('Commenting through Socialbrewery needs Reddit API keys. Open the post on Reddit and comment there.');
  }
  return commentReddit({ post, text });
}

export async function redditRules({ subreddit }) {
  if (!(await redditApiConnected())) {
    const name = subredditName(subreddit);
    return {
      manual: true,
      name,
      rulesUrl: redditRulesUrl(name),
      note: 'Reddit API keys are not connected, so the rules cannot be read here. Ask the person to check rulesUrl before posting, and keep the post genuine and on topic.',
    };
  }
  return subredditDetails(subreddit);
}

export async function generateAndPostX({ prompt, duration, text, title, firstReply, source, signal }) {
  const idea = String(prompt || '').trim();
  if (!idea) throw new Error('Describe the clip to generate.');
  const record = await generateShort({ prompt: idea, duration, signal });
  return postToX({
    mediaId: record.id,
    text: text || idea,
    title: title || clampTitle(idea),
    firstReply,
    source: source || 'grok',
  });
}
