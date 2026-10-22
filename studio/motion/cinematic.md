# Cinematic (cinetic-inspired)
> Camera-driven product film: rack focus, hinge entries, zoom-through titles, beat-grid timing. Best for launches.

Full method: `studio://vendor/cinetic/SKILL.md` and its references (camera, transitions, motion-tokens, taste-and-slop).

## Rules
- One paused GSAP timeline per composition, timed on a beat grid (for example 120 BPM, 0.5 s beats). Moves start and settle on beats.
- Eases: `power3.out` for arrivals, `power2.inOut` for camera moves, `expo.out` for snaps. No linear except for scrolls.
- Camera moves are on a wrapper (`.cam`) with `perspective: 1600px`; content stays flat inside.

## Moves we used (and where)
| Move | Recipe |
|---|---|
| Zoom-through title | Title scales 1 -> 14 over 0.4 s with `power3.in`, opacity holds until the last 20%, next screen is already underneath at scale 1.08 -> 1. |
| Rack focus | Outgoing layer `filter: blur(0 -> 14px)` and scale 1 -> 0.96 while the incoming layer goes blur 14 -> 0, 0.75 s. |
| Hinge entry | Dialog enters `rotationX: -70` (tabletop) or `rotationY: 55` (yaw) from `transformOrigin` at an edge, `power3.out`, 0.6 s. |
| Focus pull on a screenshot | Scale the screenshot to 1.6 to 2.2 around the feature (`transformOrigin` at the feature), 1.2 s `power2.inOut`. |
| Shutter collapse | Frame collapses to a 6 px accent line (scaleY 1 -> 0.004) then the line becomes the loader. |

## Bans
Glitch, RGB split, light leaks, neon, crossfade as the default seam, random shakes.
