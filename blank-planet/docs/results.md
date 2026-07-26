# Measured results

All numbers from `npm run measure`, real system Chrome, headed, hardware GPU, 1280×720.
Never headless: SwiftShader software rendering would make the frame times meaningless.

## v2 (moth flight, pigment simulation, alien planet)

| | v1 walking | v2 |
|---|---|---|
| Frame time p50, vsync on | 16.70 ms | 16.70 ms |
| Frame time p95, vsync on | 17.50 ms | **18.60 ms** |
| fps p50 / p95 | 59.9 / 57.1 | 59.9 / **53.8** |
| Draw calls | 17 | 34 |
| Scene objects | ~21,000 | ~44,000 |
| Ink resolution | 512² × 1 scalar, 8-bit | 1024² × 2 RGBA, half float |

p50 sits exactly on vsync, so it holds 60 fps most of the time. p95 of 18.6 ms means it
drops the occasional frame — call it 54 fps at the 95th percentile. Heavier than v1, as
expected from four times the ink resolution, two simulation passes and twice the objects.

**`--uncapped` no longer measures frame cost on this build.** It reports a p50 of 0.10 ms
and 10,000 fps, which is not real: the GPU work is now heavy enough that the JS loop runs
ahead of it, rAF returns before the frame is drawn, and the deltas measure JS time only.
The harness prints a warning when it detects this. Trust the capped run. A true GPU cost
would need `EXT_disjoint_timer_query`, which is not wired up.

## Gates

Every run asserts these, and they fail loudly rather than silently:

| Gate | Result |
|---|---|
| Blank paper is invisible | **100.00%** white pixels with no pigment down |
| A drop blooms | coverage 0 → 179 |
| **A stain is permanent** | 179 → 255 twelve seconds later, never drops |
| Blooms mix | magenta + cyan → rgb(178,49,237), a hue in neither |
| Moth never clips terrain | min clearance 6.0 units over 841 frames |
| Audio runs | 161 s buffer, context running, playing |
| Ink drives the mix | 400 Hz @0.15 blank → 18 kHz @0.85 in a fresh bloom |
| Console errors | 0 |

## v3 (300-unit cruise, alien environment)

| | before | after |
|---|---|---|
| Cruise altitude | 150 | 200 |
| Min ground clearance | 60 | 90 |
| Drift speed | 6 | 16 |
| Splat radius | 16 | 18 |
| Terrain height span, 256² grid | 71.5 units | **138.1 units** |
| Deepest bowl on the z=0 line | 6.2 below its rim | **18.5 below its rim** |
| Draw calls | 33 | 40 |
| fps p50 / p95, vsync on | 59.9 / 56.8 | **30.0 / 29.7** |

### Airborne paint, and where the frame rate went

Taking islands, grazers and spores off the world paint map put p50 back to **59.9 fps**
from 30.0, with the same object count and the same draw calls. That settles what the
fill-rate cost actually was: a `texture2D` fetch per fragment on large screen-covering
surfaces. Islands are the biggest of those, and they were sampling a 2048² map to find
out they were white.

Two gates now assert the behaviour, because "the page is white" would also be true if
those objects had simply stopped rendering:

| Gate | Result |
|---|---|
| No bleed | 0 airborne instances painted after 12 s of ground splatting |
| Hittable | a drop aimed at a radius-50 island painted 1 instance, 0 still falling |

`blank paper` reads 100.00% on repeat runs; one run in four or so returns 99.26% because
the harness's flight path leaves a droplet mid-air at the instant of capture.

Altitude went to 300 first and came back to 200. At 300 a radius-18 splat covered a few
pixels and painting read as speckle; the round trip is why the island and grazer altitude
bands are now written as fractions of `flight.spawnAltitude` rather than as the literal
numbers that suited a 300-unit cruise.

The frame rate halved with the altitude change and has not moved since. It is fill-bound,
not object-bound: cutting flowers, grass, reeds and mushrooms by 85% (72,700 instances
down to 9,700) left p50 at exactly 30.0 fps, so the counts were restored. Adding the six
lifeform layers on top also left it at 30.0. The cost is in fragments, so it lives in the
post pass or the render scale, and neither has been touched yet.

## v4 (contours, spatter, and the splat quad)

The premise changed here. "With no pigment down you cannot see the world at all" was true
and was the point, but at a 200-unit cruise over white ground it also meant you could not
tell you were moving or which way the moth was facing. The world is now drawn in grey
contour and still carries no colour until you paint it.

That could not come from the existing outline, which is a luminance gradient: every
surface is the same white, so it had nothing to find. The contour samples the depth
buffer instead (`EffectAttribute.DEPTH`, then a four-tap difference on view Z, divided by
distance so a line is the same weight near and far).

The gate had to be reformulated rather than deleted, since the old one now fails by
design:

| Gate | Result |
|---|---|
| No pigment | 0.00% of pixels carry colour with the ink wiped |
| Contours | 5.12% of pixels are line work |

Chroma, not brightness. Grey line work passes, a surviving splat does not.

### The splat quad

Turning the spatter on (`satellites` 0 → 0.5) cost p95 57.1 → 16.9 fps. Measured, not
guessed: contour alone cost 57.1 → 48.5, spatter alone 57.1 → 16.9.

The cause was not the spatter. `PaintMap` rendered a full-screen −1..1 quad for every
stamp, so the fragment shader ran over all 4.2 million texels of the map and discarded
the 99.9% that missed. That was survivable while the shape discarded at 2.6 radii; wider
spatter pushes the bound to 5.8 and the surviving area up with it. The quad is now sized
to the splat's own bounding box, which fixes the cost for every splat, spatter or not:

| | p95 |
|---|---|
| No contour, no spatter | 57.1 fps |
| Contour only | 48.5 fps |
| Spatter only, full-screen quad | 16.9 fps |
| Both, quad sized to the splat | **56.8 fps** |

### W and S

They were never broken. Measured on the real keyboard path: 16 → 30.2 holding W for two
seconds, → 9.1 holding S for three. What was missing was any way to perceive it, over a
world with no visible features and no readout. The contour supplies the first and the
hint line now carries the speed.

## Bugs that produced confident, wrong output

Each of these looked fine until something was measured or rendered side by side.

1. **8-bit targets quantised deposition to zero.** Each frame deposits ~0.0017 of
   coverage, which rounds to 0 in an `UnsignedByte` texture, so a bloom accumulated
   nothing at all. Fixed with `HalfFloatType`, which also required a half-precision
   decoder for the readback.
2. **Dry cells store black RGB, and the capillary spread averaged neighbour colour
   without weighting by water.** Every advancing front therefore mixed itself toward
   black, and painted hillsides turned to soot. Found by rendering with the post pass
   disabled, which ruled out the ink outline filter. Gathering is now alpha-weighted.
3. **Averaging complementary hues lands near black.** Violet over acid yellow made mud.
   The mix is rescaled to the brightness of its brighter parent, so overlaps stay
   electric while still landing on a genuinely mixed hue.
4. **`moth.flap()` wrote `root.position.y`,** clobbering the world position `flight.js`
   had just set. The moth sat at y=0 while the camera flew at y=36, and the screen was
   blank white.
5. **`mergeGeometries` refuses to mix indexed and non-indexed inputs.** Polyhedron
   primitives are non-indexed, Cone/Cylinder/Sphere/Torus are indexed. 2899 console
   errors, 2 draw calls.
6. **Sizing features by compounding random multipliers** on top of base geometry height
   gave 182-unit spires the moth flew straight through.
7. **`shadeFloor` was raised to 0.90** defensively while hillsides were black. That was
   the pigment bug, not shading, so forms were left flat for no reason. Back to 0.58.
8. **The persistence gate failed on a stain that grew.** It asserted "unchanged", but a
   slow bloom keeps depositing; permanence means coverage must never *decrease*.
9. **The camera far plane was a hardcoded 300, and the cruise altitude was raised to 300.**
   The entire planet was clipped out of the frustum. Every screenshot came back blank white
   and the blank-paper gate passed at 100.00%, because nothing was being drawn at all. This
   is gate lesson 5 again in a new costume: "the page is white" is only evidence of the
   premise if something is in frame to be invisible. The far plane is now derived from
   `WORLD_SIZE` and `flight.ceiling` so raising the ceiling cannot silently reintroduce it.
10. **The moth was built nose-toward +Z while `flight.js` travels along local -Z,** so it
   flew tail-first with its antennae trailing. Not visible in any gate. Only a screenshot
   of the moth on its own showed it, and the harness's shot always frames it from behind
   and too small to read.
11. **The world paint map has no height, and nothing but terrain was ever tested for
   impact.** One texture indexed by world XZ, so a splat on the ground coloured the whole
   column above it, and a drop aimed at a creature passed through. Both halves of the same
   omission, and neither showed up in any gate: everything was still white before you
   painted and coloured after, which is all the gates were asking.
12. **The entry screen rendered from the world origin.** `flight.update()` returns early
   until the player enters, so it never placed the camera, and the first thing you saw was
   the view from inside the ground. It went unnoticed while the world was small; at a
   300-unit spawn the two views have nothing in common.

## v1 bugs, kept for the record

1. Absolute `mouse.move` drops pointer lock, which re-showed the white overlay and
   reported "99.8% white while walking".
2. Per-frame draw sampling raced the app's rAF: 3 draw calls against an actual ~111.
3. Holding W in a straight line hits the world edge in 7.6 s and stares at empty space.
4. **Chrome revokes pointer lock within seconds under automation even with no input.**
   The player never moved, so the collision gate passed while sitting 5.5 units from the
   tree it was meant to hit. The harness drives `__blankPlanet.input` directly instead.
5. Playwright screenshots never resolve with `--disable-gpu-vsync`.

## Reproducing

```bash
npm run build
npm run measure                    # all gates, capped
npm run measure -- --shot out.png  # paints, climbs, then shoots
npm run measure -- --baseline      # the original single-file prototype

node scripts/inspect.mjs out.png 45   # paints a tight patch, parks the camera, looks at it
```

`inspect.mjs` exists because the measure harness cannot show the world any more. It always
frames the moth, and from 300 units up with the camera aimed at the moth the ground sits
off the bottom edge, so its screenshot is a moth on blank paper no matter what the planet
looks like. The second argument is the camera height above the patch: 45 to read a shape,
300 to see what a splat actually looks like from cruising altitude.
