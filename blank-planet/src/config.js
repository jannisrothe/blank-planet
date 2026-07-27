/**
 * Every tunable lives here so the debug panel and the final bake touch one place.
 */

// The planet. 4*pi*r^2 at this radius is 640^2, the area of the plane this replaces, so
// prop densities and feature sizes carry over unchanged. Small enough that the curvature
// is obvious and a lap takes about seventy seconds.
export const PLANET_RADIUS = 180;

// Kept as the paint map's world extent and the unit that splat radii are quoted in.
export const WORLD_SIZE = 640;

export const terrain = {
  seed: 20260726,
  // Icosphere subdivisions. 7 is 327,680 triangles, near what the 400-segment plane
  // carried; each step up quadruples it.
  detail: 7,
  frequency: 0.0034,   // scaled down with the world, so landforms stay the same size
  amplitude: 26,
  ridgeAmplitude: 22,  // ridged octave, carves spines and valleys
  spawnFlat: 40,       // flattened radius around the origin so the moth spawns clear

  // Frequencies are per unit of surface distance, so they mean the same thing they did on
  // the plane: 0.0034 is a feature roughly 300 units across either way.
  basinFrequency: 0.00085,
  basinAmplitude: 54,

  craters: 9,
  craterRadius: [42, 110],
  craterDepth: [22, 58],
  craterRim: 0.28,     // rim height as a fraction of depth

  // Ranges. A ridged octave raised to a power, so the crest line survives and the rest
  // falls away. At a tenth of the height it first ran at, and with a lower power, which
  // is what takes the steepness out: a higher power narrows the crest into a blade.
  // The rolling elevation underneath comes from the basin and fbm octaves above, not
  // from this, so flattening the ranges does not flatten the world.
  mountainFrequency: 0.0016,
  mountainAmplitude: 32,
  mountainSharpness: 2.0,
};

export const flight = {
  driftSpeed: 20.5,     // dialled in on the slider
  minSpeed: 2,
  maxSpeed: 40,         // headroom, so W still does something at the new cruise speed
  trimRate: 7,          // how fast W/S change speed
  turnRate: 0.0016,     // radians per pixel of mouse movement
  maxPitch: 0.85,       // radians, keeps you from looping over the top
  smoothing: 2.4,       // higher is snappier; low values feel like heavy drifting
  // Altitudes are above the surface, not above the origin. At 200 on a radius-180 planet
  // the whole ball fits on screen and it stops being somewhere you are.
  spawnAltitude: 50,
  groundClearance: 25,  // never descend closer than this to the terrain
  ceiling: 260,
  // Chase camera, in the moth's local frame.
  camBack: 9.5,
  camUp: 4.6,
  camLag: 4.0,
};

// Wet oil, not watercolour. A splat is stamped once on impact and never moves, so none
// of the capillary, advection and drying machinery exists any more.
export const paint = {
  resolution: 2048,    // texels across the world: 0.31 world units each
  radius: 18,          // dialled in on the slider; 9 read too small at a 200-unit cruise
  satellites: 0.52,    // spatter droplets thrown clear of the splat, biased downrange
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
  size: 2.0,           // a bead, not a boulder; still readable falling from 300 units up
  gravity: 90,         // about a 2.1s fall from the cruise altitude
  stretch: 0.0,        // off: any elongation reads as a streak, and this should be a ball
  throwSpeed: 3,       // forward push on release, on top of the moth's own velocity
};

export const post = {
  radius: 2,        // Kuwahara kernel radius in pixels; larger reads as faceted blocks
  grain: 0.03,      // canvas texture strength
  grainScale: 900,
  outline: 0.0,     // off: an outline is an edge, and edges are what we are removing
  // The contour is a different thing from that outline. It comes from the depth buffer,
  // so it draws silhouettes on a world that is white on white and otherwise impossible
  // to read. Without it you cannot tell you are moving, or which way the moth is facing.
  contour: 0.55,
  // Creases inside a shape, from the second difference of the same depth taps. Without
  // it a 375-unit mountain is a blank white mass with an outline drawn round it.
  crease: 0.35,
  contourWidth: 1.0, // in pixels
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
  arches: 60,
  growths: 260,
  spires: 340,

  // Lifeforms, all rooted. Counts are low because each one is large enough to read from
  // cruising altitude; these are landmarks to aim pigment at, not ground cover.
  anemones: 900,
  sacs: 220,
  shells: 130,
  ribs: 70,
};

// Lifeforms move slowly enough that you notice it on the second look, not the first.
export const life = {
  swaySpeed: 0.30,     // radians per second of the anemone lean
  swayAngle: 0.16,     // how far it leans
  breathSpeed: 0.22,   // sac inflate cycle
  breathAmount: 0.11,  // fraction of size
};

// Fragment cost dominates this renderer, and it scales with the square of this number.
// On a retina display the browser reports 2, which is four times the pixels of 1.
export const render = {
  pixelRatio: 2,
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
