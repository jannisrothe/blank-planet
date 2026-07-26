import * as THREE from 'three';
import { WORLD_SIZE, flight as cfg } from './config.js';
import { heightAt } from './terrain.js';

/**
 * Constant-drift flight. You are always moving forward; the mouse only chooses where
 * forward is. There is no stall and no way to get stuck, which suits a moth and suits a
 * mechanic where the real interaction is choosing where to drop pigment.
 *
 * Replaces v1's PointerLockControls WASD walking.
 */
export function createFlight(camera, domElement, { moth, onLock, onUnlock, onKey, onDrop }) {
  const state = {
    pos: new THREE.Vector3(0, heightAt(0, 0) + 34, 0),
    yaw: 0,
    pitch: -0.34,
    targetYaw: 0,
    targetPitch: -0.34,
    speed: cfg.driftSpeed,
    locked: false,
  };

  // Inert unless a test sets `active`. Chrome revokes pointer lock within seconds under
  // automation, so the harness cannot drive the player through it.
  const input = { active: false, trim: 0, turn: 0, climb: 0 };

  const keys = Object.create(null);
  const forward = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');

  function onMouseMove(e) {
    if (!state.locked) return;
    state.targetYaw -= e.movementX * cfg.turnRate;
    state.targetPitch -= e.movementY * cfg.turnRate;
    state.targetPitch = Math.max(-cfg.maxPitch, Math.min(cfg.maxPitch, state.targetPitch));
  }

  function onPointerLockChange() {
    state.locked = document.pointerLockElement === domElement;
    (state.locked ? onLock : onUnlock)?.();
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  addEventListener('keydown', (e) => { keys[e.code] = true; onKey?.(e.code); });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  domElement.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (state.locked) onDrop?.();
  });

  function update(dt, elapsed) {
    const driven = input.active;
    if (!state.locked && !driven) return;

    if (driven) {
      state.targetYaw += input.turn * dt;
      state.targetPitch = Math.max(-cfg.maxPitch,
        Math.min(cfg.maxPitch, state.targetPitch + input.climb * dt));
    }

    // Heavy smoothing on the look direction is what makes it feel like drifting rather
    // than a first-person shooter. Frame-rate independent, so it feels the same at 30fps.
    const k = 1 - Math.exp(-cfg.smoothing * dt);
    state.yaw += (state.targetYaw - state.yaw) * k;
    state.pitch += (state.targetPitch - state.pitch) * k;

    const trim = driven ? input.trim : (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    state.speed = Math.max(cfg.minSpeed,
      Math.min(cfg.maxSpeed, state.speed + trim * cfg.trimRate * dt));

    euler.set(state.pitch, state.yaw, 0);
    forward.set(0, 0, -1).applyEuler(euler);
    state.pos.addScaledVector(forward, state.speed * dt);

    // Stay inside the sheet, and never clip through the land.
    const half = WORLD_SIZE / 2 - 6;
    state.pos.x = Math.min(half, Math.max(-half, state.pos.x));
    state.pos.z = Math.min(half, Math.max(-half, state.pos.z));
    const floor = heightAt(state.pos.x, state.pos.z) + cfg.groundClearance;
    if (state.pos.y < floor) {
      state.pos.y = floor;
      // Nose up rather than grinding along the ground.
      state.targetPitch = Math.max(state.targetPitch, 0.12);
    }
    state.pos.y = Math.min(state.pos.y, cfg.ceiling);

    // Moth sits at the flight position, banking into the turn.
    const bank = (state.targetYaw - state.yaw) * 7;
    moth.root.position.copy(state.pos);
    moth.root.rotation.set(state.pitch, state.yaw, Math.max(-0.6, Math.min(0.6, bank)));
    moth.flap(elapsed, Math.min(1, Math.max(0, state.pitch * 1.6 + 0.4)));

    // Chase camera, lagging behind so turns have some weight.
    const back = new THREE.Vector3(0, cfg.camUp, cfg.camBack).applyEuler(euler);
    const want = state.pos.clone().add(back);
    const ck = 1 - Math.exp(-cfg.camLag * dt);
    camera.position.lerp(want, ck);
    camera.position.y = Math.max(camera.position.y,
      heightAt(camera.position.x, camera.position.z) + 2.0);
    // Aim slightly below the moth, so the ground you are painting fills the frame.
    camera.lookAt(state.pos.x, state.pos.y - 2.2, state.pos.z);
  }

  return {
    update,
    input,
    state,
    // Chrome rejects this outright in some contexts (and always under automation).
    // Swallow it: the page is still usable, it just is not mouse-steered.
    lock: () => Promise.resolve(domElement.requestPointerLock()).catch(() => {}),
    get isLocked() { return state.locked; },
  };
}
