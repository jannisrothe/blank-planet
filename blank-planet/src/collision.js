import * as THREE from 'three';
import { collision as cfg } from './config.js';

/**
 * Push-out against the tall props, on the surface of the planet.
 *
 * This was a 2D spatial hash over XZ, which a sphere has no equivalent of: the hash key
 * came from world x and z, and on a ball two points can share both and be on opposite
 * sides. What replaces it is a plain scan, because only tall obstacles are registered at
 * all -- growths and spires over sixteen units -- and there are a few hundred of them.
 * At that count the hash was saving nothing worth the machinery.
 *
 * Each collider is a direction and an angular radius. A collider with `rTop` only blocks
 * below that distance from the planet centre, so flying over a spire is free while flying
 * through it is not.
 */
export class Colliders {
  /**
   * @param {Array<{x:number, z:number, y?:number, r:number, yTop?:number,
   *                dir?:THREE.Vector3, radius?:number, rTop?:number}>} colliders
   */
  constructor(colliders) {
    this.items = colliders.map((c) => {
      const dir = c.dir ? c.dir.clone().normalize()
        : new THREE.Vector3(c.x, c.y ?? 0, c.z).normalize();
      return { dir, r: c.r, rTop: c.rTop ?? Infinity };
    });
    this._dir = new THREE.Vector3();
    this._axis = new THREE.Vector3();
  }

  /**
   * Pushes the position out of anything it overlaps, along the surface. Mutates and
   * returns `pos`. Two passes: one resolution can shove the player into a neighbour.
   */
  resolve(pos) {
    const r = pos.length();
    if (r < 1e-6) return pos;

    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      this._dir.copy(pos).divideScalar(r);
      for (const c of this.items) {
        if (r > c.rTop) continue;
        // Angular separation, converted to a surface distance at this radius, so the
        // clearance means the same thing it did when it was measured in world units.
        const dot = Math.max(-1, Math.min(1, this._dir.dot(c.dir)));
        const arc = Math.acos(dot) * r;
        const min = c.r + cfg.playerRadius;
        if (arc >= min) continue;
        // Rotate away from the collider, about the axis through both, by the shortfall.
        this._axis.copy(c.dir).cross(this._dir);
        if (this._axis.lengthSq() < 1e-12) continue; // dead centre; nothing to push along
        this._axis.normalize();
        pos.applyAxisAngle(this._axis, (min - arc) / r);
        moved = true;
        this._dir.copy(pos).normalize();
      }
      if (!moved) break;
    }
    return pos;
  }
}
