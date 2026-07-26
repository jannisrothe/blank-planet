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
  driftSpeed: 6,        // a slow drift; you are surveying, not commuting
  minSpeed: 2,
  maxSpeed: 18,
  trimRate: 7,          // how fast W/S change speed
  turnRate: 0.0016,     // radians per pixel of mouse movement
  maxPitch: 0.85,       // radians, keeps you from looping over the top
  smoothing: 2.4,       // higher is snappier; low values feel like heavy drifting
  spawnAltitude: 150,   // high above the planet, not skimming it
  groundClearance: 60,  // never descend closer than this to the terrain
  ceiling: 320,
  // Chase camera, in the moth's local frame.
  camBack: 9.5,
  camUp: 4.6,
  camLag: 4.0,
};

// Wet oil, not watercolour. A splat is stamped once on impact and never moves, so none
// of the capillary, advection and drying machinery exists any more.
export const paint = {
  resolution: 2048,    // texels across the world: 0.31 world units each
  radius: 16,          // splat radius in world units; larger, since you fly much higher
  satellites: 0.0,     // spatter droplets, off: the splats should read round and clean
  spikes: 0.0,         // radial fingers, off for the same reason
  wobble: 0.16,        // gentle out-of-round, so a splat is organic but never jagged
  edgeSoftness: 0.035, // crisp but smooth; not feathered, not aliased
  tooth: 0.0,          // canvas weave, off: it broke the edge into speckle

  // How the paint reads on the world.
  coverGamma: 0.72,    // <1 makes thin coverage show up sooner
  shadeFloor: 0.58,    // object shading multiplies the paint between this and this+range
  shadeRange: 0.72,
  chroma: 1.18,        // re-saturation, so overlaps stay vivid
};

export const droplet = {
  poolSize: 64,
  size: 2.2,           // bigger, so it stays readable falling from 150 units up
  gravity: 46,         // roughly a 2.5s fall from cruising altitude
  stretch: 0.03,       // how much speed elongates the falling blob
  throwSpeed: 3,       // forward push on release, on top of the moth's own velocity
};

export const post = {
  radius: 2,        // Kuwahara kernel radius in pixels; larger reads as faceted blocks
  grain: 0.03,      // canvas texture strength
  grainScale: 900,
  outline: 0.0,     // off: an outline is an edge, and edges are what we are removing
  vignette: 0.38,   // falls off to white, like the edge of the canvas
  fibre: 0.5,       // keep sampling almost straight, so curves stay curves
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
