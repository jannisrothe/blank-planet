import * as THREE from 'three';
import { WORLD_SIZE, ink as cfg } from '../config.js';

/**
 * A top-down mask of where ink currently sits on the world, held entirely on the GPU.
 *
 * The prototype did this on the CPU: repaint a 1024x1024 canvas and re-upload ~4 MB
 * every single frame. This is one 512x512 fragment pass instead, and it buys a
 * behaviour the canvas version could not have: the blot diffuses outward as it dries,
 * which is what makes it read as ink on wet paper rather than a shrinking circle.
 */

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */`
precision highp float;

uniform sampler2D uPrev;
uniform vec2  uPlayer;   // player position in mask uv space
uniform float uRadius;   // reveal radius in uv space
uniform float uDecay;    // survival multiplier for this frame
uniform float uBleed;    // diffusion offset in texels
uniform float uWarp;     // how ragged the blot edge is
uniform float uTime;
uniform vec2  uTexel;

varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.02; a *= 0.5; }
  return v;
}

void main() {
  // Diffusion. A 5-tap blur of the previous state spreads pigment into dry paper,
  // so the trail keeps creeping outward slightly while it fades.
  vec2 o = uTexel * uBleed;
  float prev =
      texture2D(uPrev, vUv).r * 0.36
    + texture2D(uPrev, vUv + vec2(o.x, 0.0)).r * 0.16
    + texture2D(uPrev, vUv - vec2(o.x, 0.0)).r * 0.16
    + texture2D(uPrev, vUv + vec2(0.0, o.y)).r * 0.16
    + texture2D(uPrev, vUv - vec2(0.0, o.y)).r * 0.16;
  prev *= uDecay;

  // The fresh blot under the player, its edge pushed around by noise so the
  // boundary is ragged like a real bleed instead of a clean circle.
  float d = distance(vUv, uPlayer);
  float warp = (fbm(vUv * 85.0 + uTime * 0.03) - 0.5) * uRadius * uWarp;
  float blot = 1.0 - smoothstep(0.0, max(uRadius + warp, 1e-4), d);
  blot = pow(clamp(blot, 0.0, 1.0), 0.7);

  gl_FragColor = vec4(max(prev, blot), 0.0, 0.0, 1.0);
}
`;

/** Patch of the mask averaged for the audio signal, in texels. ~3x the reveal radius. */
const SAMPLE_SPAN = 64;

export class InkMap {
  constructor(renderer) {
    this.renderer = renderer;
    const size = cfg.resolution;

    const opts = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this.targets = [
      new THREE.WebGLRenderTarget(size, size, opts),
      new THREE.WebGLRenderTarget(size, size, opts),
    ];
    this.index = 0;
    this._buffer = new Uint8Array(SAMPLE_SPAN * SAMPLE_SPAN * 4);
    this._wetness = 0;
    this._reading = false;

    this.uniforms = {
      uPrev: { value: this.targets[1].texture },
      uPlayer: { value: new THREE.Vector2(0.5, 0.5) },
      uRadius: { value: cfg.radius / WORLD_SIZE },
      uDecay: { value: 0.99 },
      uBleed: { value: cfg.bleed },
      uWarp: { value: cfg.edgeWarp },
      uTime: { value: 0 },
      uTexel: { value: new THREE.Vector2(1 / size, 1 / size) },
    };

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
    });

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));

    this.clear();
  }

  /** Blank paper: no ink anywhere. */
  clear() {
    const prev = this.renderer.getRenderTarget();
    for (const t of this.targets) {
      this.renderer.setRenderTarget(t);
      this.renderer.setClearColor(0x000000, 1);
      this.renderer.clear(true, false, false);
    }
    this.renderer.setRenderTarget(prev);
  }

  get texture() {
    return this.targets[this.index].texture;
  }

  /** World XZ -> mask uv. Kept here so nothing else needs to know the mapping. */
  static toUv(x, z, out) {
    return out.set(x / WORLD_SIZE + 0.5, z / WORLD_SIZE + 0.5);
  }

  update(playerX, playerZ, dt, elapsed) {
    const read = this.targets[this.index];
    const write = this.targets[this.index ^ 1];

    this.uniforms.uPrev.value = read.texture;
    InkMap.toUv(playerX, playerZ, this.uniforms.uPlayer.value);
    this.uniforms.uRadius.value = cfg.radius / WORLD_SIZE;
    this.uniforms.uBleed.value = cfg.bleed;
    this.uniforms.uWarp.value = cfg.edgeWarp;
    this.uniforms.uTime.value = elapsed;
    // Exponential decay so the fade is framerate independent.
    this.uniforms.uDecay.value = Math.exp(-dt / cfg.fadeSeconds);

    const prevTarget = this.renderer.getRenderTarget();
    const prevAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.setRenderTarget(write);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.autoClear = prevAutoClear;

    this.index ^= 1;
  }

  /**
   * How wet the paper is around the player, 0..1, for the audio mix.
   *
   * Reading a single texel under the player would always return ~1, because the
   * player sits at the centre of their own blot. Averaging a patch several times the
   * reveal radius across gives the useful signal instead: it rises as you spread ink
   * and falls as it dries.
   *
   * Async on purpose. The synchronous read flushes the GPU pipeline; this one does not,
   * and audio does not care about a frame or two of latency.
   */
  async sampleWetness() {
    if (this._reading) return this._wetness;
    this._reading = true;
    try {
      const S = cfg.resolution;
      const R = SAMPLE_SPAN;
      const clamp = (v) => Math.max(0, Math.min(S - R, Math.round(v)));
      const x = clamp(this.uniforms.uPlayer.value.x * S - R / 2);
      const y = clamp(this.uniforms.uPlayer.value.y * S - R / 2);
      await this.renderer.readRenderTargetPixelsAsync(
        this.targets[this.index], x, y, R, R, this._buffer,
      );
      let sum = 0;
      for (let i = 0; i < this._buffer.length; i += 4) sum += this._buffer[i];
      this._wetness = sum / (R * R * 255);
    } catch {
      this._wetness = 0; // readback unsupported: audio falls back to its dry setting
    } finally {
      this._reading = false;
    }
    return this._wetness;
  }

  get wetness() { return this._wetness; }

  dispose() {
    this.targets.forEach((t) => t.dispose());
    this.material.dispose();
  }
}
