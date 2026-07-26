/**
 * Every tunable lives here so the debug panel and the final bake touch one place.
 */

// Eight times the ground area of the 220 world. One splat used to reveal the entire
// visible world in a single click, which is what made the planet feel already
// discovered before you had explored any of it.
export const WORLD_SIZE = 640;

export const terrain = {
  seed: 20260726,
  segments: 400,       // heightfield resolution across the whole world
  frequency: 0.0034,   // scaled down with the world, so landforms stay the same size
  amplitude: 26,
  ridgeAmplitude: 22,  // ridged octave, carves spines and valleys
  spawnFlat: 40,       // flattened radius around the origin so the moth spawns clear
};

export const flight = {
  driftSpeed: 17,      // faster than the small world's 9: this one is three times wider
  minSpeed: 6,
  maxSpeed: 46,
  trimRate: 16,        // how fast W/S change speed
  turnRate: 0.0016,    // radians per pixel of mouse movement
  maxPitch: 0.85,      // radians, keeps you from looping over the top
  smoothing: 3.2,      // higher is snappier; low values feel like heavy drifting
  groundClearance: 6,  // never fly closer than this to the terrain
  ceiling: 150,
  // Chase camera, in the moth's local frame.
  camBack: 8.5,
  camUp: 4.4,
  camLag: 4.0,
};

// Wet oil, not watercolour. A splat is stamped once on impact and never moves, so none
// of the capillary, advection and drying machinery exists any more.
export const paint = {
  resolution: 2048,    // texels across the world: 0.31 world units each
  radius: 7,           // splat radius in world units, before spikes and satellites
  satellites: 1.0,     // how far the flung droplets land from the main blob
  spikes: 1.0,         // length of the radial fingers
  edgeSoftness: 0.06,  // 0 is a razor edge; oil barely feathers at all
  tooth: 0.45,         // canvas weave breaking up the thinnest coverage

  // How the paint reads on the world.
  coverGamma: 0.72,    // <1 makes thin coverage show up sooner
  shadeFloor: 0.58,    // object shading multiplies the paint between this and this+range
  shadeRange: 0.72,
  chroma: 1.18,        // re-saturation, so overlaps stay vivid
};

export const droplet = {
  poolSize: 64,
  size: 0.9,
  gravity: 26,
  stretch: 0.05,       // how much speed elongates the falling blob
  throwSpeed: 4,       // forward push on release, on top of the moth's own velocity
};

export const post = {
  radius: 3,        // Kuwahara kernel radius in pixels; cost grows with the square
  grain: 0.07,      // canvas texture strength
  grainScale: 900,
  outline: 0.24,    // darkening along form boundaries
  vignette: 0.42,   // falls off to white, like the edge of the canvas
  fibre: 1.4,       // lower than the watercolour build: oil edges should stay crisp
};

// Spread over eight times the area. Counts are up, density per acre is down, which is
// what makes the planet feel large rather than packed.
export const density = {
  flowers: 34000,
  grass: 38000,
  trees: 3000,
  mushrooms: 6500,
  rocks: 1600,
  reeds: 5200,
  islands: 90,
  arches: 60,
  growths: 260,
  spires: 340,
};

export const collision = {
  playerRadius: 1.6,
  treeRadius: 0.55,
  rockRadius: 0.7,
};

export const audio = {
  src: 'audio/paulyudin-emotional-light-piano-159833.mp3',
  // Coverage drives the mix: sparse and muffled over blank ground, open over paint.
  gainDry: 0.15, gainWet: 0.85,
  cutoffDry: 400, cutoffWet: 18000,
  smoothing: 0.6, // seconds

  // Recalibrated against measured coverage in the final pass.
  coverageDry: 0.02,
  coverageWet: 0.55,
};
