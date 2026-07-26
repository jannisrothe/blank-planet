import * as THREE from 'three';

/**
 * The things in the air a drop can actually hit: islands, sky grazers, spore floaters.
 *
 * They cannot use the world paint map. It is one texture indexed by world XZ with no
 * notion of height, so a splat on the ground painted the whole column above it -- the
 * island overhead and every creature drifting through. And nothing but terrain was ever
 * tested for impact, so a drop aimed at a grazer went straight through it.
 *
 * Both halves are the same problem. Each instance registered here carries its own colour
 * in an `instancePaint` attribute, written only when a drop's path actually crosses it.
 *
 * The test is a segment against a sphere, not a point against a sphere: a drop covers
 * several units per frame near terminal velocity, and a 3-unit spore sits comfortably
 * between two consecutive positions.
 */

/**
 * Entry point of segment AB into the sphere, as a fraction of AB, or Infinity for a miss.
 * A segment that starts inside counts as a hit at 0.
 */
function entryAlongSegment(a, b, cx, cy, cz, r) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const fx = a.x - cx, fy = a.y - cy, fz = a.z - cz;
  const qa = dx * dx + dy * dy + dz * dz;
  const qc = fx * fx + fy * fy + fz * fz - r * r;
  if (qc <= 0) return 0;                       // started inside
  if (qa < 1e-9) return Infinity;              // no movement, and not inside
  const qb = 2 * (fx * dx + fy * dy + fz * dz);
  const disc = qb * qb - 4 * qa * qc;
  if (disc < 0) return Infinity;
  const t = (-qb - Math.sqrt(disc)) / (2 * qa);
  return t >= 0 && t <= 1 ? t : Infinity;
}

export class Hittables {
  constructor() {
    this.groups = [];
  }

  /**
   * @param {THREE.InstancedMesh} mesh
   * @param {Array<{x:number, y:number, z:number, hitRadius:number}>} items the live
   *   per-instance state. Read every test, so movers need no separate bookkeeping.
   */
  add(mesh, items) {
    const paint = new THREE.InstancedBufferAttribute(new Float32Array(items.length * 4), 4);
    paint.setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute('instancePaint', paint);
    this.groups.push({ items, paint });
  }

  /**
   * Paint the first thing the segment from `from` to `to` crosses.
   *
   * @param {THREE.Vector3} from position last frame
   * @param {THREE.Vector3} to position this frame
   * @param {THREE.Color} color
   * @returns {boolean} true if something was hit, and the drop should stop
   */
  hit(from, to, color) {
    let bestT = Infinity;
    let bestGroup = null;
    let bestIndex = -1;

    for (const group of this.groups) {
      const { items } = group;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const t = entryAlongSegment(from, to, it.x, it.y, it.z, it.hitRadius);
        if (t < bestT) {
          bestT = t;
          bestGroup = group;
          bestIndex = i;
        }
      }
    }
    if (!bestGroup) return false;

    // Covers rather than blends, the same rule the ground paint follows.
    const o = bestIndex * 4;
    bestGroup.paint.array[o] = color.r;
    bestGroup.paint.array[o + 1] = color.g;
    bestGroup.paint.array[o + 2] = color.b;
    bestGroup.paint.array[o + 3] = 1;
    bestGroup.paint.needsUpdate = true;
    return true;
  }

  /** Wipe every instance back to blank paper. Pairs with PaintMap.clear(). */
  clear() {
    for (const group of this.groups) {
      group.paint.array.fill(0);
      group.paint.needsUpdate = true;
    }
  }

  /** How many instances are currently carrying paint. For the gates. */
  get paintedCount() {
    let n = 0;
    for (const group of this.groups) {
      for (let i = 3; i < group.paint.array.length; i += 4) if (group.paint.array[i] > 0) n++;
    }
    return n;
  }
}
