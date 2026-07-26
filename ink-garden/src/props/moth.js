import * as THREE from 'three';

/**
 * The moth you fly as. Procedural, no assets.
 *
 * Deliberately NOT ink-washed. Every other material fades to paper white where there is
 * no pigment; if the moth did that too it would vanish against blank paper and you would
 * have nothing to fly. It keeps its own dusty colouring at all times.
 */

const WING = [
  // outline of one forewing, in units of body length, traced clockwise from the root
  [0.05, 0.15], [0.55, 0.62], [1.25, 0.78], [1.75, 0.55],
  [1.85, 0.12], [1.45, -0.18], [0.75, -0.28], [0.18, -0.1],
];
const HIND = [
  [0.05, -0.05], [0.5, -0.35], [1.0, -0.6], [1.25, -0.95],
  [0.95, -1.15], [0.45, -0.95], [0.12, -0.45],
];

function wingGeometry(points) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i];
    const [px, py] = points[i - 1];
    shape.quadraticCurveTo((px + x) / 2 + (y - py) * 0.12, (py + y) / 2 - (x - px) * 0.12, x, y);
  }
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape, 28);
  geo.rotateX(-Math.PI / 2); // shapes are built in XY; the wing lies in the XZ plane
  return geo;
}

function wingTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  // Dark on purpose. The whole world is white paper, so a pale moth disappears; an
  // inky one reads as a brush mark against the sheet.
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, '#3b2f52');
  g.addColorStop(0.5, '#5b3f6e');
  g.addColorStop(1, '#241d33');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // eyespots and dusting, so the wing is not a flat panel
  ctx.fillStyle = 'rgba(255,120,190,0.55)';
  ctx.beginPath();
  ctx.arc(size * 0.66, size * 0.42, size * 0.11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,240,180,0.85)';
  ctx.beginPath();
  ctx.arc(size * 0.66, size * 0.42, size * 0.045, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(20,12,32,0.30)';
  for (let i = 0; i < 200; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 22, y + (Math.random() - 0.5) * 22);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createMoth() {
  const root = new THREE.Group();
  // Parts hang off an inner rig so the idle bob can move them without touching
  // root.position, which flight.js owns.
  const rig = new THREE.Group();
  // The parts below are laid out nose-toward +Z, but flight.js travels along the root's
  // local -Z (`forward.set(0, 0, -1)`), so unrotated the moth flew tail-first with its
  // antennae trailing behind. Turning the rig rather than the root keeps root.rotation
  // free for flight.js, and the moth is left-right symmetric so bank still rolls the
  // outside wing up.
  rig.rotation.y = Math.PI;
  root.add(rig);
  const scale = 1.5;

  const wingMat = new THREE.MeshLambertMaterial({
    map: wingTexture(),
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.94,
    depthWrite: false, // translucent wings overlap themselves constantly
  });
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x2a2038 });

  // The paint sac: a glowing bead slung under the abdomen, holding the colour the moth
  // will throw next. Unlit, so it reads as the colour itself rather than a shaded object.
  const sacMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  // Sits on the moth's back, because the chase camera looks down at its dorsal side:
  // slung underneath it was hidden by the body, and at 0.30 it was a balloon the moth
  // was flying behind.
  const sac = new THREE.Mesh(new THREE.SphereGeometry(0.23, 22, 16), sacMat);
  sac.position.set(0, 0.15, -0.34);
  sac.scale.set(1, 0.8, 1.25);

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.0, 8, 16), bodyMat);
  body.rotation.x = Math.PI / 2;
  rig.add(body);
  rig.add(sac);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 14), bodyMat);
  head.position.z = 0.72;
  rig.add(head);

  for (const side of [-1, 1]) {
    for (const [i, pts] of [WING, HIND].entries()) {
      const wing = new THREE.Mesh(wingGeometry(pts), wingMat);
      wing.scale.set(side * 1.35, 1, 1.35);
      wing.position.set(side * 0.12, 0.06, i === 0 ? 0.12 : -0.35);
      wing.userData.side = side;
      wing.userData.pair = i;
      rig.add(wing);
    }
    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.035, 0.75, 10),
      bodyMat,
    );
    antenna.position.set(side * 0.12, 0.14, 1.0);
    antenna.rotation.set(-1.1, 0, side * 0.35);
    rig.add(antenna);
  }

  root.scale.setScalar(scale);
  const wings = rig.children.filter((c) => c.userData.pair !== undefined);

  return {
    root,
    /** Show the colour that the next click will throw. */
    setNextColor(color) {
      sacMat.color.copy(color);
    },
    /** @param {number} elapsed seconds @param {number} effort 0..1, faster when climbing */
    flap(elapsed, effort = 0.5) {
      const rate = 3.2 + effort * 3.4;
      const t = elapsed * rate;
      for (const w of wings) {
        // hindwings trail the forewings slightly, which is what makes it read as alive
        const phase = t - w.userData.pair * 0.35;
        const beat = Math.sin(phase);
        w.rotation.z = w.userData.side * (beat * 0.72 + 0.12);
        w.rotation.x = beat * 0.12;
      }
      rig.position.y = Math.sin(t * 0.5) * 0.06; // bob the rig, never the root
      // the sac pulses gently, so the loaded colour is easy to spot from behind
      const pulse = 1 + Math.sin(t * 0.9) * 0.10;
      sac.scale.set(pulse, 0.8 * pulse, 1.25 * pulse);
    },
  };
}
