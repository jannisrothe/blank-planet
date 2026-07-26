import * as THREE from 'three';
import { createWorld } from './world.js';
import { createGround, heightAt } from './terrain.js';
import { createFlight } from './flight.js';
import { Colliders } from './collision.js';
import { PaintMap } from './ink/paintMap.js';
import { applyInk, updateInkUniforms } from './ink/inkMaterial.js';
import { rng } from './random.js';
import { samplePigment } from './palette.js';
import { createFlowers } from './props/flowers.js';
import { createGrass } from './props/grass.js';
import { createTrees } from './props/trees.js';
import { createMushrooms, createReeds, createRocks } from './props/smallProps.js';
import { createMoth } from './props/moth.js';
import { Droplets } from './props/droplets.js';
import { createIslands, createArches, createGrowths, createSpires } from './props/features.js';
import { createLifeforms } from './props/lifeforms.js';
import { Hittables } from './hittables.js';
import { createComposer } from './post/composer.js';
import { Ambience } from './audio.js';
import { density, droplet as dropCfg } from './config.js';

// Debug tooling is opt-in via ?debug, so lil-gui and stats.js stay out of the
// production bundle entirely rather than shipping dead weight to every visitor.
const DEBUG = new URLSearchParams(location.search).has('debug');
const debugModule = DEBUG ? await import('./debug.js') : null;
debugModule?.applyDensityOverrides(density);

const { renderer, scene, camera } = createWorld();
const paint = new PaintMap(renderer);
const post = createComposer(renderer, scene, camera);

const ground = createGround();
applyInk(ground.material);
scene.add(ground);

// One seed for the whole world, so perf comparisons between runs measure the change
// and not a different random layout.
const rand = rng(20260726);

const trees = createTrees(density.trees, rand);
const rocks = createRocks(density.rocks, rand);
const growths = createGrowths(density.growths, rand);
const spires = createSpires(density.spires, rand);
const life = createLifeforms(density, rand);
const islands = createIslands(density.islands, rand);

// Everything in the air carries its own colour and is hit directly. The world paint map
// is indexed by XZ alone, so left to itself it paints the whole column above a splat.
const hittables = new Hittables();
hittables.add(islands.mesh, islands.items);
for (const layer of life.airborne) hittables.add(layer.mesh, layer.items);

scene.add(
  ...life.meshes,
  ...createFlowers(density.flowers, rand),
  ...createGrass(density.grass, rand),
  ...trees.meshes,
  createMushrooms(density.mushrooms, rand),
  createReeds(density.reeds, rand),
  rocks.mesh,
  islands.mesh,
  createArches(density.arches, rand),
  growths.mesh,
  spires.mesh,
);

// Only the tall alien features block flight. Trees and rocks are far below cruising
// altitude, so colliding with them would stop the moth in mid air over nothing.
const colliders = new Colliders([...growths.colliders, ...spires.colliders]);

const moth = createMoth();
scene.add(moth.root);

const overlay = document.getElementById('overlay');
const hint = document.getElementById('hint');

// W and S have always worked, but over a world with nothing to gauge motion against
// there was no way to tell. The number is the confirmation.
let hintBase = hint.textContent;
let shownSpeed = -1;
function showSpeed(speed) {
  const s = Math.round(speed);
  if (s === shownSpeed) return;
  shownSpeed = s;
  hint.textContent = `${hintBase} · speed ${s}`;
}

const ambience = new Ambience(camera);
ambience.load().catch((e) => console.warn('[audio] could not load the ambient bed:', e.message));

// Paint is thrown, not teleported: a droplet is released from the moth with its own
// velocity, falls under gravity, and only stamps a splat when it actually lands. The
// splat is thrown downrange along the impact direction, so it reads as a hit.
// The moth carries its next colour visibly, so you know what you are about to throw
// before you throw it. Picked ahead of time, shown on the sac, replaced after each shot.
const nextColor = new THREE.Color();
function loadNextColor() {
  samplePigment(Math.random, nextColor);
  moth.setNextColor(nextColor);
}
loadNextColor();

const impactDir = new THREE.Vector2();

const droplets = new Droplets(scene, (x, y, z, color, vel) => {
  impactDir.set(vel.x, vel.z);
  if (impactDir.lengthSq() < 1e-4) impactDir.set(1, 0);
  // Faster impacts throw wider splats.
  const scale = 0.75 + Math.min(1.4, vel.length() / 42);
  paint.splat(x, z, color, impactDir, scale);
}, hittables);

const releaseVel = new THREE.Vector3();
const releasePos = new THREE.Vector3();
function dropPigment() {
  const st = flight.state;
  releasePos.copy(st.pos).y -= 1.2;
  releaseVel.set(
    -Math.sin(st.yaw) * (st.speed + dropCfg.throwSpeed),
    -2,
    -Math.cos(st.yaw) * (st.speed + dropCfg.throwSpeed),
  );
  droplets.spawn(releasePos, releaseVel, nextColor);
  loadNextColor();
}

const flight = createFlight(camera, renderer.domElement, {
  moth,
  colliders,
  onDrop: dropPigment,
  onLock: () => {
    overlay.classList.add('hidden');
    hint.classList.remove('hidden');
    ambience.start();
  },
  onUnlock: () => {
    overlay.classList.remove('hidden');
    hint.classList.add('hidden');
    ambience.stop();
  },
  onKey: (code) => {
    if (code === 'KeyM') {
      hintBase = ambience.toggleMute()
        ? 'sound off · M to unmute'
        : 'click to throw paint · it covers and it stays';
      shownSpeed = -1; // force the readout to redraw against the new text
    }
  },
});
overlay.addEventListener('click', () => {
  // Start audio on the click itself. It is the real user gesture, and pointer lock can
  // be refused independently, which would otherwise leave the page silent.
  ambience.start();
  flight.lock();
});

const timer = new THREE.Timer();
timer.connect(document); // pauses on tab switch, so returning does not dump one huge dt

const debug = debugModule?.createDebug({ post, paint, ambience }) ?? null;

let frameCount = 0;

function frame() {
  requestAnimationFrame(frame);
  debug?.begin();
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);
  const elapsed = timer.getElapsed();

  flight.update(dt, elapsed);
  showSpeed(flight.state.speed);
  life.update(elapsed);
  droplets.update(dt);
  updateInkUniforms(paint.texture);

  // Async readback, so this never stalls the pipeline. A few frames of latency is
  // inaudible, and sampling every frame would be pointless at a 0.6s smoothing time.
  if (++frameCount % 12 === 0) paint.sampleCoverage(flight.state.pos.x, flight.state.pos.z);
  ambience.update(paint.coverage);

  post.render(dt);
  debug?.end();
}

// Hooks for scripts/measure.mjs. `freeze` lets the harness wipe the ink and confirm
// the world really does disappear, without the loop immediately re-inking underfoot.
const api = {
  renderer, scene, camera, paint, droplets, colliders, post, ambience, moth, flight,
  hittables,
  input: flight.input, heightAt, dropPigment, freeze: false,
  // Pigment now lives in two places. Anything asserting "the page is blank" has to wipe
  // both, or it passes while a painted island is still sitting in frame.
  clearPigment: () => { paint.clear(); hittables.clear(); },
};
globalThis.__blankPlanet = api;

frame();
