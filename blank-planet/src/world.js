import * as THREE from 'three';
import { PLANET_RADIUS, render } from './config.js';
import { ceiling } from './flight.js';

export function createWorld() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, render.pixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0xffffff, 1);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);

  // The far plane has to clear the far limb of the planet seen from the ceiling, or the
  // ground is clipped away and the whole thing renders as blank paper. A fixed 300 once
  // did exactly that, and every gate that asked "is the page white" passed because
  // nothing was being drawn at all.
  const far = (ceiling + PLANET_RADIUS * 2) * 1.3;
  // Near is well clear of 0.1 to buy back depth precision over that range. The chase
  // camera never gets closer than a few units to the moth, so nothing is lost.
  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.6, far);

  // Flat, bright, almost shadowless. Anything more dramatic fights the paper look.
  scene.add(new THREE.HemisphereLight(0xffffff, 0xf0f0f0, 3.0));
  const sun = new THREE.DirectionalLight(0xffffff, 0.55);
  sun.position.set(20, 34, 12);
  scene.add(sun);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  return { renderer, scene, camera };
}
