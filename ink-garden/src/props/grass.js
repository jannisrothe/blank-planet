import { cardTexture, cardMesh } from './cards.js';
import { scatter } from '../scatter.js';

/** A tuft of tapered blades, drawn white so per-instance colour tints it. */
const tuft = (ctx, S) => {
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#ffffff';
  const blades = 7;
  for (let i = 0; i < blades; i++) {
    const t = i / (blades - 1);
    const baseX = (0.22 + t * 0.56) * S;
    const lean = (t - 0.5) * 0.42 * S;
    const h = (0.55 + Math.sin(i * 1.7) * 0.2 + 0.2) * S;
    const w = 0.035 * S;
    ctx.beginPath();
    ctx.moveTo(baseX - w, S);
    ctx.quadraticCurveTo(baseX + lean * 0.4, S - h * 0.55, baseX + lean, S - h);
    ctx.quadraticCurveTo(baseX + lean * 0.4, S - h * 0.5, baseX + w, S);
    ctx.fill();
  }
};

/** Low ground cover so the terrain never reads as bare texture inside a bloom. */
const clump = (ctx, S) => {
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 14; i++) {
    const x = (0.1 + Math.random() * 0.8) * S;
    const y = (0.6 + Math.random() * 0.35) * S;
    ctx.beginPath();
    ctx.ellipse(x, y, 0.07 * S, 0.045 * S, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
};

export function createGrass(count, rand) {
  const spots = scatter(count, rand);
  const split = Math.floor(spots.length * 0.72);
  return [
    cardMesh({
      texture: cardTexture(tuft),
      spots: spots.slice(0, split),
      rand, mix: 'grass', size: [0.7, 1.5], lean: 0.16,
    }),
    cardMesh({
      texture: cardTexture(clump),
      spots: spots.slice(split),
      rand, mix: 'grass', size: [0.6, 1.1], lean: 0.1,
    }),
  ];
}
