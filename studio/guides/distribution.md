# Distribution

Order: YouTube first, then LinkedIn with the YouTube link card, then Slack, then others.

- Draft every post and show it to the user. Post only after an explicit yes for that exact post.
- After posting, open the live URL and verify text, link card and video before saying it is done.
- YouTube: `post_youtube_short` with `mediaId` from `render_video` (or `create_video_from_file`).
- LinkedIn: `post_linkedin` with `commentary` and `linkUrl` = the YouTube URL. Links in the text go at the end.
- Slack: `post_slack` short text + video or link, then `reply_slack` with the extra links.
- X: under 280 characters, video or link, extra links in a reply.
- LinkedIn has no Shorts format. Native vertical video reaches the mobile video feed; a YouTube card drives YouTube views.
  Pick based on the goal, the default is the YouTube card.
