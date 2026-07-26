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

## v1 bugs, kept for the record

1. Absolute `mouse.move` drops pointer lock, which re-showed the white overlay and
   reported "99.8% white while walking".
2. Per-frame draw sampling raced the app's rAF: 3 draw calls against an actual ~111.
3. Holding W in a straight line hits the world edge in 7.6 s and stares at empty space.
4. **Chrome revokes pointer lock within seconds under automation even with no input.**
   The player never moved, so the collision gate passed while sitting 5.5 units from the
   tree it was meant to hit. The harness drives `__inkGarden.input` directly instead.
5. Playwright screenshots never resolve with `--disable-gpu-vsync`.

## Reproducing

```bash
npm run build
npm run measure                    # all gates, capped
npm run measure -- --shot out.png  # paints, climbs, then shoots
npm run measure -- --baseline      # the original single-file prototype
```
