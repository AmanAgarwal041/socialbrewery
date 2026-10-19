// What we know about each network's posting flow. Sites change their layouts, so these are hints:
// the agent still reads the page before acting. `publish` lists button labels that make content
// public there; clicking one always waits for the user's approval (see tools.ts).

export type Playbook = {
  network: string
  hosts: RegExp
  start: string
  publish: RegExp
  /** Enter sends a message here instead of adding a line. */
  enterSends?: boolean
  hints: string
}

export const PLAYBOOKS: Playbook[] = [
  {
    network: 'LinkedIn',
    hosts: /(^|\.)linkedin\.com$/,
    start: 'https://www.linkedin.com/feed/',
    publish: /^(post|repost|send|comment|reply|schedule)$/i,
    hints: `Open https://www.linkedin.com/feed/ and click "Start a post". The editor is a textbox ("Text editor for creating content"); click it, then type. For media, use the "Add media" button's file input with upload_file, then "Next". A link in the text gets a preview card automatically after a moment. The final button is "Post". Comments: open the post, click "Comment", type, then the "Comment" button.`,
  },
  {
    network: 'X',
    hosts: /(^|\.)(x|twitter)\.com$/,
    start: 'https://x.com/compose/post',
    publish: /^(post|post all|reply|repost|tweet|tweet all|send)$/i,
    hints: `https://x.com/compose/post opens the composer. The textbox is "Post text". Keep each post within 280 characters (a link counts as 23). For a video or image, use upload_file on the composer's file input (often listed as an input of type file near "Add photos or video") and wait for the upload to finish. To make a thread, use "Add post" (the + button) for each next part. The final button is "Post" (or "Post all" for a thread).`,
  },
  {
    network: 'YouTube',
    hosts: /(^|\.)(youtube|studio\.youtube)\.com$/,
    start: 'https://studio.youtube.com/',
    publish: /^(publish|save|schedule|post)$/i,
    hints: `Uploads happen in YouTube Studio (https://studio.youtube.com/). Click "Create" then "Upload videos", and use upload_file on the dialog's file input (do not click "Select files", which opens the system picker). Wait until the details form appears. Title and description are contenteditable textboxes; the title starts as the file name, so click it, press Mod+A, then type. Shorts: vertical videos up to 3 minutes become Shorts; put #Shorts in the description. Answer "No, it's not made for kids" unless told otherwise. Click "Next" until Visibility, choose the privacy the user asked for (default Unlisted), then "Save" or "Publish". Community posts are at the channel's "Create post".`,
  },
  {
    network: 'Instagram',
    hosts: /(^|\.)instagram\.com$/,
    start: 'https://www.instagram.com/',
    publish: /^(share|post|send)$/i,
    hints: `On https://www.instagram.com/ use "New post" / "Create" in the sidebar, then "Post" or "Reel". Use upload_file on the dialog's file input instead of "Select from computer". Click "Next" through crop and edit (choose the original or 9:16 crop for Reels), then type the caption in "Write a caption…". The final button is "Share". Instagram needs a video or image; it cannot post text alone.`,
  },
  {
    network: 'Reddit',
    hosts: /(^|\.)reddit\.com$/,
    start: 'https://www.reddit.com/submit',
    publish: /^(post|submit|comment|reply|save)$/i,
    hints: `Only post to a subreddit the user named, one subreddit per request, never cross-post. Read the rules first at https://www.reddit.com/r/<name>/about/rules and say so if the post would break them. Submit at https://www.reddit.com/r/<name>/submit: pick the Text or Link tab, fill "Title" (plain and specific, no hashtags) and the body or URL, add flair if required, then "Post".`,
  },
  {
    network: 'Slack',
    hosts: /(^|\.)slack\.com$/,
    start: 'https://app.slack.com/client',
    publish: /^(send|send now|send message|schedule|post|reply)$/i,
    enterSends: true,
    hints: `Use the Slack web app (https://app.slack.com/client). Open the channel from the sidebar, or press Mod+k and type the channel name, then Enter. Click the message box ("Message #channel"), type the message (line breaks are added with Shift+Enter automatically), and send with Enter or the "Send now" button. Slack formatting: *bold*, _italic_, links as plain URLs. For a thread reply, hover the message and use "Reply in thread".`,
  },
  {
    network: 'Hashnode',
    hosts: /(^|\.)hashnode\.(com|dev)$/,
    start: 'https://hashnode.com/draft',
    publish: /^(publish|publish now|update|schedule)$/i,
    hints: `Write at https://hashnode.com/draft (or the blog dashboard's "New article"). Fill the title, then the Markdown editor body: write a real article with headings, not a caption. Tags and the cover image are in the publish panel. Save as a draft unless the user clearly asked to publish; the final button is "Publish".`,
  },
]

export function playbookFor(url: string): Playbook | undefined {
  try {
    const host = new URL(url).hostname
    return PLAYBOOKS.find((p) => p.hosts.test(host))
  } catch {
    return undefined
  }
}

// Labels that publish or send on any site, used where no playbook matches.
export const GENERIC_PUBLISH = /^(post|publish|share|send|submit|tweet|reply|comment|schedule|go live|upload|save and publish)( now| post| all)?$/i
