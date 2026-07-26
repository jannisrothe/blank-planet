# Measured results

All numbers from `npm run measure`, real system Chrome, headed, hardware GPU, 1280×720,
walking a circle. Never headless: SwiftShader software rendering would make the frame
times meaningless.

## Before and after

| | Original prototype | Ink Garden |
|---|---|---|
| Frame time p50, vsync **off** | 2.10 ms | **2.40 ms** |
| Frame time p95, vsync off | 3.40 ms | 5.00 ms |
| Frame time p50, vsync on | 16.70 ms | 16.70 ms |
| Draw calls per frame | 111 | **17** |
| Scene objects | 560 | **~21,000** |
| Post-processing | none | Kuwahara + paper + outline |
| Per-frame CPU→GPU upload | ~4 MB canvas | none |
| Console errors | 1 (favicon) | 0 |

About 40× the objects and a full painterly pass, for 0.3 ms more per frame. Roughly 14%
of a 16.67 ms budget.

The capped rows are the reason `--uncapped` exists: both builds sit at a flat 60 fps, so
capped runs cannot distinguish them at all.

## Gates

Every run asserts these, and they fail loudly rather than silently:

| Gate | Result |
|---|---|
| Blank paper is invisible | **100.00%** white pixels with the ink wiped |
| Player cannot walk through a tree | approached 7.5 → 1.36 units, floor 1.36, stopped |
| Audio loads and runs | 161 s buffer, context running, playing |
| Ink moves the audio mix | 420 Hz @0.16 dry → 15.3 kHz @0.82 wet |
| Draw calls | 17 |
| Console errors | 0 |

## Constants that came from measurement

**Density.** The reveal bubble is π·9² ≈ 254 u² out of a 48,400 u² world. At the
prototype's density that bubble held ~2.6 flowers and ~0.3 trees, which in a white void
reads as an empty page. Current counts: 4,800 flowers, 14,000 grass, 400 trees, 1,600
reeds, 700 mushrooms, 300 rocks. Affordable only because everything is instanced.

**Audio mapping.** Wetness sits at **0.148** standing still (your own blot in
equilibrium) and peaks at **0.245** walking. The initial `wetness × 4` mapping saturated
at 0.25, so the mix was pinned wide open the entire time and the effect was inaudible.
`config.js` now maps the measured band 0.14 → 0.26 through a smoothstep.

**Wetness sampling region.** Reading a single texel under the player is useless: it
always returns ~1, because the player is at the centre of their own blot. A 64-texel
patch, about 3× the reveal radius, gives a signal that actually moves.

## Harness bugs found while establishing the baseline

Worth recording, because each one produced confident numbers that were wrong.

1. **Absolute `mouse.move` drops pointer lock.** The run reported "99.8% white while
   walking" — that was the entry overlay, which had reappeared when the lock broke.
2. **Per-frame draw sampling raced the app's own rAF**, reporting 3 draw calls against
   an actual ~111. Averaged over the window instead.
3. **Holding W in a straight line hits the world edge in 7.6 s** at 14 u/s and then
   stares at empty space, halving the apparent draw count. The walk now circles.
4. **Chrome revokes pointer lock within seconds under automation even with no input.**
   This is the important one: the player never moved, so the collision gate passed while
   sitting 5.5 units from the tree it was meant to hit. The harness now drives input
   directly, and reports INCONCLUSIVE rather than PASS if the player never closed on the
   trunk.
5. **Playwright screenshots never resolve with `--disable-gpu-vsync`**, because they
   wait for a stable compositor frame that never comes. Perf runs skip pixel checks.

## Reproducing

```bash
npm run build
npm run measure                       # gates, capped
npm run measure -- --uncapped         # true frame cost
npm run measure -- --baseline --uncapped
```
