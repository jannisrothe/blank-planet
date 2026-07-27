import * as THREE from 'three';
import { cardTexture, cardMesh } from './cards.js';
import { applyInk } from '../ink/inkMaterial.js';
import { sample } from '../palette.js';
import { scatter } from '../scatter.js';
import { collision as col } from '../config.js';

const mushroomCap = (ctx, S) => {
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(S * 0.5, S * 0.52, S * 0.34, S * 0.28, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(S * 0.44, S * 0.5, S * 0.12, S * 0.36);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (const [x, y, r] of [[0.42, 0.4, 0.045], [0.58, 0.36, 0.035], [0.5, 0.46, 0.03]]) {
    ctx.beginPath();
    ctx.arc(x * S, y * S, r * S, 0, Math.PI * 2);
    ctx.fill();
  }
};

/** Reeds with rounded tips, stroked rather than filled to a point. */
const reed = (ctx, S) => {
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.04 * S;
  for (let i = 0; i < 4; i++) {
    const x = (0.3 + i * 0.14) * S;
    const lean = (i - 1.5) * 0.09 * S;
    ctx.beginPath();
    ctx.moveTo(x, S);
    ctx.quadraticCurveTo(x + lean * 0.5, S * 0.4, x + lean, S * 0.08);
    ctx.stroke();
  }
};

export function createMushrooms(count, rand) {
  return cardMesh({
    texture: cardTexture(mushroomCap),
    spots: scatter(count, rand),
    rand, mix: 'mushroom', size: [0.35, 0.75], lean: 0.14,
  });
}

export function createReeds(count, rand) {
  return cardMesh({
    texture: cardTexture(reed),
    spots: scatter(count, rand),
    rand, mix: 'reed', size: [1.3, 2.4], lean: 0.1,
  });
}

/** Low scattered stones. Smooth pebbles: a faceted rock is all edge. */
export function createRocks(count, rand) {
  const spots = scatter(count, rand, 6, 5);
  const mesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.5, 18, 12),
    applyInk(new THREE.MeshLambertMaterial({ toneMapped: false })),
    spots.length,
  );

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const colour = new THREE.Color();
  const colliders = [];

  const local = new THREE.Quaternion();
  spots.forEach((s, i) => {
    const k = 0.5 + rand() * 1.1;
    e.set(rand() * 0.5, rand() * Math.PI * 2, rand() * 0.5);
    pos.copy(s.dir).multiplyScalar(s.radius + k * 0.18);
    scl.set(k, k * (0.5 + rand() * 0.4), k);
    mesh.setMatrixAt(i, m.compose(pos, q.copy(s.quat).multiply(local.setFromEuler(e)), scl));
    mesh.setColorAt(i, sample('rock', rand, colour));
    colliders.push({ dir: s.dir, r: col.rockRadius * k });
  });

  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return { mesh, colliders };
}
