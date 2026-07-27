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
| fps p50 / p95, vsync on | 59.9 / 56.8 | *30.0 / 29.7, void — see below* |

### Airborne paint, and where the frame rate went

This was reported as putting p50 back to 59.9 fps from 30.0 and as identifying the
fill-rate cost. **That is withdrawn.** The 30.0 baseline was a 30Hz display cap, not the
renderer. The two numbers were taken hours apart and are not comparable. Re-measured
later on the same machine at the same moment, the build before this change and the build
after it both read 30.0 fps, because the display was capped again.

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

**Every reading of exactly 30.0 fps in this section is void.** They were taken while the
display was running at 30Hz, which caps the harness whatever the code does. The
conclusions drawn from them -- that the renderer was fill-bound, that cutting 72,700
instances changed nothing, that the altitude change halved the frame rate -- are
withdrawn. Nothing could have changed anything inside that cap. See below.

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
guessed: contour alone cost 57.1 → 48.5, spatter alone 57.1 → 16.9. These four runs were
back to back in one session with the display at 60Hz, so unlike the numbers above they
are comparable to each other.

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

## v5 (mountains instead of floating things)

Everything airborne is gone: floating islands, sky grazers, spore floaters. The height
they carried is in the terrain now, as a ridged octave raised to a power, which is what
makes it a few tall ranges rather than a world of uniform lumps.

The ranges first ran at ten times this height and were cut back: blades at 375 units and
a 66.8 degree mean slope, against hills now.

| | before | first pass | now |
|---|---|---|---|
| Highest ground | 67 units | 375 units | **91 units** |
| Height span, 256² grid | 138 | 446 | **162 units** |
| Mean slope | — | 66.8° | **32.1°** |
| Flight ceiling | 420, hand-picked | 545, derived | 420, derived |
| Draw calls | 40 | 36 | 36 |

The rolling elevation is not the ranges: it comes from the basin and fbm octaves, so
flattening the mountains left the world undulating rather than flat.

Two things fell out of it:

- **The ceiling was applied after the ground clearance,** so over a peak taller than
  `ceiling - groundClearance` the ceiling won and held the moth inside the mountain. The
  clamps are now in the other order, and the ceiling is derived from a measured
  `terrainMax` rather than picked by hand, so raising the mountains cannot reintroduce it.
- **Silhouette alone leaves a mountain as a blank white mass** with an outline drawn round
  it, because no point on a smooth flank is an edge. The contour now also takes the second
  difference of the same four depth taps, which finds the ridgelines and gullies inside
  the shape. It reuses the taps, so it costs nothing.
- **The `contours` gate was measuring framing luck.** It read whatever the camera happened
  to be pointing at when the walk ended, which after the beauty-shot climb is usually the
  sky. Flattening the mountains dropped the horizon out of frame and the reading fell from
  7% to 0.26% with nothing actually wrong. The gate now aims at the ground first and comes
  back at 20.7% twice running.

Removing every airborne thing left `hittables.js` and the per-instance ink path with
nothing to act on, so both are gone. They are in history at `86e0a3f` if birds ever
come back.

### The 30 fps that was never real

A session's worth of frame numbers turned out to be measuring the display, not the build.

The tell was that nothing moved them. Render scale 2 → 1.5 → 1: 30.0 fps. Kuwahara radius
2 → 1 → 0: 30.0 fps. Then, in-page: post pass disabled, ground hidden, every instanced
mesh hidden — 33.3 ms a frame, all of it. A blank `<body>` with no WebGL at all ran at
30.0 fps in the same browser.

The display was at 30Hz. `devicePixelRatio` was also 1 in that harness, so the render
scale sweep was comparing 1 against 1 three times.

`measure.mjs` now probes rAF on a blank page before it loads anything and prints the
cadence, and flags the whole run when it comes back under 50 fps:

```
  cadence  blank page runs at 30.0 fps  ** THROTTLED: frame numbers below are meaningless **
  fps      p50 30.0 fps   p95 29.5 fps  ** capped by a 30Hz display, not by the code **
```

The lesson is the same one as gate 5, one level up: a number that cannot move is not a
measurement, and "it did not change" is only evidence if something *could* have changed.

## v6 (a planet you can fly around)

The 640x640 plane clamped six units inside its own edge, so there was nothing to
circumnavigate. `heightAt(x, z)` became `radiusAt(dir)` and everything followed from
that: the ground is an icosphere displaced along its own normals, up is `normalize(pos)`,
gravity points at the centre, props are placed on a Fibonacci spiral and stood upright by
a per-spot quaternion, and the world-bounds clamp is gone.

| | plane | sphere |
|---|---|---|
| Extent | 640 x 640, hard edge | radius 180, no edge |
| Surface area | 409,600 | 407,150 (the radius was chosen for this) |
| Cruise altitude | 200 | 50 |
| Ground mesh | 400² plane, 320k tris | icosphere detail 7, 328k tris |
| fps p50 / p95 | 59.9 / 56.8 | **59.9 / 56.5** |

Two new gates, because neither is something a screenshot can show:

| Gate | Result |
|---|---|
| Lap | held a heading and came back within **1 unit** after 84 s |
| Polar splat | pole/equator painted area **0.976** |

### Splats do not distort at the poles

The map is still one equirectangular 2048² texture, which would normally smear a splat
into a band as it approached a pole. It does not, because the splat shader measures the
**angle** between each texel's own direction and the splat centre rather than a distance
in texture space. The polar gate is what holds that: it stamps at the pole and at the
equator and compares the painted area, weighting each row by cos(latitude) since equirect
rows near a pole cover far less surface.

Two details fall out: a splat overlapping the ±180° meridian is drawn a second time offset
by one texture width, and the bounding-box quad has to widen in longitude by 1/cos(lat).

### The stall was a buffer usage hint

p95 came in at 9.3 fps against a 59.9 fps display. The first A/B blamed the post pass, and
was wrong: it toggled `uContour` at runtime, which skips the shader branch but leaves the
depth-texture machinery in place, so it could not separate the two. Removing the depth
attribute at build time moved p95 from 72 ms to 52.7 ms -- real, but not the cause.

It was `InstancedMesh.instanceMatrix` on the two animated lifeform layers. They are
rewritten every frame and the buffer was still marked `StaticDrawUsage`, so the driver
orphaned and reallocated its storage each time. That is invisible in a p50 and shows up as
an occasional 200 ms frame. One `setUsage(DynamicDrawUsage)` took p95 from 72 ms to
17.7 ms.

The intermediate readings that pointed at the post pass were also partly GC noise from a
load that allocated four objects per scatter point across ninety thousand points; `scatter`
now returns a direction, a quaternion and a radius, and derives the world position rather
than storing it.

### Space

A sky sphere seen from the inside, not a cube map: the whole background is generated, so
one 2:1 canvas beats six faces that have to agree at their seams. It sits outside the
flight ceiling, renders first and writes no depth, so nothing can clip it. Stars are drawn
into the canvas rather than instanced, which is one texture and one draw call instead of
nine thousand quads.

Two things had to move with it:

- **The vignette fell off to white**, which was the edge of a sheet of paper. Against space
  it ringed the frame in white. It falls off to the sky colour now.
- **The `contours` gate counted non-white pixels**, which a black sky passes for free. It
  counts mid-tones instead: darker than the white planet, lighter than space. `no pigment`
  needed no change, because it measures chroma and neither black nor white has any.

Drawing the dust as a few large radial gradients put a hard-edged wedge across the sky —
a gradient spanning a good fraction of an equirectangular texture maps onto a sphere as a
cone. Seventy small patches instead.

The lap gate flaked once here, reporting its closest approach at the start of the window.
The ground-clearance rule pitches up whenever the moth clips the floor and nothing pulls
it back down, so a long flight spirals outward into a wider, slower orbit that never
closes. The gate now starts above the highest ground and holds the pitch itself flat, not
just the target: whether the world wraps is a separate question from terrain avoidance.
Two consecutive runs, 1 unit both times.

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
11. **A frame-rate number that could not move was read as a measurement.** Runs reporting
   exactly 30.0 fps were the display at 30Hz, not the renderer. Every conclusion drawn
   from them was wrong, including a confident "it is fill-bound, not object-bound" backed
   by an A/B that cut 72,700 instances and changed nothing — because nothing inside a hard
   cap can change anything. The harness now measures what a blank page can do before it
   measures the build.
12. **The world paint map has no height, and nothing but terrain was ever tested for
   impact.** One texture indexed by world XZ, so a splat on the ground coloured the whole
   column above it, and a drop aimed at a creature passed through. Both halves of the same
   omission, and neither showed up in any gate: everything was still white before you
   painted and coloured after, which is all the gates were asking.
13. **An A/B that could not distinguish its two arms.** Runtime `uContour = 0` was used to
   measure "the contour off", but the depth buffer is attached by an effect *attribute*
   set at construction, so both arms paid for it and the results came back contradictory
   -- contour-off measuring slower than contour-on. Contradictory ordering is the tell
   that an A/B is measuring noise, not the thing named in the label.
14. **The entry screen rendered from the world origin.** `flight.update()` returns early
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
