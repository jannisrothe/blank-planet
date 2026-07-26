import * as THREE from 'three';

export function createWorld() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0xffffff, 1);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);

  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 300);

  // Flat, bright, almost shadowless. Anything more dramatic fights the paper look.
  scene.add(new THREE.HemisphereLight(0xffffff, 0xdcdcdc, 2.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(20, 34, 12);
  scene.add(sun);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  return { renderer, scene, camera };
}
