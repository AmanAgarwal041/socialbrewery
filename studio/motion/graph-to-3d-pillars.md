# Graph to 3D pillars transition
> A real chart from a screenshot zooms in, its bars lift off into 3D pillars, the camera orbits, and the pillars become the next scene.

Template: `templates/scene-pillars.html`.

1. Zoom into the real chart in the screenshot (focus pull, 0.8 s).
2. Overlay flat divs exactly over the screenshot bars. Heights = the measured pixel heights of the real bars. Never invent values.
3. Lift: each bar becomes a CSS 3D box (front, side and top faces, `transform-style: preserve-3d`), `rotationX: 55, rotationZ: -35` on the stage over 0.9 s.
4. Stagger rise 0.06 s per pillar, `back.out(1.4)`.
5. Orbit 15 to 25 degrees, then pillars drop (scaleY -> 0) or fly into the next scene's layout.
6. Show a small "STYLIZED TRANSITION" label if no exact numbers are shown.
