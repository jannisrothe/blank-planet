import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyInk } from '../ink/inkMaterial.js';
import { sample } from '../palette.js';

/**
 * Vegetation is drawn as crossed quads: two intersecting cards so the plant reads from
 * every angle without needing to face the camera. That is what lets it be an
 * InstancedMesh at all -- the prototype used THREE.Sprite, which is camera-facing and
 * therefore one draw call each (500 flowers, 500 draws).
 *
 * Materials are unlit on purpose. A flat quad has a sideways normal, so lighting it
 * produces nonsense shading, and flat colour shapes are the right look for watercolour.
 */

let crossed = null;
function crossedQuad() {
  if (crossed) return crossed;
  const a = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  crossed = mergeGeometries([a, b]);
  a.dispose();
  b.dispose();
  return crossed;
}

/** Turn a canvas into a texture suitable for alpha-tested foliage. */
export function cardTexture(draw, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * @param {object} o
 * @param {THREE.Texture} o.texture
 * @param {Array<{x:number,z:number,y:number}>} o.spots
 * @param {() => number} o.rand
 * @param {string} o.mix palette mix name
 * @param {[number, number]} o.size scale range
 * @param {number} [o.yOffset] lift off the ground, in units of scale
 * @param {number} [o.lean] max random tilt in radians
 */
export function cardMesh({ texture, spots, rand, mix, size, yOffset = 0, lean = 0.12 }) {
  const material = applyInk(new THREE.MeshBasicMaterial({
    map: texture,
    alphaTest: 0.42,   // cuts holes in depth too, unlike blending, so no sorting needed
    side: THREE.DoubleSide,
    toneMapped: false,
  }));

  const mesh = new THREE.InstancedMesh(crossedQuad(), material, spots.length);
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();

  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    const k = size[0] + rand() * (size[1] - size[0]);
    e.set((rand() - 0.5) * lean, rand() * Math.PI * 2, (rand() - 0.5) * lean);
    q.setFromEuler(e);
    pos.set(s.x, s.y + yOffset * k, s.z);
    scl.set(k, k, k);
    m.compose(pos, q, scl);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, sample(mix, rand, col));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false; // instances span the world; the bounding sphere is useless
  return mesh;
}
