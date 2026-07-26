# Ink Garden

A blank sheet of paper with an alien planet hidden in it. You drift over it as a moth and
click to drop pigment; each drop blooms outward with real capillary bleed, dries, and
stays. What you paint is permanent, so a session accumulates into something you made.

Static site, no backend.

```bash
npm install
npm run dev            # http://localhost:5173
npm run dev -- --open
npm run build          # -> dist/, deploy anywhere static
```

## Tuning it yourself

```
http://localhost:5173/?debug
```

Sliders for reveal radius, dry time, bleed, the pigment ramps, the Kuwahara radius,
paper grain, and the audio mix, plus an FPS meter and a live wetness readout. Density
sliders reload the page with the new counts in the query string, because the instanced
meshes are built once at startup.

Everything you settle on lives in `src/config.js`, in the same names the sliders use.

The debug panel is a dynamic import behind `?debug`, so lil-gui and stats.js are code
split into a separate chunk and never reach a normal visitor.

## Measuring

```bash
npm run build
npm run measure                  # gates: collision, audio, blank paper, draw calls
npm run measure -- --uncapped    # true frame cost with vsync off
npm run measure -- --baseline    # the original prototype, for comparison
npm run measure -- --shot out.png
```

The harness drives real system Chrome, headed, on the actual GPU. Headless Chrome
renders WebGL through SwiftShader in software, so its numbers would be meaningless.

Two things worth knowing if you extend it:

- **Capped runs tell you almost nothing.** They pin to 16.67 ms whatever you do. Use
  `--uncapped` for anything about headroom.
- **It does not use pointer lock.** Chrome revokes the lock within seconds under
  automation even with zero input, which silently made every gate pass while the player
  stood still. The harness drives `__inkGarden.input` directly instead.

## How the reveal works

One 512×512 render target holds a top-down mask of where ink currently sits
(`src/ink/inkMap.js`). Each frame a single fragment pass blurs the previous state
(diffusion, so the blot creeps outward as it dries), multiplies it by an exponential
decay, and maxes in a fresh blot under the player whose edge is warped by noise.

Every material is then patched through `onBeforeCompile` (`src/ink/inkMaterial.js`) to
sample that mask by world XZ and mix its fragment toward paper white. At ink 0 a
fragment is pure white, so the world is genuinely invisible rather than muted gray, and
because it is per fragment the blot boundary can cut straight through a tree trunk.

Colour arrives in two stages: the shape first emerges as a desaturated wash, then
pigment floods in behind it. A wet edge carries extra pigment and sits darker at the
boundary, the way a real wash dries.

`src/post/WatercolorEffect.js` adds the painterly layer on top: a four-quadrant
Kuwahara filter, an ink outline from the luminance gradient, screen-locked paper grain,
and a vignette that falls off to white.

## Layout

```
src/
  config.js        every tunable, in one place
  world.js         renderer, scene, camera, lights
  terrain.js       heightfield + ground; the only heightAt()
  scatter.js       seeded placement on a jittered grid
  palette.js       watercolour hue families
  collision.js     spatial hash + circle push-out
  audio.js         ambient bed, mixed by the ink
  debug.js         lil-gui + stats, loaded only with ?debug
  flight.js        constant-drift flight, chase camera
  ink/             pigmentSim.js, inkMaterial.js
  post/            composer.js, WatercolorEffect.js
  props/           flowers, grass, trees, smallProps, cards, moth, features
```

Controls: mouse steers, **click drops pigment**, W and S change speed, M mutes, esc to
leave. You always drift forward; there is no stall and no way to get stuck.
