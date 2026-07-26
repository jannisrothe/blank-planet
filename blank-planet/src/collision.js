import { collision as cfg } from './config.js';

/**
 * Circle-vs-circle push-out against a spatial hash. With thousands of colliders a
 * linear scan per frame would be wasteful, and a BVH library would be overkill for
 * what is really "don't walk through the trunk".
 */
export class Colliders {
  constructor(colliders, cellSize = null) {
    // The 3x3 neighbourhood lookup only finds a collider if the cell is at least as
    // wide as the largest radius, otherwise a big growth is missed from two cells away.
    const widest = colliders.reduce((a, c) => Math.max(a, c.r), 0);
    cellSize = cellSize ?? Math.max(4, Math.ceil(widest * 2));
    this.cell = cellSize;
    this.grid = new Map();
    for (const c of colliders) this.#insert(c);
  }

  #key(cx, cz) { return cx * 100003 + cz; }

  #insert(c) {
    const cx = Math.floor(c.x / this.cell);
    const cz = Math.floor(c.z / this.cell);
    const k = this.#key(cx, cz);
    const bucket = this.grid.get(k);
    if (bucket) bucket.push(c);
    else this.grid.set(k, [c]);
  }

  /**
   * Pushes the position out of anything it overlaps. Mutates and returns `pos`.
   * Two passes: one resolution can shove the player into a neighbouring obstacle.
   *
   * A collider with `yTop` only blocks below that height, so flying over a spire is
   * free while flying through it is not.
   */
  resolve(pos) {
    const cx = Math.floor(pos.x / this.cell);
    const cz = Math.floor(pos.z / this.cell);

    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      for (let ix = -1; ix <= 1; ix++) {
        for (let iz = -1; iz <= 1; iz++) {
          const bucket = this.grid.get(this.#key(cx + ix, cz + iz));
          if (!bucket) continue;
          for (const c of bucket) {
            if (c.yTop !== undefined && pos.y > c.yTop) continue;
            const dx = pos.x - c.x;
            const dz = pos.z - c.z;
            const min = c.r + cfg.playerRadius;
            const d2 = dx * dx + dz * dz;
            if (d2 >= min * min) continue;
            const d = Math.sqrt(d2) || 1e-4;
            pos.x = c.x + (dx / d) * min;
            pos.z = c.z + (dz / d) * min;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    return pos;
  }
}
