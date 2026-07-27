import * as THREE from 'three';
import { applyInk } from '../ink/inkMaterial.js';
import { sample } from '../palette.js';
import { scatter } from '../scatter.js';
import { collision as col } from '../config.js';

/**
 * Trees keep real geometry (they need volume, unlike foliage cards) but become four
 * InstancedMeshes: one trunk plus three canopy shapes. The prototype built a THREE.Group
 * of two meshes per tree, so 60 trees cost 120 draw calls.
 *
 * Also returns collider circles, so collision.js never has to walk the scene graph.
 */

// All smooth and round. Faceted primitives and flatShading read as hard edges, which
// is exactly what this world is meant not to have.
const CANOPIES = [
  { geo: () => new THREE.ConeGeometry(1.1, 2.4, 28), y: 2.15, weight: 3 },
  { geo: () => new THREE.SphereGeometry(1.25, 22, 16), y: 2.6, weight: 4 },
  { geo: () => new THREE.SphereGeometry(1.2, 22, 16).scale(1, 0.72, 1), y: 2.5, weight: 3 },
];

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const SPAWN_CLEAR = 7; // world units around the origin kept free of trunks

export function createTrees(count, rand) {
  const spots = scatter(count, rand, 8, SPAWN_CLEAR);

  // Decide every tree's shape and size up front, so each InstancedMesh can be
  // allocated at exactly the count it needs.
  const totalWeight = CANOPIES.reduce((a, c) => a + c.weight, 0);
  const trees = spots.map((s) => {
    let roll = rand() * totalWeight;
    let kind = 0;
    while (kind < CANOPIES.length - 1 && roll > CANOPIES[kind].weight) {
      roll -= CANOPIES[kind].weight;
      kind++;
    }
    return {
      ...s,
      kind,
      scale: 0.75 + rand() * 0.95,
      spin: rand() * Math.PI * 2,
      canopyScale: [0.85 + rand() * 0.4, 0.85 + rand() * 0.45, 0.85 + rand() * 0.4],
    };
  });

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const spin = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const colour = new THREE.Color();

  const trunkMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.14, 0.24, 1.7, 16).translate(0, 0.85, 0),
    applyInk(new THREE.MeshLambertMaterial({ toneMapped: false })),
    trees.length,
  );

  trees.forEach((t, i) => {
    q.copy(t.quat).multiply(spin.setFromAxisAngle(Y_AXIS, t.spin));
    pos.copy(t.dir).multiplyScalar(t.radius);
    scl.setScalar(t.scale);
    trunkMesh.setMatrixAt(i, m.compose(pos, q, scl));
    trunkMesh.setColorAt(i, sample('trunk', rand, colour));
  });

  const canopyMeshes = CANOPIES.map((def, kind) => {
    const mine = trees.filter((t) => t.kind === kind);
    const mesh = new THREE.InstancedMesh(
      def.geo(),
      applyInk(new THREE.MeshLambertMaterial({ toneMapped: false })),
      mine.length,
    );
    mine.forEach((t, i) => {
      q.copy(t.quat).multiply(spin.setFromAxisAngle(Y_AXIS, t.spin));
      pos.copy(t.dir).multiplyScalar(t.radius + def.y * t.scale);
      scl.set(t.scale * t.canopyScale[0], t.scale * t.canopyScale[1], t.scale * t.canopyScale[2]);
      mesh.setMatrixAt(i, m.compose(pos, q, scl));
      mesh.setColorAt(i, sample('canopy', rand, colour));
    });
    return mesh;
  });

  const meshes = [trunkMesh, ...canopyMeshes];
  for (const mesh of meshes) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false; // instances span the world; the bounding sphere is useless
  }

  const colliders = trees.map((t) => ({ dir: t.dir, r: col.treeRadius * t.scale }));
  return { meshes, colliders };
}
