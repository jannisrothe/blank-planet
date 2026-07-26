import * as THREE from 'three';
import { WORLD_SIZE } from './config.js';

/**
 * Single source of truth for terrain height. The prototype had this formula written
 * twice (ink-garden-world.html:70 and :124-126), which is a drift waiting to happen.
 */
export function heightAt(x, z) {
  return Math.sin(x * 0.05) * 0.6 + Math.cos(z * 0.06) * 0.6;
}

/** Procedural grass texture, drawn once. No external assets. */
function grassTexture(size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#a9d18e');
  grad.addColorStop(0.5, '#8fc47a');
  grad.addColorStop(1, '#7fb768');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // soft mottling so large flat areas do not read as a solid fill
  for (let i = 0; i < 220; i++) {
    const r = 40 + Math.random() * 120;
    const g2 = ctx.createRadialGradient(
      Math.random() * size, Math.random() * size, 0,
      Math.random() * size, Math.random() * size, r,
    );
    g2.addColorStop(0, `rgba(${110 + Math.random() * 40 | 0},${160 + Math.random() * 40 | 0},90,0.10)`);
    g2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, size, size);
  }

  ctx.strokeStyle = 'rgba(60,110,50,0.22)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5000; i++) {
    const x = Math.random() * size, y = Math.random() * size, h = 4 + Math.random() * 9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 4, y - h);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createGround() {
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 160, 160);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'ground';
  return mesh;
}
