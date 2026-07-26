import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { WORLD_SIZE, EYE_HEIGHT, WALK_SPEED, RUN_SPEED } from './config.js';
import { heightAt } from './terrain.js';

export function createControls(camera, domElement, { colliders, onLock, onUnlock, onKey }) {
  const controls = new PointerLockControls(camera, domElement);
  const keys = Object.create(null);
  const scratch = new THREE.Vector3();

  addEventListener('keydown', (e) => {
    keys[e.code] = true;
    onKey?.(e.code);
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  // Held keys would otherwise stick down when the tab loses focus mid-stride.
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  controls.addEventListener('lock', () => onLock?.());
  controls.addEventListener('unlock', () => onUnlock?.());

  camera.position.set(0, heightAt(0, 0) + EYE_HEIGHT, 0);

  function update(dt) {
    if (!controls.isLocked) return;

    const forward = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    const right = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    const speed = (keys.ShiftLeft || keys.ShiftRight ? RUN_SPEED : WALK_SPEED) * dt;

    // Normalise so walking diagonally is not faster than walking straight.
    const len = Math.hypot(forward, right) || 1;
    controls.moveForward((forward / len) * speed);
    controls.moveRight((right / len) * speed);

    scratch.copy(camera.position);
    colliders?.resolve(scratch);

    const half = WORLD_SIZE / 2 - 4;
    camera.position.x = Math.min(half, Math.max(-half, scratch.x));
    camera.position.z = Math.min(half, Math.max(-half, scratch.z));
    camera.position.y = heightAt(camera.position.x, camera.position.z) + EYE_HEIGHT;
  }

  return { controls, update, lock: () => controls.lock() };
}
