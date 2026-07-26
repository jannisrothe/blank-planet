import * as THREE from 'three';
import { createWorld } from './world.js';
import { createGround, heightAt } from './terrain.js';
import { createFlight } from './flight.js';
import { Colliders } from './collision.js';
import { PigmentSim } from './ink/pigmentSim.js';
import { applyInk, updateInkUniforms } from './ink/inkMaterial.js';
import { rng } from './random.js';
import { samplePigment } from './palette.js';
import { createFlowers } from './props/flowers.js';
import { createGrass } from './props/grass.js';
import { createTrees } from './props/trees.js';
import { createMushrooms, createReeds, createRocks } from './props/smallProps.js';
import { createMoth } from './props/moth.js';
import { createComposer } from './post/composer.js';
import { Ambience } from './audio.js';
import { density } from './config.js';

// Debug tooling is opt-in via ?debug, so lil-gui and stats.js stay out of the
// production bundle entirely rather than shipping dead weight to every visitor.
const DEBUG = new URLSearchParams(location.search).has('debug');
const debugModule = DEBUG ? await import('./debug.js') : null;
debugModule?.applyDensityOverrides(density);

const { renderer, scene, camera } = createWorld();
const pigment = new PigmentSim(renderer);
const post = createComposer(renderer, scene, camera);

const ground = createGround();
applyInk(ground.material);
scene.add(ground);

// One seed for the whole world, so perf comparisons between runs measure the change
// and not a different random layout.
const rand = rng(20260726);

const trees = createTrees(density.trees, rand);
const rocks = createRocks(density.rocks, rand);

scene.add(
  ...createFlowers(density.flowers, rand),
  ...createGrass(density.grass, rand),
  ...trees.meshes,
  createMushrooms(density.mushrooms, rand),
  createReeds(density.reeds, rand),
  rocks.mesh,
);

const colliders = new Colliders([...trees.colliders, ...rocks.colliders]);

const moth = createMoth();
scene.add(moth.root);

const overlay = document.getElementById('overlay');
const hint = document.getElementById('hint');

const ambience = new Ambience(camera);
ambience.load().catch((e) => console.warn('[audio] could not load the ambient bed:', e.message));

// Pigment falls from the moth, so a drop lands beneath it, slightly ahead along the
// heading the way anything released from a moving body would. Aiming down a crosshair
// was the first attempt and it was unusable: the chase camera looks near-horizontal, so
// the ray met the ground about 200 units away, well outside the frame.
const dropColor = new THREE.Color();
function dropPoint() {
  const p = flight.state.pos;
  const lead = Math.min(18, flight.state.speed * 0.9);
  return {
    x: p.x - Math.sin(flight.state.yaw) * lead,
    z: p.z - Math.cos(flight.state.yaw) * lead,
  };
}
function dropPigment() {
  const { x, z } = dropPoint();
  pigment.drop(x, z, samplePigment(Math.random, dropColor));
}

const flight = createFlight(camera, renderer.domElement, {
  moth,
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
      : 'click to drop pigment · W and S change speed';
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

const debug = debugModule?.createDebug({ post, pigment, ambience }) ?? null;

let frameCount = 0;

function frame() {
  requestAnimationFrame(frame);
  debug?.begin();
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);
  const elapsed = timer.getElapsed();

  flight.update(dt, elapsed);
  if (!api.freeze) pigment.update(dt);
  updateInkUniforms(pigment.wetTexture, pigment.dryTexture);

  // Async readback, so this never stalls the pipeline. A few frames of latency is
  // inaudible, and sampling every frame would be pointless at a 0.6s smoothing time.
  if (++frameCount % 8 === 0) pigment.sampleWetness();
  ambience.update(pigment.wetness);

  post.render(dt);
  debug?.end();
}

// Hooks for scripts/measure.mjs. `freeze` lets the harness wipe the ink and confirm
// the world really does disappear, without the loop immediately re-inking underfoot.
const api = {
  renderer, scene, camera, pigment, colliders, post, ambience, moth, flight,
  input: flight.input, heightAt, dropPigment, dropPoint, freeze: false,
};
globalThis.__inkGarden = api;

frame();
