/**
 * mulberry32 — small, fast, seeded. Keeps the world identical between runs so density
 * and perf comparisons measure the change, not the dice.
 *
 * Lives on its own rather than in scatter.js because terrain.js needs it too, and
 * terrain <-> scatter would otherwise be an import cycle.
 */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
