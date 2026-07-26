/**
 * Every tunable lives here so step 7 can bake measured values in one place
 * instead of hunting constants across modules.
 */

export const WORLD_SIZE = 220;      // world spans WORLD_SIZE x WORLD_SIZE units
export const EYE_HEIGHT = 1.7;
export const WALK_SPEED = 12;
export const RUN_SPEED = 20;

export const ink = {
  resolution: 512,   // ink map texels across the world
  radius: 9,         // reveal radius in world units
  fadeSeconds: 3.2,  // time constant for ink drying back to white
  bleed: 1.35,       // diffusion blur in texels per frame; the watercolour spread
  edgeWarp: 0.55,    // how ragged the blot boundary is (0 = perfect circle)

  // Reveal ramps, in ink units 0..1. The two ramps overlap tightly on purpose:
  // a wide gap between them leaves a broad gray halo that reads as dirt, not paint.
  washLo: 0.04, washHi: 0.15,   // stage 1: shape emerges from the paper as a gray wash
  pigLo: 0.07, pigHi: 0.30,     // stage 2: pigment floods in just behind it
  rimLo: 0.05, rimMid: 0.12, rimHi: 0.28, // wet edge: pigment pools at the boundary
  rimStrength: 0.30,
};

export const density = {
  flowers: 4800,
  grass: 14000,
  trees: 400,
  mushrooms: 700,
  rocks: 300,
  reeds: 1600,
};

export const collision = {
  playerRadius: 0.45,
  treeRadius: 0.55,
  rockRadius: 0.7,
};

export const audio = {
  src: 'audio/paulyudin-emotional-light-piano-159833.mp3',
  // The ink drives the mix: muffled and distant on blank paper, open inside a bloom.
  gainDry: 0.15, gainWet: 0.85,
  cutoffDry: 400, cutoffWet: 18000,
  smoothing: 0.6, // seconds
};
