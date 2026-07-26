import * as THREE from 'three';

/**
 * Colour comes from hue families rather than uniform random RGB. Random RGB reads as
 * noise; a handful of related families reads as a painting. Each family is a hue arc
 * plus saturation and lightness ranges, sampled per instance.
 *
 * This also structurally fixes the prototype's bug where one petal colour was baked
 * into a single shared texture at load (ink-garden-world.html:132-134), making all 500
 * flowers identical.
 */

const FAMILIES = {
  // hue in degrees, sat and light as 0..1 ranges
  blush:    { h: [340, 10],  s: [0.55, 0.85], l: [0.62, 0.80] },
  coral:    { h: [8, 28],    s: [0.62, 0.90], l: [0.58, 0.74] },
  saffron:  { h: [36, 52],   s: [0.65, 0.95], l: [0.58, 0.76] },
  chartreuse: { h: [62, 88], s: [0.45, 0.70], l: [0.52, 0.70] },
  viridian: { h: [96, 140],  s: [0.32, 0.58], l: [0.38, 0.58] },
  teal:     { h: [160, 190], s: [0.38, 0.62], l: [0.46, 0.66] },
  cerulean: { h: [196, 224], s: [0.48, 0.78], l: [0.58, 0.76] },
  violet:   { h: [252, 288], s: [0.42, 0.72], l: [0.60, 0.78] },
  magenta:  { h: [300, 334], s: [0.50, 0.80], l: [0.62, 0.80] },
  bark:     { h: [18, 34],   s: [0.30, 0.48], l: [0.30, 0.44] },
  cream:    { h: [34, 48],   s: [0.20, 0.40], l: [0.82, 0.92] },
  stone:    { h: [200, 240], s: [0.04, 0.12], l: [0.56, 0.72] },
};

/**
 * The pigments you drop. High chroma on purpose: these now supply all of the world's
 * colour, so anything muted here reads as a dirty wash rather than an alien planet.
 * Deliberately not sampled from FAMILIES, which is tuned for object shading.
 */
export const PIGMENTS = [
  0xff1f8f, // electric magenta
  0x9dff2e, // acid green
  0x14e0ff, // cyan
  0x8b3dff, // violet
  0xff7a10, // sodium orange
  0xff3d6e, // hot pink
  0x00ffc3, // spearmint
  0xffe615, // sulphur yellow
  0x2f5bff, // ultramarine
  0xff4fe0, // fuchsia
];

/** @param {() => number} rand @returns {THREE.Color} a fresh pigment for one drop */
export function samplePigment(rand, out = new THREE.Color()) {
  const base = PIGMENTS[(rand() * PIGMENTS.length) | 0];
  out.setHex(base);
  // Nudge the hue a little so repeat drops of the same pigment are not identical.
  const hsl = { h: 0, s: 0, l: 0 };
  out.getHSL(hsl);
  return out.setHSL((hsl.h + (rand() - 0.5) * 0.045 + 1) % 1,
    Math.min(1, hsl.s * (0.92 + rand() * 0.16)),
    Math.min(0.72, hsl.l * (0.92 + rand() * 0.18)));
}

/** Which families each prop draws from, and how heavily. */
export const MIXES = {
  flower: ['blush', 'blush', 'coral', 'saffron', 'cerulean', 'violet', 'magenta', 'cream'],
  grass: ['viridian', 'viridian', 'viridian', 'viridian', 'chartreuse'],
  canopy: ['viridian', 'viridian', 'viridian', 'chartreuse', 'teal', 'saffron'],
  trunk: ['bark'],
  mushroom: ['coral', 'blush', 'cream', 'saffron'],
  rock: ['stone', 'stone', 'bark'],
  reed: ['chartreuse', 'viridian', 'teal'],
  mote: ['cream', 'saffron', 'blush', 'cerulean'],
};

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * @param {string} mix key of MIXES
 * @param {() => number} rand seeded 0..1 source
 * @param {THREE.Color} [out]
 */
export function sample(mix, rand, out = new THREE.Color()) {
  const names = MIXES[mix];
  const fam = FAMILIES[names[(rand() * names.length) | 0]];
  // hue arcs may wrap past 360 (blush runs 340 -> 10)
  const h = lerp(fam.h[0], fam.h[1] < fam.h[0] ? fam.h[1] + 360 : fam.h[1], rand());
  return out.setHSL((h % 360) / 360, lerp(fam.s[0], fam.s[1], rand()), lerp(fam.l[0], fam.l[1], rand()));
}
