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
import { density } from './config.js';

const { renderer, scene, camera } = createWorld();
const inkMap = new InkMap(renderer);

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

const { controls, update: updateControls } = createControls(camera, renderer.domElement, {
  colliders,
  onLock: () => { overlay.classList.add('hidden'); hint.classList.remove('hidden'); },
  onUnlock: () => { overlay.classList.remove('hidden'); hint.classList.add('hidden'); },
});
overlay.addEventListener('click', () => controls.lock());

const timer = new THREE.Timer();
timer.connect(document); // pauses on tab switch, so returning does not dump one huge dt

function frame() {
  requestAnimationFrame(frame);
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);

  updateControls(dt);
  if (!api.freeze) inkMap.update(camera.position.x, camera.position.z, dt, timer.getElapsed());
  updateInkUniforms(inkMap.texture);

  renderer.render(scene, camera);
}

// Hooks for scripts/measure.mjs. `freeze` lets the harness wipe the ink and confirm
// the world really does disappear, without the loop immediately re-inking underfoot.
const api = { renderer, scene, camera, inkMap, colliders, freeze: false };
globalThis.__inkGarden = api;

frame();
