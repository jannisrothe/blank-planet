import * as THREE from 'three';
import { createWorld } from './world.js';
import { createGround } from './terrain.js';
import { createControls } from './controls.js';
import { Colliders } from './collision.js';
import { InkMap } from './ink/inkMap.js';
import { applyInk, updateInkUniforms } from './ink/inkMaterial.js';
import { rng } from './scatter.js';
import { createFlowers } from './props/flowers.js';
import { createGrass } from './props/grass.js';
import { createTrees } from './props/trees.js';
import { createMushrooms, createReeds, createRocks } from './props/smallProps.js';
import { createComposer } from './post/composer.js';
import { Ambience } from './audio.js';
import { density } from './config.js';

// Debug tooling is opt-in via ?debug, so lil-gui and stats.js stay out of the
// production bundle entirely rather than shipping dead weight to every visitor.
const DEBUG = new URLSearchParams(location.search).has('debug');
const debugModule = DEBUG ? await import('./debug.js') : null;
debugModule?.applyDensityOverrides(density);

const { renderer, scene, camera } = createWorld();
const inkMap = new InkMap(renderer);
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

const overlay = document.getElementById('overlay');
const hint = document.getElementById('hint');

const ambience = new Ambience(camera);
ambience.load().catch((e) => console.warn('[audio] could not load the ambient bed:', e.message));

const { controls, update: updateControls, input } = createControls(camera, renderer.domElement, {
  colliders,
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
      : 'walk to spread the ink · it dries after a few seconds';
  },
});
overlay.addEventListener('click', () => controls.lock());

const timer = new THREE.Timer();
timer.connect(document); // pauses on tab switch, so returning does not dump one huge dt

const debug = debugModule?.createDebug({ post, inkMap, ambience }) ?? null;

let frameCount = 0;

function frame() {
  requestAnimationFrame(frame);
  debug?.begin();
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);

  updateControls(dt);
  if (!api.freeze) inkMap.update(camera.position.x, camera.position.z, dt, timer.getElapsed());
  updateInkUniforms(inkMap.texture);

  // Async readback, so this never stalls the pipeline. A few frames of latency is
  // inaudible, and sampling every frame would be pointless at a 0.6s smoothing time.
  if (++frameCount % 8 === 0) inkMap.sampleWetness();
  ambience.update(inkMap.wetness);

  post.render(dt);
  debug?.end();
}

// Hooks for scripts/measure.mjs. `freeze` lets the harness wipe the ink and confirm
// the world really does disappear, without the loop immediately re-inking underfoot.
const api = { renderer, scene, camera, inkMap, colliders, input, post, ambience, freeze: false };
globalThis.__inkGarden = api;

frame();
