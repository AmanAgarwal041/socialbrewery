# Playbook: launch video
> From a PR or docs page to a posted launch video in both cuts.

Tools: `get_video_playbook`, `create_video_project`, `generate_voiceover`, `render_video`, then `post_youtube_short`, `post_linkedin`, `post_slack`.

1. Read the brand kit and `guides/style-guide.md`, `guides/copy-rules.md`. Pick a motion style (`list_video_styles`).
2. Inspect the source (PR, docs). Write a beat sheet: hook (3 s), problem, 3 to 5 features, proof, end card. Show it to the user.
3. Collect REAL screenshots from the merged product (upload them or give public https URLs).
4. Write the voiceover script, one line per scene, following the copy rules. Get the user's OK.
5. `generate_voiceover` per line (or the whole script) with `speed: 1.25`. Note each duration.
6. `create_video_project` with `template` (`launch-landscape` or `short-vertical`), `brand`, and `scenes`
   (headline, sub, image URL, duration from step 5), plus `cta`, `question`, `voiceoverId`.
7. Review the returned HTML and keyframes. Fix copy and timing with `update_video_project`.
8. `render_video` for 16:9 and 9:16. It masters audio to -14 LUFS and adds the MP4 to the media library.
9. Draft posts per network (`guides/distribution.md`). Post only after the user says yes to each one. Verify live.
