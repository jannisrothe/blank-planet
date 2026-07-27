# A planet you can fly around — design

2026-07-27. Approved in conversation before implementation.

## Why

The world is a 640×640 plane with a hard clamp six units inside its edge. You cannot
circumnavigate it because there is nothing to circumnavigate: fly far enough and you stop
against an invisible wall. It is also lit and framed as a sheet of paper, which is at odds
with calling it a planet.

Two changes, in two stages: make it an actual ball, then put it in space.

## Decisions

From explicit answers:

- **Radius 180.** That is exactly the surface area of the 640×640 plane, so nothing about
  prop density or feature scale has to be re-derived. The curvature is strongly visible at
  this size, which is the point.
- **Real black space**, not stars drawn on paper. The planet surface stays white, so the
  grey contour work still reads against it; only the sky goes black.
- **Sphere first, stars second.** Separate commits.

## 1. The geometric change

`heightAt(x, z)` becomes `radiusAt(dir)`: given a unit direction, return the distance from
the planet centre to the surface. Every existing octave carries over — three fbm octaves,
the ridged spine term, the basin swell, the flattened ranges — sampled with 3D simplex
noise on the unit sphere instead of 2D noise on a plane. Craters become a cone around a
direction rather than a circle around a point, with the same cosine-ramped profile.

Nothing else in the terrain design changes. The amplitudes and the crater table keep their
current values; only the domain does.

Consequences, each forced by that one signature:

| | now | after |
|---|---|---|
| Ground mesh | 400² plane displaced in Y | icosphere displaced along its own normal |
| Up | always `+Y` | `normalize(pos)` |
| Altitude | `pos.y - heightAt(x,z)` | `pos.length() - radiusAt(dir)` |
| World bounds | clamp to `WORLD_SIZE/2 - 6` | none; wrapping is the feature |
| Droplet gravity | `-Y` | toward the centre |
| Scatter | jittered grid | Fibonacci sphere |
| Collision | XZ spatial hash | angular distance, linear scan |

**Prop placement is the widest change but the shallowest.** Every prop file already goes
through `scatter()` and then composes a matrix from a position, an Euler and a scale. So
`scatter()` returns a per-spot quaternion that aligns local `+Y` to the surface normal, and
each prop file multiplies its existing random Euler onto that instead of using it alone.
Their randomisation is untouched; it is just re-based onto the surface.

## 2. Paint

The map stays a single equirectangular 2048² RGBA texture, sampled by direction rather
than by XZ.

Pole distortion does not arise, because the splat shader works in **angular** terms: each
texel reconstructs its own direction and measures the angle to the splat centre. A splat is
therefore round at the pole and at the equator alike, which a 2D distance in equirect space
would not be.

Two details this forces:

- A splat overlapping the ±180° meridian is drawn a second time, offset by one texture
  width, so it does not get cut in half at the seam.
- The bounding-box quad from the last round still applies, but longitude has to widen by
  `1 / cos(latitude)` and clamp to the full width near the poles.

## 3. Scale

| | value |
|---|---|
| Planet radius | 180 |
| Cruise altitude | 50 (from 200 — at 200 the whole planet is on screen) |
| Ground clearance | 25 |
| Ceiling | 260 above the surface |
| Lap time | ~70 s at speed 20.5 |

## 4. Black sky (stage two)

Sky and clear colour go black. The planet surface is unchanged, so contours still read.

Two things break and get fixed rather than removed:

- The vignette falls off to **white**, which would ring the frame in white against space.
  It falls off to black instead.
- The `contours` gate counts non-white pixels, which a black sky passes for free. It counts
  **mid-tones** instead — neither near-black sky nor near-white planet — so it still fails
  if the line work stops rendering.

The `no pigment` gate needs no change: it measures chroma, and both black and white have
none.

## What is deliberately not being done

- **No level of detail on the ground mesh.** An icosphere at detail 7 is 327k triangles,
  comparable to the 320k the plane already carries. If it costs too much the fix is a lower
  detail level, not an LOD system.
- **No atmosphere, terminator or day/night.** The lighting stays flat and shadowless.

## How it gets verified

The existing gates carry over with two edits: `clearance` measures radial altitude, and
`contours` counts mid-tones. Two new ones:

- **Circumnavigation** — fly a fixed heading and confirm the position returns to within a
  few units of where it started, which is the whole point of the change and is not
  something a screenshot can show.
- **Round splats at the pole** — stamp at the pole and at the equator and confirm the
  painted area is within a few percent of the same, which is what proves the angular splat
  works.
