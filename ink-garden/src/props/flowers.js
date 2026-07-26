import { cardTexture, cardMesh } from './cards.js';
import { scatter } from '../scatter.js';

/**
 * Five flower shapes. Textures are drawn in near-white so the per-instance colour does
 * the tinting; centres are drawn warm so a tinted flower still reads as having a heart.
 */

const petals = (n, rx, ry, r) => (ctx, S) => {
  const c = S / 2;
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#ffffff';
  for (let p = 0; p < n; p++) {
    const a = (p / n) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(c + Math.cos(a) * r * S, c + Math.sin(a) * r * S, rx * S, ry * S, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#ffe6a8';
  ctx.beginPath();
  ctx.arc(c, c, 0.085 * S, 0, Math.PI * 2);
  ctx.fill();
};

/** clustered tiny blooms, like forget-me-nots */
const cluster = (ctx, S) => {
  ctx.clearRect(0, 0, S, S);
  const dots = [[0.5, 0.32, 0.1], [0.34, 0.5, 0.085], [0.66, 0.5, 0.085],
                [0.43, 0.68, 0.075], [0.6, 0.7, 0.07], [0.5, 0.5, 0.07]];
  for (const [x, y, r] of dots) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x * S, y * S, r * S, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffe6a8';
    ctx.beginPath();
    ctx.arc(x * S, y * S, r * S * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
};

/** a vertical spike of blossoms, like lupin or foxglove */
const spike = (ctx, S) => {
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 11; i++) {
    const t = i / 10;
    const y = (0.9 - t * 0.78) * S;
    const w = (0.14 - t * 0.09) * S;
    ctx.beginPath();
    ctx.ellipse(S / 2 + Math.sin(i * 2.2) * 0.05 * S, y, w, w * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
  }
};

/** a nodding bell */
const bell = (ctx, S) => {
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(S * 0.5, S * 0.22);
  ctx.quadraticCurveTo(S * 0.86, S * 0.4, S * 0.72, S * 0.78);
  ctx.quadraticCurveTo(S * 0.5, S * 0.9, S * 0.28, S * 0.78);
  ctx.quadraticCurveTo(S * 0.14, S * 0.4, S * 0.5, S * 0.22);
  ctx.fill();
  ctx.fillStyle = '#ffe6a8';
  ctx.beginPath();
  ctx.ellipse(S * 0.5, S * 0.8, S * 0.16, S * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
};

const SPECIES = [
  { draw: petals(5, 0.13, 0.075, 0.15), size: [0.7, 1.25], weight: 3 },
  { draw: petals(8, 0.09, 0.045, 0.17), size: [0.6, 1.05], weight: 2 },
  { draw: cluster, size: [0.5, 0.85], weight: 2 },
  { draw: spike, size: [1.1, 1.9], weight: 1 },
  { draw: bell, size: [0.6, 1.0], weight: 1 },
];

export function createFlowers(count, rand) {
  const total = SPECIES.reduce((a, s) => a + s.weight, 0);
  const spots = scatter(count, rand);
  const meshes = [];
  let cursor = 0;

  for (const sp of SPECIES) {
    const n = Math.round((sp.weight / total) * count);
    const slice = spots.slice(cursor, cursor + n);
    cursor += n;
    if (!slice.length) continue;
    meshes.push(cardMesh({
      texture: cardTexture(sp.draw),
      spots: slice,
      rand,
      mix: 'flower',
      size: sp.size,
      lean: 0.22,
    }));
  }
  return meshes;
}
