import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise3D } from 'simplex-noise';
import { PLANET_RADIUS, terrain as cfg } from './config.js';
import { rng } from './random.js';

/**
 * The planet's surface, as a single function of direction.
 *
 * This replaces a `heightAt(x, z)` over a 640x640 plane. The plane could not be flown
 * around -- it clamped six units inside its own edge -- and every octave below is the same
 * octave it was there, just sampled with 3D noise on the unit sphere instead of 2D noise
 * on a plane. Frequencies are still per unit of surface distance, so 0.0034 means a
 * feature about 300 units across exactly as it did before.
 *
 * Still the single source of truth: placement, the flight altitude clamp and the droplet
 * impact test all come through here.
 */

const noiseRand = rng(cfg.seed);
const noise = [
  createNoise3D(noiseRand),
  createNoise3D(noiseRand),
  createNoise3D(noiseRand),
  createNoise3D(noiseRand), // ridges
  createNoise3D(noiseRand), // basins
  createNoise3D(noiseRand), // ranges
];

/** Ridged noise: fold the signal at zero and invert, turning smooth hills into crests. */
function ridged(d, freq, n) {
  return 1 - Math.abs(n(d.x * freq, d.y * freq, d.z * freq));
}

/**
 * Where the moth starts, and the patch that gets flattened under it. On a plane this was
 * the origin; on a sphere it has to be a direction, and +Y is as good as any.
 */
export const SPAWN_DIR = new THREE.Vector3(0, 1, 0);

/**
 * Craters, fixed at module load off the terrain seed. Each is a cone around a direction
 * rather than a circle around a point, with the same cosine ramp: it meets the
 * surrounding ground with zero slope at both ends, so neither lip nor floor creases.
 */
const craters = (() => {
  const r = rng(cfg.seed + 977);
  const [rMin, rMax] = cfg.craterRadius;
  const [dMin, dMax] = cfg.craterDepth;
  const out = [];
  for (let tries = 0; tries < cfg.craters * 60 && out.length < cfg.craters; tries++) {
    // Uniform on the sphere. Sampling angles directly would crowd the poles.
    const u = r() * 2 - 1;
    const phi = r() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const dir = new THREE.Vector3(s * Math.cos(phi), u, s * Math.sin(phi));
    const radius = rMin + r() * (rMax - rMin);
    const arc = radius / PLANET_RADIUS; // surface distance to angle
    if (dir.angleTo(SPAWN_DIR) < arc + cfg.spawnFlat / PLANET_RADIUS) continue;
    if (out.some((c) => dir.angleTo(c.dir) < arc + c.arc)) continue;
    out.push({ dir, arc, depth: dMin + r() * (dMax - dMin) });
  }
  return out;
})();

const _d = new THREE.Vector3();

/**
 * Distance from the planet centre to the surface, along `dir`.
 * @param {THREE.Vector3} dir does not need to be normalised
 */
export function radiusAt(dir) {
  const d = _d.copy(dir).normalize();
  let h = 0;
  let amp = cfg.amplitude;
  let freq = cfg.frequency * PLANET_RADIUS;

  for (let o = 0; o < 3; o++) {
    h += noise[o](d.x * freq, d.y * freq, d.z * freq) * amp;
    freq *= 2.07;   // not exactly 2, or the octaves line up and produce visible grids
    amp *= 0.48;
  }

  h += (ridged(d, cfg.frequency * 1.6 * PLANET_RADIUS, noise[3]) - 0.5) * cfg.ridgeAmplitude;

  const bf = cfg.basinFrequency * PLANET_RADIUS;
  h += noise[4](d.x * bf, d.y * bf, d.z * bf) * cfg.basinAmplitude;

  // Ranges. The power keeps only the crest line, so these are a few long spines rather
  // than a world of uniform lumps.
  const crest = ridged(d, cfg.mountainFrequency * PLANET_RADIUS, noise[5]);
  h += crest ** cfg.mountainSharpness * cfg.mountainAmplitude;

  for (const c of craters) {
    const a = d.angleTo(c.dir);
    if (a >= c.arc) continue;
    const t = a / c.arc;
    const bowl = (Math.cos(t * Math.PI) + 1) / 2;   // 1 at the centre, 0 at the edge
    const rim = Math.sin(t * Math.PI) ** 6;         // a narrow swell just inside the lip
    h += -c.depth * bowl + c.depth * cfg.craterRim * rim;
  }

  // Flatten a landing area under the spawn point so the moth never starts inside a ridge.
  const a = d.angleTo(SPAWN_DIR);
  const flat = cfg.spawnFlat / PLANET_RADIUS;
  if (a < flat) h *= (a / flat) ** 2;

  return PLANET_RADIUS + h;
}

/** Highest point anywhere. The flight ceiling and the camera far plane both clear it. */
export const terrainMax = (() => {
  let max = -Infinity;
  const d = new THREE.Vector3();
  const N = 260;
  for (let i = 0; i < N; i++) {
    // Fibonacci sphere: even coverage without crowding the poles.
    for (let j = 0; j < N; j++) {
      const k = i * N + j;
      const y = 1 - (2 * k + 1) / (N * N);
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const th = k * 2.399963229728653;
      d.set(Math.cos(th) * r, y, Math.sin(th) * r);
      const h = radiusAt(d);
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

/**
 * The ball. An icosphere rather than a UV sphere, because a UV sphere crowds its
 * triangles at the poles and this surface has no preferred axis.
 *
 * IcosahedronGeometry is non-indexed, one set of vertices per face, so displacing it
 * directly would split every shared edge and the whole planet would render faceted.
 * mergeVertices welds them first.
 */
export function createGround() {
  const geo = mergeVertices(new THREE.IcosahedronGeometry(1, cfg.detail));
  const pos = geo.attributes.position;
  const d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    const r = radiusAt(d);
    pos.setXYZ(i, d.x * r, d.y * r, d.z * r);
  }
  geo.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial({ map: groundTexture() });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'ground';
  return mesh;
}
