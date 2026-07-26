import { WORLD_SIZE } from './config.js';
import { heightAt } from './terrain.js';

export { rng } from './random.js';

/**
 * Jittered grid rather than pure random. Pure random clumps and leaves bald patches,
 * which is very visible from the air where you take in a lot of ground at once.
 *
 * @param {number} count
 * @param {() => number} rand
 * @param {number} margin keep this far inside the world edge
 * @param {number} clearRadius keep this far off the spawn point
 * @returns {Array<{x:number, z:number, y:number}>}
 */
export function scatter(count, rand, margin = 6, clearRadius = 0) {
  const span = WORLD_SIZE - margin * 2;
  const cols = Math.ceil(Math.sqrt(count));
  const cell = span / cols;
  const out = [];

  for (let i = 0; i < count; i++) {
    const cx = i % cols;
    const cz = (i / cols) | 0;
    const x = -span / 2 + (cx + rand()) * cell;
    const z = -span / 2 + (cz + rand()) * cell;
    if (clearRadius && Math.hypot(x, z) < clearRadius) continue;
    out.push({ x, z, y: heightAt(x, z) });
  }
  return out;
}
