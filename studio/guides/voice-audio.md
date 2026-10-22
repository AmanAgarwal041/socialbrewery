# Voice and audio pipeline

## Voiceover
1. Write the script scene by scene (one line per scene, 8 to 14 words per line on Shorts).
2. Generate with ElevenLabs (`generate_voiceover`). Defaults that worked:
   model `eleven_multilingual_v2`, stability 0.45, similarity 0.8, style 0.2. The brand kit can set `voice.elevenlabsVoiceId`
   (OpenLIT: `4IRPuRJvf53MmuBPNKJI`, a confident narrator).
3. Speed up with ffmpeg `atempo=1.25` (`speed: 1.25`). Faster narration retains Shorts viewers better; above 1.3 it sounds rushed.
4. If ElevenLabs credits run out, fall back to Kokoro (local, voice `am_michael`) for the remaining lines, and keep one voice per video when possible.
   Mixing is acceptable only when the user approves it.

## Timing
- Build the timeline from the measured audio length of each line, not the other way round.
- Leave 0.15 to 0.3 s of air between lines. Land visual hits on the first stressed word.

## Music and SFX
- Optional low bed under the voice, ducked about 12 dB. Short whooshes on transitions, a soft click on button presses.
- Only use music and SFX you have rights to.

## Master
- Loudness `-14 LUFS` integrated, true peak `-1 dBTP`:
  `ffmpeg -i in.mp4 -af loudnorm=I=-14:TP=-1:LRA=11 -c:v copy -c:a aac -b:a 192k out.mp4`
- Check with `ffmpeg -i out.mp4 -af ebur128 -f null -`.
