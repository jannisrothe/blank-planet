import * as THREE from 'three';
import { droplet as cfg } from '../config.js';
import { radiusAt } from '../terrain.js';

const _down = new THREE.Vector3();
const _look = new THREE.Vector3();

/**
 * The blobs of paint you release, falling under gravity until they hit the planet.
 *
 * They are unlit and never washed by the paint map, so a bright droplet stays visible
 * against blank white paper the whole way down -- you watch it fall and see where it
 * lands, which is the point of throwing it rather than teleporting the splat.
 *
 * A fixed pool, because allocating a mesh per click would churn the heap during a
 * rapid-fire painting session.
 */
export class Droplets {
  constructor(scene, onImpact) {
    this.onImpact = onImpact;
    this.live = [];
    this.pool = [];

    // 7x5 segments was a visible faceted lump against white paper. The pool shares one
    // geometry, so a smooth sphere costs one buffer, not 64.
    const geo = new THREE.SphereGeometry(1, 32, 20);
    for (let i = 0; i < cfg.poolSize; i++) {
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ toneMapped: false }),
      );
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.pool.push(mesh);
    }
  }

  /**
   * @param {THREE.Vector3} pos release point
   * @param {THREE.Vector3} vel initial velocity, inherited from the moth
   * @param {THREE.Color} color
   */
  spawn(pos, vel, color) {
    const mesh = this.pool.pop();
    if (!mesh) return; // pool exhausted; dropping the drop beats stuttering
    mesh.visible = true;
    mesh.position.copy(pos);
    mesh.material.color.copy(color);
    mesh.scale.setScalar(cfg.size);
    this.live.push({
      mesh,
      vel: vel.clone(),
      color: color.clone(),
      spin: (Math.random() - 0.5) * 4,
    });
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const d = this.live[i];
      // Gravity points at the planet centre, not at -Y. On a ball those are the same
      // thing only directly under the spawn point.
      _down.copy(d.mesh.position).normalize();
      d.vel.addScaledVector(_down, -cfg.gravity * dt);
      d.mesh.position.addScaledVector(d.vel, dt);

      // Stretch along travel, so a fast droplet reads as a streak rather than a ball.
      const speed = d.vel.length();
      const stretch = 1 + Math.min(2.2, speed * cfg.stretch);
      d.mesh.scale.set(cfg.size, cfg.size * stretch, cfg.size);
      d.mesh.lookAt(_look.copy(d.mesh.position).add(d.vel));
      d.mesh.rotateX(Math.PI / 2);

      const p = d.mesh.position;
      const surface = radiusAt(p);
      if (p.length() <= surface) {
        this.onImpact(p, d.color, d.vel);
        d.mesh.visible = false;
        this.pool.push(d.mesh);
        this.live.splice(i, 1);
      } else if (p.length() > surface + 4000) {
        // escaped the planet somehow; recycle rather than leak
        d.mesh.visible = false;
        this.pool.push(d.mesh);
        this.live.splice(i, 1);
      }
    }
  }
}
