/**
 * Every tunable lives here so the debug panel and the final bake touch one place.
 */

export const WORLD_SIZE = 220;      // world spans WORLD_SIZE x WORLD_SIZE units

export const terrain = {
  seed: 20260726,
  segments: 220,       // heightfield resolution; ridges need more than v1's 160
  frequency: 0.008,
  amplitude: 16,       // v1 was 0.6, which is why it read as flat
  ridgeAmplitude: 14,  // ridged octave, carves spines and valleys
  spawnFlat: 26,       // flattened radius around the origin so the moth spawns clear
};

export const flight = {
  driftSpeed: 9,       // constant forward drift, world units per second
  minSpeed: 3,
  maxSpeed: 22,
  trimRate: 9,         // how fast W/S change speed
  turnRate: 0.0016,    // radians per pixel of mouse movement
  maxPitch: 0.85,      // radians, keeps you from looping over the top
  smoothing: 3.2,      // higher is snappier; low values feel like heavy drifting
  groundClearance: 6,  // never fly closer than this to the terrain
  ceiling: 95,
  // Chase camera, in the moth's local frame.
  camBack: 8.5,
  camUp: 4.4,
  camLag: 4.0,
};

export const ink = {
  resolution: 1024,    // texels across the world; tendrils need the detail
  dropRadius: 20,      // a drop from altitude covers a lot of ground
  dropWater: 1.0,
  drySeconds: 10,      // how long a bloom stays wet and creeping
  capillary: 0.985,    // how readily water advances into dry paper; <1 or it never stops
  advection: 1.6,      // how hard pigment is dragged along the flow
  granulation: 0.22,   // paper tooth modulating where pigment settles
  edgeDarkening: 0.9,  // extra deposition where the water gradient is steep
  paperScale: 190,     // frequency of the granulation and capacity noise

  // How the wash reads on the world.
  coverGamma: 0.78,    // <1 makes thin coverage show up sooner
  shadeFloor: 0.90,    // object shading multiplies pigment between this and this+range
  shadeRange: 0.28,    // keep this small or shaded slopes crush the pigment to black
  chroma: 1.35,        // re-saturation, or overlapping drops average into mud
};

export const post = {
  radius: 3,        // Kuwahara kernel radius in pixels; cost grows with the square
  grain: 0.09,      // paper texture strength
  grainScale: 900,
  outline: 0.28,    // ink gathering along form boundaries
  vignette: 0.5,    // falls off to white, like the edge of a wet sheet
  fibre: 2.2,       // how far pigment wanders along the paper grain
};

// Baked from the debug panel on 2026-07-26. Reeds were scrolled off screen, so they are
// scaled by the same factor as the others.
export const density = {
  flowers: 17800,
  grass: 18500,
  trees: 1000,
  mushrooms: 3300,
  rocks: 600,
  reeds: 2600,
  islands: 40,
  arches: 26,
  growths: 190,
  spires: 260,
};

export const collision = {
  playerRadius: 1.6,
  treeRadius: 0.55,
  rockRadius: 0.7,
};

export const audio = {
  src: 'audio/paulyudin-emotional-light-piano-159833.mp3',
  // The ink drives the mix: muffled and distant on blank paper, open inside a bloom.
  gainDry: 0.15, gainWet: 0.85,
  cutoffDry: 400, cutoffWet: 18000,
  smoothing: 0.6, // seconds

  // Recalibrated in step 6 once the drop mechanic changes what wetness looks like.
  wetnessDry: 0.02,
  wetnessWet: 0.45,
};
