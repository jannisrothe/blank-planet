import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyInk } from '../ink/inkMaterial.js';
import { scatter } from '../scatter.js';
import { heightAt } from '../terrain.js';
import { flight } from '../config.js';

/**
 * The things that make this read as somewhere else: floating islands, arches, grown
 * towers, crystal spires. All instanced, so the whole alien layer costs four draw calls.
 *
 * Everything here is near-white. Pigment supplies all colour now, so a feature with a
 * strong hue of its own would fight the wash laid over it.
 */

// Smooth shading throughout. Faceted primitives and flatShading are the two things that
// make a low-poly world read as hard-edged, and this one is meant to be all curves.
function inkMaterial(opts = {}) {
  return applyInk(new THREE.MeshLambertMaterial({ toneMapped: false, ...opts }));
}

/**
 * mergeGeometries refuses to mix indexed and non-indexed inputs, and the polyhedron
 * primitives (Icosahedron, Octahedron) are non-indexed while Cone/Cylinder/Sphere/Torus
 * are indexed. Normalise everything to non-indexed first.
 */
function merge(parts) {
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}

/** Builds an InstancedMesh from per-instance transforms. */
function build(geo, material, items, frustumCulled = false) {
  const mesh = new THREE.InstancedMesh(geo, material, items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  items.forEach((it, i) => {
    e.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0);
    p.set(it.x, it.y, it.z);
    s.set(it.sx, it.sy, it.sz);
    mesh.setMatrixAt(i, m.compose(p, q.setFromEuler(e), s));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = frustumCulled;
  return mesh;
}

/** Flattened rock hanging in the air with a spiked underside and trailing strands. */
function islandGeometry() {
  const top = new THREE.SphereGeometry(1, 26, 16).scale(1, 0.34, 1);
  const keel = new THREE.ConeGeometry(0.78, 1.7, 26).rotateX(Math.PI).translate(0, -0.85, 0);
  // Strands hanging off the keel. Merged in rather than instanced separately, so the
  // whole island layer is still one draw call.
  const strands = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const r = 0.16 + (i % 2) * 0.18;
    const len = 1.4 + (i % 3) * 0.9;
    strands.push(
      new THREE.CylinderGeometry(0.012, 0.05, len, 8)
        .translate(Math.cos(a) * r, -1.5 - len / 2, Math.sin(a) * r),
    );
  }
  return merge([top, keel, ...strands]);
}

export function createIslands(count, rand) {
  // Wide keep-out around the spawn point: islands are now up to 46 units across and the
  // entry overlay is not fully opaque, so one parked overhead greys out the first screen.
  const spots = scatter(count, rand, 14, 130);
  const items = spots.map((s) => {
    const k = 12 + rand() * 34;
    // Two bands with a gap over the cruise altitude. Islands have no collision, so
    // rather than pay for one, leave the band you fly in empty: you pass over the low
    // layer and under the high one, and never fly through geometry. Expressed as a
    // fraction of the cruise altitude so changing it cannot silently put an island in
    // the moth's path, which is exactly what happened when it was written as 60-200.
    const a = flight.spawnAltitude;
    const y = heightAt(s.x, s.z)
      + (rand() < 0.62 ? a * (0.20 + rand() * 0.42) : a * (1.35 + rand() * 0.50));
    return {
      x: s.x, z: s.z, y,
      sx: k, sy: k * (0.7 + rand() * 0.7), sz: k,
      ry: rand() * Math.PI * 2,
      rz: (rand() - 0.5) * 0.25,
    };
  });
  return build(islandGeometry(), inkMaterial(), items);
}

/**
 * A half-torus arch. The tube is squashed and tilted so a field of them does not read
 * as a row of identical croquet hoops.
 */
export function createArches(count, rand) {
  const spots = scatter(count, rand, 16, 30);
  const geo = new THREE.TorusGeometry(1, 0.14, 14, 48, Math.PI);
  const items = spots.map((s) => {
    const k = 14 + rand() * 46;
    return {
      x: s.x, z: s.z,
      y: heightAt(s.x, s.z) - k * 0.06,
      sx: k, sy: k * (0.8 + rand() * 0.9), sz: k * (0.5 + rand() * 0.5),
      ry: rand() * Math.PI * 2,
      rz: (rand() - 0.5) * 0.3,
    };
  });
  return build(geo, inkMaterial({ side: THREE.DoubleSide }), items);
}

/**
 * Grown, not built: a ribbed stalk under a heavy cap. Bosch by way of Midnight Gospel,
 * which is why the proportions are deliberately wrong for a real mushroom.
 */
function growthGeometry() {
  const stalk = new THREE.CylinderGeometry(0.16, 0.30, 3.4, 22, 3).translate(0, 1.7, 0);
  const cap = new THREE.SphereGeometry(1.0, 26, 16, 0, Math.PI * 2, 0, Math.PI * 0.55)
    .scale(1, 0.72, 1).translate(0, 3.4, 0);
  const collar = new THREE.TorusGeometry(0.42, 0.09, 10, 26).rotateX(Math.PI / 2).translate(0, 2.5, 0);
  return merge([stalk, cap, collar]);
}

/** The raw growth geometry stands about 4.4 units tall at scale 1. */
const GROWTH_BASE_HEIGHT = 4.4;

export function createGrowths(count, rand) {
  const spots = scatter(count, rand, 12, 24);
  const colliders = [];
  const items = spots.map((s) => {
    // Sized by the height we actually want, not by compounding random multipliers.
    // Doing the latter first produced 110-unit towers the moth flew straight into.
    const height = 10 + rand() * 34;
    const sy = height / GROWTH_BASE_HEIGHT;
    const girth = sy * (0.55 + rand() * 0.5);
    const base = heightAt(s.x, s.z) - 0.4;
    if (height > 16) colliders.push({ x: s.x, z: s.z, r: girth * 1.1, yTop: base + height });
    return {
      x: s.x, z: s.z, y: base,
      sx: girth, sy, sz: girth,
      ry: rand() * Math.PI * 2,
      rz: (rand() - 0.5) * 0.14,
    };
  });
  return { mesh: build(growthGeometry(), inkMaterial(), items), colliders };
}

/** Smooth tapered spires. Translucent, so overlapping ones stack their colour. */
/** The cone stands 5.2 units at scale 1. */
const SPIRE_BASE_HEIGHT = 5.2;

export function createSpires(count, rand) {
  const spots = scatter(count, rand, 10, 22);
  const geo = new THREE.ConeGeometry(0.5, 5.2, 26);
  const colliders = [];
  const items = spots.map((s) => {
    const height = 6 + rand() * 32;
    const sy = height / SPIRE_BASE_HEIGHT;
    const girth = sy * (0.28 + rand() * 0.34);
    const base = heightAt(s.x, s.z);
    if (height > 16) colliders.push({ x: s.x, z: s.z, r: girth * 0.7, yTop: base + height * 0.5 });
    return {
      x: s.x, z: s.z, y: base + height * 0.34,
      sx: girth, sy, sz: girth,
      ry: rand() * Math.PI * 2,
      rx: (rand() - 0.5) * 0.22,
      rz: (rand() - 0.5) * 0.22,
    };
  });
  return {
    mesh: build(geo, inkMaterial({ transparent: true, opacity: 0.82, depthWrite: true }), items),
    colliders,
  };
}
