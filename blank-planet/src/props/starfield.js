import * as THREE from 'three';
import { PLANET_RADIUS, space as cfg } from '../config.js';
import { rng } from '../random.js';

/**
 * Space, around the planet.
 *
 * A sky sphere seen from the inside rather than a cube map, because the whole background
 * is generated and one 2:1 canvas is simpler than six faces that have to agree at their
 * seams. It sits well outside the flight ceiling and renders first with depth writing
 * off, so nothing can ever clip through it and it costs no depth bandwidth.
 *
 * Stars are drawn into a canvas rather than instanced as geometry. At these counts that
 * is one texture and one draw call instead of thousands of quads, and a star that is a
 * texel is exactly as convincing as a star that is a billboard.
 */

function skyTexture(size, rand) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size / 2;
  const ctx = c.getContext('2d');
  ctx.fillStyle = cfg.background;
  ctx.fillRect(0, 0, c.width, c.height);

  // Faint dust, so the sky is not an even field of dots. Many small patches rather than
  // a few large ones: a gradient wide enough to span a good fraction of the texture maps
  // onto the sphere as a hard-edged wedge, which is what a first pass at this looked like.
  for (let i = 0; i < cfg.dustBands; i++) {
    const x = rand() * c.width;
    const y = (Math.asin(rand() * 2 - 1) / Math.PI + 0.5) * c.height;
    const r = c.width * (0.02 + rand() * 0.05);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(150,170,220,${0.03 + rand() * 0.035})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < cfg.stars; i++) {
    // Uniform on the sphere means uniform in sin(latitude), not in latitude: stepping
    // the pixel row directly would crowd every star toward the poles.
    const x = rand() * c.width;
    const y = (Math.asin(rand() * 2 - 1) / Math.PI + 0.5) * c.height;
    const r = cfg.starSize[0] + rand() ** 3 * (cfg.starSize[1] - cfg.starSize[0]);
    // Mostly white, some warm, some cold. Real starfields are not monochrome and the
    // difference is what stops it reading as noise.
    const t = rand();
    const tint = t < 0.12 ? [255, 214, 180] : t < 0.22 ? [190, 214, 255] : [255, 255, 255];
    const a = 0.25 + rand() ** 2 * 0.75;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${tint[0]},${tint[1]},${tint[2]},${a})`);
    g.addColorStop(0.5, `rgba(${tint[0]},${tint[1]},${tint[2]},${a * 0.25})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** A distant world, drawn flat. It is scenery, not a place, so it takes no lighting. */
function planetGeometry() {
  return new THREE.SphereGeometry(1, 32, 24);
}

export function createStarfield() {
  const group = new THREE.Group();
  const rand = rng(cfg.seed);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(cfg.radius, 48, 32),
    new THREE.MeshBasicMaterial({
      map: skyTexture(cfg.textureSize, rand),
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );
  // Ahead of everything, and it writes no depth, so the planet always wins.
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  group.add(sky);

  // A handful of other worlds, far enough out to sit against the stars but inside the
  // sky shell. Deliberately plain: they are something to look at, not somewhere to go.
  const geo = planetGeometry();
  for (let i = 0; i < cfg.planets; i++) {
    const u = rand() * 2 - 1;
    const phi = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const dir = new THREE.Vector3(s * Math.cos(phi), u, s * Math.sin(phi));
    const dist = cfg.radius * (0.45 + rand() * 0.35);
    const size = PLANET_RADIUS * (0.10 + rand() * 0.28);
    const shade = 0.28 + rand() * 0.5;
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(rand(), 0.10 + rand() * 0.2, shade),
      toneMapped: false,
      fog: false,
    }));
    mesh.position.copy(dir).multiplyScalar(dist);
    mesh.scale.setScalar(size);
    mesh.renderOrder = -900;
    group.add(mesh);
  }

  return group;
}
