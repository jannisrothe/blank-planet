import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyInk } from '../ink/inkMaterial.js';
import { scatter } from '../scatter.js';
import { heightAt } from '../terrain.js';
import { life as cfg } from '../config.js';

/**
 * The things living on the planet. Four forms, picked to differ in composition rather
 * than to be four sizes of the same shape: vegetal, fleshy, shelled, skeletal.
 *
 * All of them are rooted. The two airborne ones, drifting sky grazers and spore floaters,
 * were cut along with the floating islands; the height they used to hold is in the
 * mountain ranges now.
 *
 * They obey the world rule, so every one is ink-washed and carries no colour until you
 * land pigment on it. Since they are all part of the ground they stand in, they read the
 * world paint map by XZ like the terrain does.
 */

/** @see features.js -- mergeGeometries refuses to mix indexed and non-indexed inputs. */
function merge(parts) {
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}

function inkMaterial(opts = {}, inkOpts) {
  return applyInk(new THREE.MeshLambertMaterial({ toneMapped: false, ...opts }), inkOpts);
}

// ---------------------------------------------------------------------------
// Geometry. Each builder returns a shape roughly 1 unit across so the caller can
// scale by the size it actually wants, the same convention features.js uses.
// ---------------------------------------------------------------------------

/** Vegetal: a thin stalk under a heavy bulb, with a few limp tendrils. 3.6 units tall. */
function anemoneGeometry() {
  const stalk = new THREE.CylinderGeometry(0.07, 0.16, 3.0, 12).translate(0, 1.5, 0);
  const bulb = new THREE.SphereGeometry(0.36, 20, 14).scale(1, 0.85, 1).translate(0, 3.1, 0);
  const tendrils = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    tendrils.push(
      new THREE.CylinderGeometry(0.012, 0.04, 0.7, 8)
        .rotateZ(0.5)
        .translate(Math.cos(a) * 0.22, 2.85, Math.sin(a) * 0.22),
    );
  }
  return merge([stalk, bulb, ...tendrils]);
}
const ANEMONE_HEIGHT = 3.6;

/** Fleshy: a squat two-lobed bag, meant to sit half-buried. ~2 units wide. */
function sacGeometry() {
  const main = new THREE.SphereGeometry(1, 28, 18).scale(1, 0.72, 1);
  const lobe = new THREE.SphereGeometry(0.52, 22, 14).scale(1, 0.8, 1).translate(0.62, 0.28, 0.1);
  const pore = new THREE.SphereGeometry(0.2, 16, 12).translate(-0.1, 0.68, 0.1);
  return merge([main, lobe, pore]);
}

/**
 * Shelled: a coiled tube on a logarithmic spiral, tapered along its length.
 * TubeGeometry has one radius for the whole tube, so the taper is applied afterwards by
 * pulling each ring toward its own point on the curve. Without it this reads as a hose.
 */
function shellGeometry() {
  const points = [];
  const TURNS = 5.2;
  for (let i = 0; i <= 96; i++) {
    const t = i / 96;
    const a = t * Math.PI * TURNS;
    const r = 0.09 * Math.exp(2.0 * t);
    points.push(new THREE.Vector3(Math.cos(a) * r, t * 0.34, Math.sin(a) * r));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const tubular = 140;
  const radial = 12;
  const geo = new THREE.TubeGeometry(curve, tubular, 0.12, radial, false);

  const pos = geo.attributes.position;
  const centre = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    // The tip is a fifth of the mouth, which is what makes it read as grown rather than
    // extruded. Squared, so most of the narrowing happens near the tip.
    const k = 0.2 + 0.8 * (i / tubular) ** 2;
    curve.getPointAt(i / tubular, centre);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, idx).sub(centre).multiplyScalar(k).add(centre);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

/** Skeletal: a row of ribs under a spine, fat in the middle. ~2.4 units long. */
function ribsGeometry() {
  const parts = [];
  const COUNT = 7;
  for (let i = 0; i < COUNT; i++) {
    const t = i / (COUNT - 1);
    const s = 0.42 + Math.sin(t * Math.PI) * 0.58;
    parts.push(
      new THREE.TorusGeometry(s, 0.05, 10, 26, Math.PI)
        .translate(0, 0, (t - 0.5) * 2.4),
    );
  }
  parts.push(
    new THREE.CylinderGeometry(0.055, 0.055, 2.5, 10)
      .rotateX(Math.PI / 2)
      .translate(0, 0.92, 0),
  );
  return merge(parts);
}

// ---------------------------------------------------------------------------
// Placement and motion
// ---------------------------------------------------------------------------

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function writeMatrix(mesh, i, it) {
  _e.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0);
  _p.set(it.x, it.y, it.z);
  _s.set(it.sx, it.sy, it.sz);
  mesh.setMatrixAt(i, _m.compose(_p, _q.setFromEuler(_e), _s));
}

function instanced(geo, material, items) {
  const mesh = new THREE.InstancedMesh(geo, material, items.length);
  items.forEach((it, i) => writeMatrix(mesh, i, it));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

export function createLifeforms(density, rand) {
  const meshes = [];
  const animated = [];

  // -- anemones, in clumps. One alone reads as a stray prop; a stand of them reads as
  // something growing there.
  const clumps = scatter(Math.ceil(density.anemones / 6), rand, 24, 60);
  const anemones = [];
  for (const c of clumps) {
    const n = 3 + Math.floor(rand() * 6);
    for (let i = 0; i < n && anemones.length < density.anemones; i++) {
      const a = rand() * Math.PI * 2;
      const r = rand() * 16;
      const x = c.x + Math.cos(a) * r;
      const z = c.z + Math.sin(a) * r;
      const height = 8 + rand() * 17;
      const k = height / ANEMONE_HEIGHT;
      anemones.push({
        x, y: heightAt(x, z) - 0.4, z,
        sx: k * (0.8 + rand() * 0.5), sy: k, sz: k * (0.8 + rand() * 0.5),
        ry: rand() * Math.PI * 2,
        phase: rand() * Math.PI * 2,
      });
    }
  }
  const anemoneMesh = instanced(anemoneGeometry(), inkMaterial(), anemones);
  meshes.push(anemoneMesh);
  animated.push((t) => {
    anemones.forEach((it, i) => {
      const s = Math.sin(t * cfg.swaySpeed + it.phase) * cfg.swayAngle;
      it.rx = s;
      it.rz = Math.cos(t * cfg.swaySpeed * 0.7 + it.phase) * cfg.swayAngle * 0.6;
      writeMatrix(anemoneMesh, i, it);
    });
    anemoneMesh.instanceMatrix.needsUpdate = true;
  });

  // -- breathing sacs, sunk into the ground so they read as part of it until they move
  const sacs = scatter(density.sacs, rand, 30, 70).map((s) => {
    const size = 15 + rand() * 30;
    const k = size / 2;
    return {
      x: s.x, y: s.y - size * 0.20, z: s.z,
      sx: k, sy: k * (0.8 + rand() * 0.4), sz: k,
      ry: rand() * Math.PI * 2,
      base: k,
      phase: rand() * Math.PI * 2,
    };
  });
  const sacMesh = instanced(sacGeometry(), inkMaterial(), sacs);
  meshes.push(sacMesh);
  animated.push((t) => {
    sacs.forEach((it, i) => {
      const b = 1 + Math.sin(t * cfg.breathSpeed + it.phase) * cfg.breathAmount;
      it.sx = it.base * b;
      it.sz = it.base * b;
      writeMatrix(sacMesh, i, it);
    });
    sacMesh.instanceMatrix.needsUpdate = true;
  });

  // -- spiral shells, lying where they fell
  const shells = scatter(density.shells, rand, 34, 80).map((s) => {
    const k = (20 + rand() * 30) / 1.4;
    return {
      x: s.x, y: s.y + k * 0.05, z: s.z,
      sx: k, sy: k, sz: k,
      rx: (rand() - 0.5) * 0.7,
      ry: rand() * Math.PI * 2,
      rz: (rand() - 0.5) * 0.7,
    };
  });
  meshes.push(instanced(shellGeometry(), inkMaterial({ side: THREE.DoubleSide }), shells));

  // -- rib arcs, half sunk, so it reads as something that has been there a long time
  const ribs = scatter(density.ribs, rand, 40, 90).map((s) => {
    const k = (30 + rand() * 40) / 2.4;
    return {
      x: s.x, y: s.y - k * 0.18, z: s.z,
      sx: k, sy: k * (0.8 + rand() * 0.5), sz: k,
      ry: rand() * Math.PI * 2,
      rz: (rand() - 0.5) * 0.2,
    };
  });
  meshes.push(instanced(ribsGeometry(), inkMaterial(), ribs));

  return {
    meshes,
    /** @param {number} elapsed seconds */
    update(elapsed) {
      for (const fn of animated) fn(elapsed);
    },
  };
}
