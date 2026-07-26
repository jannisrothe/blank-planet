# Alien environment — design

2026-07-26. Approved in conversation before implementation.

## Why

The moth now cruises at 300 units instead of 150. At that height the world stopped
holding up. Gentle multi-octave hills flatten into an even texture, floating islands sit
at +52 to +98 and read as ground clutter you pass over, and the 34,000 flowers and 38,000
grass blades are sub-pixel. Nothing in the world is scaled for the new viewpoint.

The ask: bigger landforms, bigger sky structures, ground shapes worth revealing, and
alien lifeforms of varied sizes and compositions.

## Rules this has to obey

1. **Everything is white until painted.** The ink material samples the paint map by world
   XZ. Lifeforms follow the rule, so a creature is a faint white silhouette until you land
   pigment on it. The moth stays the one exception.
2. **A consequence, taken deliberately:** the paint map is indexed by XZ, not by object.
   A creature that moves therefore picks up the colour of whatever ground it drifts over,
   and loses it again on the other side. Kept, not worked around.
3. **The frame budget is fill-rate, not object count.** Measured: cutting flowers, grass,
   reeds and mushrooms by 85% moved p50 fps not at all (30.0 both ways). So instance
   counts are cheap here and large screen-filling translucent surfaces are not.
4. **No new colliders.** Everything rooted tops out around 70 units, far under the 130-unit
   minimum clearance. Things that live at altitude avoid the cruise band by placement
   instead (see below), which is cheaper than collision and cannot trap the moth.

## 1. Landforms

`terrain.js`, still a single `heightAt()`.

- **Basin octave.** One extra simplex sample at roughly a quarter of the base frequency
  and twice the amplitude. Produces wide bowls and plateaus, features measured in hundreds
  of units rather than tens, which is what reads from 300 up.
- **Craters.** A fixed handful generated from the terrain seed. Each subtracts a smooth
  bowl with a raised rim: depth falls off as a squared cosine so the floor is flat and the
  wall is smooth, with no crease at the lip. Craters are rejected if they overlap the
  spawn-flat radius.

Both feed the same `heightAt()`, so the ground mesh, prop scatter, flight clamp and drop
impact all follow automatically.

## 2. Sky structures

`features.js`.

- **Islands scaled up** from 5-16 units to 12-46, and placed in **two altitude bands**:
  low (+60 to +200) and high (+400 to +520). The gap is deliberate. The moth cruises near
  300 and islands have no collision, so leaving 250-350 empty means you fly under one
  layer and beneath another without ever passing through geometry.
- **Tendrils.** Tapered strands hanging off the island keel, merged into the same
  instanced geometry, so the whole layer stays one draw call.
- **Arches scaled up** from 8-28 units to 14-60, wide enough that some are worth aiming at.

## 3. Lifeforms

New `src/props/lifeforms.js`. Six forms, chosen to differ in composition rather than being
variants of one shape.

| Form | Size | Composition | Behaviour |
|---|---|---|---|
| Anemone stalks | 8-25 | vegetal, clustered | rooted, slow sway |
| Breathing sacs | 15-45 | fleshy, half-buried | rooted, slow inflate |
| Spiral shells | 20-50 | shelled, coiled tube | rooted, still |
| Rib arcs | 30-70 | skeletal, in rows | rooted, still |
| Sky grazers | 25-60 | soft, translucent | drift on slow paths at altitude |
| Spore floaters | 2-6 | light, scattered | bob through the air column |

All instanced and ink-washed. Animated forms rewrite their instance matrices per frame:
around 400 sacs and anemones plus 18 grazers and 260 spores, which is a 40KB buffer upload
and no extra fill cost, so it is safe against the measured bottleneck.

Grazers sit in the same two-band placement as islands, avoiding 270-340, and are slightly
translucent so drifting through one reads as intended rather than as a clipping bug.

## Explicitly not doing

- **Cutting the micro-scatter.** Proposed, then measured, then dropped: it buys nothing.
  The 30 fps at the new altitude is fill-bound and its fix lives in the post pass or the
  render scale, not in instance counts. Separate problem, separate change.

## How it gets verified

`npm run build && npm run measure -- --shot docs/shot.png`, then look at the screenshot.
The existing gates must stay green, in particular blank-paper (the new geometry must be
invisible until painted) and clearance (the moth must not clip anything new).
