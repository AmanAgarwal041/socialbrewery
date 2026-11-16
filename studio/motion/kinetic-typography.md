# Kinetic typography
> Words are the visuals: one idea per scene, punched in word by word, with a counted-up number for proof.

Good for launches without screenshots, hot takes, quotes, and "3 things you need to know" Shorts.

- Effects: `kinetic` for the hook (words land one at a time, big and turning), `split` for a contrast line ("Slow builds. Fast fixes."), `counter` for one real metric, `wipe` between sections, `endcard` last.
- One short line per scene (3 to 7 words). Mark the key word with `highlight`; it takes the accent color.
- `counter` needs `stat: { value, prefix, suffix, decimals }` with a real, sourced number ("40%" is `{ value: 40, suffix: "%" }`). Never invent a metric.
- Timing: hook 2.5 to 3.5 s, contrast lines 2.5 s, counter 3 to 4 s, end card 4 to 5 s. A 20 to 30 s vertical Short is 6 to 9 scenes.
- Leave the kicker for the topic label (mono, uppercase), not a second headline.
- Example flow: `kinetic` "Your agent broke at 2am" → `split` "Logs say nothing. Traces say everything." → `counter` 73 "% of failures are tool calls" → `wipe` "Here is the fix" → `endcard`.
