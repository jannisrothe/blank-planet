import * as THREE from 'three';
import { PLANET_RADIUS } from './config.js';
import { radiusAt, SPAWN_DIR } from './terrain.js';

export { rng } from './random.js';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Even placement over a sphere, by the Fibonacci spiral.
 *
 * The plane version used a jittered grid, because pure random clumps and leaves bald
 * patches and that is very visible from the air. The spiral is the sphere's equivalent:
 * every point lands almost exactly the same distance from its neighbours, with no seam
 * and no crowding at the poles the way lat/long stepping would give.
 *
 * Each spot carries the quaternion that stands a prop up on the surface. Every prop file
 * already composes a matrix from a position, a random Euler and a scale, so they multiply
 * their existing Euler onto this rather than replacing it: the randomisation they had is
 * untouched, just re-based onto the local surface normal.
 *
 * @param {number} count
 * @param {() => number} rand
 * @param {number} _margin ignored; a sphere has no edge to stay inside of
 * @param {number} clearRadius keep this far, as surface distance, from the spawn point
 * @returns {Array<{dir:THREE.Vector3, quat:THREE.Quaternion, radius:number}>} the world
 *   position is dir * radius; it is not stored, because at ninety thousand spots the
 *   duplicate vectors were most of the garbage the load had to collect
 */
export function scatter(count, rand, _margin = 6, clearRadius = 0) {
  const out = [];
  const clearAngle = clearRadius / PLANET_RADIUS;
  const up = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i < count; i++) {
    // Jitter within the cell each point owns, so a field does not read as a spiral.
    const y = 1 - (2 * (i + rand()) ) / count;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * GOLDEN_ANGLE + rand() * GOLDEN_ANGLE * 0.5;
    const dir = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r).normalize();
    if (clearAngle && dir.angleTo(SPAWN_DIR) < clearAngle) continue;

    out.push({
      dir,
      quat: new THREE.Quaternion().setFromUnitVectors(up, dir),
      radius: radiusAt(dir),
    });
  }
  return out;
}

const _axis = new THREE.Vector3();
const _upY = new THREE.Vector3(0, 1, 0);

/**
 * A spot a given surface distance from another, on a given bearing.
 *
 * Clumped props used to offset x and z by a few units. On a ball that walks off the
 * surface, so the offset is a rotation of the direction instead, about an axis chosen by
 * the bearing.
 *
 * @param {ReturnType<typeof scatter>[number]} from
 * @param {number} bearing radians around the local up
 * @param {number} distance surface distance in world units
 */
export function offsetSpot(from, bearing, distance) {
  const tangent = _axis.copy(Math.abs(from.dir.y) < 0.9 ? _upY : new THREE.Vector3(1, 0, 0))
    .cross(from.dir).normalize();
  const dir = from.dir.clone()
    .applyAxisAngle(tangent, distance / PLANET_RADIUS)
    .applyAxisAngle(from.dir, bearing)
    .normalize();
  return {
    dir,
    quat: new THREE.Quaternion().setFromUnitVectors(_upY, dir),
    radius: radiusAt(dir),
  };
}
