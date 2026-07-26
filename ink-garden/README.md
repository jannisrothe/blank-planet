# Ink Garden

A blank canvas with an alien planet hidden in it. You drift over it as a moth and throw
blobs of wet oil paint; each one falls, hits the ground, and bursts into a hard-edged
splat with spikes and spatter. Paint covers whatever was under it and never dries away,
so a session accumulates into something you made.

Static site, no backend.

```bash
npm install
npm run dev            # http://localhost:5173
npm run dev -- --open
npm run build          # -> dist/, deploy anywhere static
```

Controls: mouse steers, **click throws paint**, W and S change speed, M mutes, esc to
leave. You always drift forward; there is no stall and no way to get stuck.

## Tuning it yourself

```
http://localhost:5173/?debug
```

Sliders for splat size, spike length, spatter spread, edge softness, canvas tooth, the
Kuwahara radius and the audio mix, plus an FPS meter and live coverage and splat counts.
Density sliders reload the page with the new counts in the query string, because the
instanced meshes are built once at startup.

Everything you settle on lives in `src/config.js`, in the same names the sliders use.

The debug panel is a dynamic import behind `?debug`, so lil-gui and stats.js are code
split into a separate chunk and never reach a normal visitor.

## Measuring

```bash
npm run build
npm run measure                    # all gates
npm run measure -- --shot out.png  # paints, climbs, then shoots
npm run measure -- --baseline      # the original single-file prototype
```

The harness drives real system Chrome, headed, on the actual GPU. Headless Chrome
renders WebGL through SwiftShader in software, so its numbers would be meaningless.

Three things worth knowing if you extend it:

- **It does not use pointer lock.** Chrome revokes the lock within seconds under
  automation even with zero input, which silently made every gate pass while the player
  stood still. The harness drives `__inkGarden.input` directly instead.
- **`--uncapped` no longer measures frame cost.** The GPU work is heavy enough that the
  JS loop runs ahead of it, so rAF deltas become JS time and it reports 10,000 fps. The
  harness warns when it detects this. Trust the capped run.
- **Gates must assert behaviour, not absence of crashes.** Several bugs here passed a
  green run before the gate was sharpened. See `docs/results.md`.

## How the paint works

`src/ink/paintMap.js` holds a single 2048×2048 RGBA texture covering the whole world,
0.31 world units per texel. There is no per-frame simulation: oil does not flow, so a
splat is stamped once on impact with ordinary alpha blending and never moves again. That
is cheaper than the watercolour fluid sim it replaced, which is what pays for a world
eight times larger.

A click releases a droplet from the moth (`src/props/droplets.js`) carrying the moth's
own velocity. It falls under gravity, visible the whole way down, and only stamps when it
lands. The splat shape is a distance field: an irregular core, nine radial fingers and
fourteen satellite droplets, all biased downrange of the impact direction so the spatter
reads as a hit. Edges are near-step, because oil does not feather.

Blending is source-over with **explicit** `blendSrcAlpha` / `blendDstAlpha`, so fresh
paint covers what was underneath rather than averaging with it. Cyan over magenta reads
as cyan. Leave those factors at their defaults and the target's own alpha never
accumulates, so coverage silently stays at zero.

Every material is patched through `onBeforeCompile` (`src/ink/inkMaterial.js`) to sample
that map by world XZ. Where there is no paint the fragment is pure white, so the planet
is genuinely invisible until you hit it. Where there is, the object's own shading
*modulates* the paint rather than tinting it, so a growth still reads as a growth.

`src/post/WatercolorEffect.js` adds the painterly layer: a four-quadrant Kuwahara
filter, an outline from the luminance gradient, screen-locked canvas grain, and a
vignette that falls off to white.

## Layout

```
src/
  config.js        every tunable, in one place
  world.js         renderer, scene, camera, lights
  terrain.js       heightfield + ground; the only heightAt()
  scatter.js       seeded placement on a jittered grid
  palette.js       object hue families + the thrown-paint palette
  flight.js        constant-drift flight, chase camera
  collision.js     spatial hash + circle push-out, height aware
  audio.js         ambient bed, mixed by how much ground you have painted
  debug.js         lil-gui + stats, loaded only with ?debug
  ink/             paintMap.js, inkMaterial.js
  post/            composer.js, WatercolorEffect.js
  props/           flowers, grass, trees, smallProps, cards, moth, features, droplets
```
