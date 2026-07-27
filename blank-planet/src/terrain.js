import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { WORLD_SIZE, terrain as cfg } from './config.js';
import { rng } from './random.js';

/**
 * Single source of truth for terrain height, used for placement, the flight altitude
 * clamp and the drop raycast. The prototype had this formula written twice
 * (prototype.html:70 and :124-126), which is a drift waiting to happen.
 *
 * v1 was two trig terms, which gave gentle swells and nothing to fly around. This is
 * multi-octave simplex plus a ridged octave: fbm supplies rolling landmass, the ridged
 * term carves the sharp spines and valleys that make flight interesting.
 */

const noiseRand = rng(cfg.seed);
const noise = [
  createNoise2D(noiseRand),
  createNoise2D(noiseRand),
  createNoise2D(noiseRand),
  createNoise2D(noiseRand),
  createNoise2D(noiseRand), // basins
  createNoise2D(noiseRand), // mountain ranges
];

/** Ridged noise: fold the signal at zero and invert, turning smooth hills into crests. */
function ridged(x, z, freq, n) {
  return 1 - Math.abs(n(x * freq, z * freq));
}

/**
 * Craters, fixed at module load off the terrain seed so every call to heightAt agrees.
 * Placed away from the spawn flat, and rejected if they overlap an earlier one: two
 * bowls sharing a floor read as one shapeless dent rather than two craters.
 */
const craters = (() => {
  const r = rng(cfg.seed + 977);
  const [rMin, rMax] = cfg.craterRadius;
  const [dMin, dMax] = cfg.craterDepth;
  const out = [];
  const half = WORLD_SIZE / 2;
  for (let tries = 0; tries < cfg.craters * 40 && out.length < cfg.craters; tries++) {
    const radius = rMin + r() * (rMax - rMin);
    const x = (r() * 2 - 1) * (half - radius);
    const z = (r() * 2 - 1) * (half - radius);
    if (Math.hypot(x, z) < cfg.spawnFlat + radius) continue;
    if (out.some((c) => Math.hypot(c.x - x, c.z - z) < c.radius + radius)) continue;
    out.push({ x, z, radius, depth: dMin + r() * (dMax - dMin) });
  }
  return out;
})();

export function heightAt(x, z) {
  let h = 0;
  let amp = cfg.amplitude;
  let freq = cfg.frequency;

  for (let o = 0; o < 3; o++) {
    h += noise[o](x * freq, z * freq) * amp;
    freq *= 2.07;   // not exactly 2, or the octaves line up and produce visible grids
    amp *= 0.48;
  }

  h += (ridged(x, z, cfg.frequency * 1.6, noise[3]) - 0.5) * cfg.ridgeAmplitude;
  h += noise[4](x * cfg.basinFrequency, z * cfg.basinFrequency) * cfg.basinAmplitude;

  // Ranges. ridged() peaks at 1 along its crest line and falls away either side; the
  // power keeps only the crest, so the result is a few tall spines rather than a world
  // of uniform lumps. This is where the height that used to be floating islands went.
  const crest = ridged(x, z, cfg.mountainFrequency, noise[5]);
  h += crest ** cfg.mountainSharpness * cfg.mountainAmplitude;

  for (const c of craters) {
    const d = Math.hypot(x - c.x, z - c.z);
    if (d >= c.radius) continue;
    // cos ramp rather than a linear or quadratic one: it meets the surrounding ground
    // with zero slope at both ends, so neither the lip nor the floor shows a crease.
    const t = d / c.radius;
    const bowl = (Math.cos(t * Math.PI) + 1) / 2;      // 1 at the centre, 0 at the edge
    const rim = Math.sin(t * Math.PI) ** 6;            // a narrow swell just inside the lip
    h += -c.depth * bowl + c.depth * cfg.craterRim * rim;
  }

  // Flatten a landing area around the origin so the moth never spawns inside a ridge.
  const d = Math.hypot(x, z);
  if (d < cfg.spawnFlat) h *= (d / cfg.spawnFlat) ** 2;

  return h;
}

/**
 * Highest ground anywhere, measured once rather than reasoned about.
 *
 * The flight ceiling and the camera far plane both have to clear it. When the ceiling
 * was a hand-picked constant it silently capped the moth *below* the ground clearance
 * over a tall peak, because flight.js applies the ceiling after the floor.
 */
export const terrainMax = (() => {
  const N = 220;
  const step = WORLD_SIZE / N;
  let max = -Infinity;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const h = heightAt(-WORLD_SIZE / 2 + i * step, -WORLD_SIZE / 2 + j * step);
      if (h > max) max = h;
    }
  }
  return max;
})();

/**
 * Near-neutral ground. Pigment supplies colour now, so anything strongly coloured here
 * would fight the wash laid over it.
 */
function groundTexture(size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#f2f0ec';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 260; i++) {
    const r = 40 + Math.random() * 150;
    const g = ctx.createRadialGradient(
      Math.random() * size, Math.random() * size, 0,
      Math.random() * size, Math.random() * size, r,
    );
    const v = 200 + Math.random() * 40 | 0;
    g.addColorStop(0, `rgba(${v},${v - 6},${v - 14},0.16)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }

  // faint striations, so a flat wash still shows some tooth
  ctx.strokeStyle = 'rgba(150,146,140,0.10)';
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 10, y + (Math.random() - 0.5) * 4);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createGround() {
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, cfg.segments, cfg.segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial({ map: groundTexture() });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'ground';
  return mesh;
}
