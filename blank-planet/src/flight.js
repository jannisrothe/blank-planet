import * as THREE from 'three';
import { flight as cfg } from './config.js';
import { radiusAt, terrainMax, SPAWN_DIR } from './terrain.js';

/**
 * Constant-drift flight over a sphere. You are always moving forward; the mouse only
 * chooses where forward is. There is no stall, no way to get stuck, and now no edge --
 * hold a heading and you come back to where you started.
 *
 * The state that makes that work is a **tangent** vector plus a scalar pitch, rather than
 * a yaw/pitch Euler. On a plane, up never changes, so an Euler is enough. On a sphere, up
 * turns underneath you as you travel: a heading fixed in world space would gradually point
 * into the ground on one side of the planet and into space on the other, and the altitude
 * clamp would spend the whole flight fighting it. Re-projecting the tangent onto the local
 * tangent plane every frame is parallel transport, and it is what keeps a held heading on
 * a great circle.
 */
export const ceiling = terrainMax + cfg.ceiling;

export function createFlight(camera, domElement, { moth, colliders, onLock, onUnlock, onKey, onDrop }) {
  const up = SPAWN_DIR.clone();
  const state = {
    pos: SPAWN_DIR.clone().multiplyScalar(radiusAt(SPAWN_DIR) + cfg.spawnAltitude),
    // Any unit vector perpendicular to up will do for a starting heading.
    tangent: new THREE.Vector3(1, 0, 0),
    pitch: -0.10,
    targetPitch: -0.10,
    turn: 0,          // pending yaw from the mouse, applied about the local up
    speed: cfg.driftSpeed,
    locked: false,
    up,
    forward: new THREE.Vector3(1, 0, 0),
  };

  // Inert unless a test sets `active`. Chrome revokes pointer lock within seconds under
  // automation, so the harness cannot drive the player through it.
  const input = { active: false, trim: 0, turn: 0, climb: 0 };

  const keys = Object.create(null);
  const _up = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _basis = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _camWant = new THREE.Vector3();
  const _look = new THREE.Vector3();
  const _back = new THREE.Vector3();
  const _bankQ = new THREE.Quaternion();
  const _zAxis = new THREE.Vector3(0, 0, 1);

  function onMouseMove(e) {
    if (!state.locked) return;
    state.turn -= e.movementX * cfg.turnRate;
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

  /** Rebuild up/tangent/forward for the current position. */
  function frame() {
    _up.copy(state.pos).normalize();
    state.up.copy(_up);
    // Parallel transport: strip whatever component of the heading now points along up.
    state.tangent.addScaledVector(_up, -state.tangent.dot(_up));
    if (state.tangent.lengthSq() < 1e-8) state.tangent.set(1, 0, 0).cross(_up);
    state.tangent.normalize();
    state.forward.copy(state.tangent).multiplyScalar(Math.cos(state.pitch))
      .addScaledVector(_up, Math.sin(state.pitch));
  }
  frame();

  // Until the player enters, update() returns early and never touches the camera, so
  // without this the entry screen renders from the world origin, inside the planet.
  function placeCamera(instant) {
    _camWant.copy(state.pos)
      .addScaledVector(state.up, cfg.camUp)
      .addScaledVector(state.forward, -cfg.camBack);
    if (instant) camera.position.copy(_camWant);
    camera.up.copy(state.up);
    _look.copy(state.pos).addScaledVector(state.up, -2.2);
    camera.lookAt(_look);
  }
  placeCamera(true);

  function update(dt, elapsed) {
    const driven = input.active;
    if (!state.locked && !driven) return;

    if (driven) {
      state.turn += input.turn * dt * 60 * cfg.turnRate * 12;
      state.targetPitch = Math.max(-cfg.maxPitch,
        Math.min(cfg.maxPitch, state.targetPitch + input.climb * dt));
    }

    // Heavy smoothing is what makes it feel like drifting rather than a shooter.
    // Frame-rate independent, so it feels the same at 30fps.
    const k = 1 - Math.exp(-cfg.smoothing * dt);
    const yaw = state.turn * k;
    state.turn -= yaw;
    state.pitch += (state.targetPitch - state.pitch) * k;

    frame();
    if (yaw) {
      state.tangent.applyAxisAngle(state.up, yaw).normalize();
      state.forward.copy(state.tangent).multiplyScalar(Math.cos(state.pitch))
        .addScaledVector(state.up, Math.sin(state.pitch));
    }

    const trim = driven ? input.trim : (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    state.speed = Math.max(cfg.minSpeed,
      Math.min(cfg.maxSpeed, state.speed + trim * cfg.trimRate * dt));

    state.pos.addScaledVector(state.forward, state.speed * dt);

    // No world bounds. Going far enough in one direction is meant to bring you back.
    colliders?.resolve(state.pos);
    const surface = radiusAt(state.pos);
    const r = state.pos.length();
    if (r > surface + cfg.ceiling) state.pos.setLength(surface + cfg.ceiling);
    if (r < surface + cfg.groundClearance) {
      state.pos.setLength(surface + cfg.groundClearance);
      // Nose up rather than grinding along the ground.
      state.targetPitch = Math.max(state.targetPitch, 0.12);
    }
    frame();

    // Moth sits at the flight position, banking into the turn. Its basis is built
    // explicitly rather than with lookAt, whose axis convention differs between cameras
    // and everything else: travel is local -Z, up is local +Y, and right is forward x up.
    _right.copy(state.forward).cross(state.up).normalize();
    _up.copy(state.up);
    _basis.makeBasis(_right, _up, _back.copy(state.forward).negate());
    _q.setFromRotationMatrix(_basis);
    const bank = Math.max(-0.6, Math.min(0.6, state.turn * 7));
    moth.root.quaternion.copy(_q).multiply(_bankQ.setFromAxisAngle(_zAxis, bank));
    moth.root.position.copy(state.pos);
    moth.flap(elapsed, Math.min(1, Math.max(0, state.pitch * 1.6 + 0.4)));

    // Chase camera, lagging behind so turns have some weight.
    _camWant.copy(state.pos)
      .addScaledVector(state.up, cfg.camUp)
      .addScaledVector(state.forward, -cfg.camBack);
    const ck = 1 - Math.exp(-cfg.camLag * dt);
    camera.position.lerp(_camWant, ck);
    // The camera trails the moth, so clearing an obstacle with the moth is not enough:
    // it has to be pushed out too, or the view ends up inside the spire.
    colliders?.resolve(camera.position);
    const camSurface = radiusAt(camera.position) + 2.0;
    if (camera.position.length() < camSurface) camera.position.setLength(camSurface);
    camera.up.copy(state.up);
    _look.copy(state.pos).addScaledVector(state.up, -2.2);
    camera.lookAt(_look);
  }

  return {
    update,
    input,
    state,
    /** Altitude above the surface directly below. */
    get altitude() { return state.pos.length() - radiusAt(state.pos); },
    // Chrome rejects this outright in some contexts (and always under automation).
    // Swallow it: the page is still usable, it just is not mouse-steered.
    lock: () => Promise.resolve(domElement.requestPointerLock()).catch(() => {}),
    get isLocked() { return state.locked; },
  };
}
