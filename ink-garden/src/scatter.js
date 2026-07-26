import { WORLD_SIZE } from './config.js';
import { heightAt } from './terrain.js';

/** mulberry32 — small, fast, seeded. Keeps the world identical between runs so
 *  density and perf comparisons in step 7 are measuring the change, not the dice. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Jittered grid rather than pure random. Pure random clumps and leaves bald patches,
 * which is very visible when the player only ever sees a 9 unit bubble at a time.
 *
 * @param {number} count
 * @param {() => number} rand
 * @param {number} margin keep this far inside the world edge
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
    // Keep solid objects off the spawn point, or the player opens their eyes inside a trunk.
    if (clearRadius && Math.hypot(x, z) < clearRadius) continue;
    out.push({ x, z, y: heightAt(x, z) });
  }
  return out;
}
