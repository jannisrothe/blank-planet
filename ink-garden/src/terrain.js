import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { WORLD_SIZE, terrain as cfg } from './config.js';
import { rng } from './random.js';

/**
 * Single source of truth for terrain height, used for placement, the flight altitude
 * clamp and the drop raycast. The prototype had this formula written twice
 * (ink-garden-world.html:70 and :124-126), which is a drift waiting to happen.
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
];

/** Ridged noise: fold the signal at zero and invert, turning smooth hills into crests. */
function ridged(x, z, freq, n) {
  return 1 - Math.abs(n(x * freq, z * freq));
}

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

  // Flatten a landing area around the origin so the moth never spawns inside a ridge.
  const d = Math.hypot(x, z);
  if (d < cfg.spawnFlat) h *= (d / cfg.spawnFlat) ** 2;

  return h;
}

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
