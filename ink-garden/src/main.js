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

scene.add(
  ...createFlowers(density.flowers, rand),
  ...createGrass(density.grass, rand),
  ...trees.meshes,
  createMushrooms(density.mushrooms, rand),
  createReeds(density.reeds, rand),
  rocks.mesh,
  createIslands(density.islands, rand),
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
});

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
    if (code === 'KeyM') hint.textContent = ambience.toggleMute()
      ? 'sound off · M to unmute'
      : 'click to drop pigment · it bleeds, dries, and stays';
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
  input: flight.input, heightAt, dropPigment, freeze: false,
};
globalThis.__inkGarden = api;

frame();
