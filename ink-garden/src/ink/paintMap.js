import * as THREE from 'three';
import { WORLD_SIZE, paint as cfg } from '../config.js';

/**
 * Wet oil paint, thrown at a planet.
 *
 * This replaces the watercolour fluid simulation. Oil does not flow, so there is no
 * per-frame simulation at all: a splat is stamped once on impact and never moves again.
 * That means a single RGBA target with ordinary alpha blending instead of two half-float
 * targets and two full-screen passes every frame -- cheaper than the thing it replaces,
 * which is what pays for an eight-times-larger world.
 *
 * Fresh paint covers what is underneath rather than averaging with it, so colours stay
 * vivid however many times you paint over the same ground.
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

uniform vec3  uColor;
uniform vec2  uCenter;     // splat centre in map uv
uniform float uRadius;     // splat radius in map uv
uniform vec2  uDir;        // horizontal impact direction, for throwing spatter downrange
uniform float uSeed;
uniform float uSatellites;
uniform float uSpikes;
uniform float uEdge;       // 0 = razor sharp, higher = softer
uniform float uTooth;      // canvas texture breaking up the coverage

varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
vec2 hash2(vec2 p) { return vec2(hash(p), hash(p + 17.3)); }

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  // Work in units of the splat radius, so the shape is scale independent.
  vec2 p = (vUv - uCenter) / uRadius;
  float r = length(p);
  if (r > 2.6) discard;

  float ang = atan(p.y, p.x);

  // Central blob, edge pushed around so it is never a circle.
  float wobble = fbm(vec2(cos(ang), sin(ang)) * 2.2 + uSeed * 7.0);
  float core = 0.62 + (wobble - 0.5) * 0.42;
  float d = r / core;

  // Spikes: narrow radial fingers thrown outward, biased downrange of the impact.
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    vec2 h = hash2(vec2(fi, uSeed * 13.0));
    float a = h.x * 6.28318;
    vec2 dir = vec2(cos(a), sin(a));
    float bias = 1.0 + max(0.0, dot(dir, uDir)) * 1.5;
    float len = (0.55 + h.y * 1.25) * uSpikes * bias;
    // A finger is a blob stretched along its own direction.
    vec2 local = vec2(dot(p, dir), dot(p, vec2(-dir.y, dir.x)));
    local.x /= max(len, 1e-3);
    local.y /= 0.10 + h.y * 0.09;
    d = min(d, length(local - vec2(0.35, 0.0)) * 1.35);
  }

  // Satellites: separate droplets that flew off and landed on their own.
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    vec2 h = hash2(vec2(fi + 40.0, uSeed * 5.0));
    float a = h.x * 6.28318;
    vec2 dir = vec2(cos(a), sin(a));
    float bias = 1.0 + max(0.0, dot(dir, uDir)) * 1.8;
    float dist = (0.85 + h.y * 1.35) * bias * uSatellites;
    float rr = 0.05 + hash(vec2(fi, uSeed * 3.0)) * 0.13;
    d = min(d, length(p - dir * dist) / rr);
  }

  // Hard edge. Oil does not feather, so this is a near-step rather than a gradient.
  float mask = 1.0 - smoothstep(1.0 - uEdge, 1.0, d);
  if (mask <= 0.001) discard;

  // Canvas tooth: paint skips the weave slightly at the thinnest parts of the edge.
  float tooth = fbm(vUv * 900.0);
  mask *= mix(1.0, smoothstep(0.16, 0.62, tooth * 0.55 + mask * 0.65), uTooth);

  // Built-up rim, the way a loaded brush leaves more pigment where it stops.
  float rim = smoothstep(0.72, 1.0, d) * (1.0 - smoothstep(1.0, 1.06, d));
  vec3 colour = uColor * (1.0 - rim * 0.28);

  gl_FragColor = vec4(colour, clamp(mask, 0.0, 1.0));
}
`;

/** Patch of the map averaged for the audio signal, in texels. */
const SAMPLE_SPAN = 48;

export class PaintMap {
  constructor(renderer) {
    this.renderer = renderer;
    const size = cfg.resolution;

    this.target = new THREE.WebGLRenderTarget(size, size, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType, // no tiny per-frame increments to quantise away now
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });

    this.uniforms = {
      uColor: { value: new THREE.Color(1, 0, 1) },
      uCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uRadius: { value: cfg.radius / WORLD_SIZE },
      uDir: { value: new THREE.Vector2(1, 0) },
      uSeed: { value: 0 },
      uSatellites: { value: cfg.satellites },
      uSpikes: { value: cfg.spikes },
      uEdge: { value: cfg.edgeSoftness },
      uTooth: { value: cfg.tooth },
    };

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      // "Covers, like real oil": standard source-over. The separate alpha factors matter,
      // or the target's own alpha never accumulates and coverage stays at zero.
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });

    this.scene = new THREE.Scene();
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this._buffer = new Uint8Array(SAMPLE_SPAN * SAMPLE_SPAN * 4);
    this._coverage = 0;
    this._reading = false;
    this._sampleUv = new THREE.Vector2(0.5, 0.5);
    this.splats = 0;

    this.clear();
  }

  clear() {
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, false, false);
    this.renderer.setRenderTarget(prev);
    this.splats = 0;
  }

  get texture() { return this.target.texture; }
  get coverage() { return this._coverage; }

  static toUv(x, z, out) {
    return out.set(x / WORLD_SIZE + 0.5, z / WORLD_SIZE + 0.5);
  }

  /**
   * Stamp a splat. Called once when a droplet lands, never per frame.
   * @param {number} x @param {number} z world position of the impact
   * @param {THREE.Color} color
   * @param {THREE.Vector2} dir horizontal travel direction, throws the spatter downrange
   * @param {number} scale 1 is the configured radius
   */
  splat(x, z, color, dir, scale = 1) {
    PaintMap.toUv(x, z, this.uniforms.uCenter.value);
    this.uniforms.uColor.value.copy(color);
    this.uniforms.uRadius.value = (cfg.radius * scale) / WORLD_SIZE;
    this.uniforms.uDir.value.copy(dir).normalize();
    this.uniforms.uSeed.value = Math.random() * 100;
    this.uniforms.uSatellites.value = cfg.satellites;
    this.uniforms.uSpikes.value = cfg.spikes;
    this.uniforms.uEdge.value = cfg.edgeSoftness;
    this.uniforms.uTooth.value = cfg.tooth;
    this._sampleUv.copy(this.uniforms.uCenter.value);

    const prevTarget = this.renderer.getRenderTarget();
    const prevAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.autoClear = prevAutoClear;
    this.splats++;
  }

  /**
   * How much paint is on the ground around the player, 0..1, for the audio mix.
   * Async, so it never stalls the pipeline.
   */
  async sampleCoverage(x, z) {
    if (this._reading) return this._coverage;
    this._reading = true;
    try {
      const S = cfg.resolution;
      const R = SAMPLE_SPAN;
      PaintMap.toUv(x, z, this._sampleUv);
      const clamp = (v) => Math.max(0, Math.min(S - R, Math.round(v)));
      const px = clamp(this._sampleUv.x * S - R / 2);
      const py = clamp(this._sampleUv.y * S - R / 2);
      await this.renderer.readRenderTargetPixelsAsync(this.target, px, py, R, R, this._buffer);
      let sum = 0;
      for (let i = 3; i < this._buffer.length; i += 4) sum += this._buffer[i];
      this._coverage = sum / (R * R * 255);
    } catch {
      this._coverage = 0;
    } finally {
      this._reading = false;
    }
    return this._coverage;
  }

  /** Colour and coverage at a world point, 0..255. Used by the gates. */
  async sampleAt(x, z) {
    const S = cfg.resolution;
    const uv = PaintMap.toUv(x, z, new THREE.Vector2());
    const px = Math.max(0, Math.min(S - 2, Math.round(uv.x * S)));
    const py = Math.max(0, Math.min(S - 2, Math.round(uv.y * S)));
    const buf = new Uint8Array(16);
    await this.renderer.readRenderTargetPixelsAsync(this.target, px, py, 2, 2, buf);
    return { r: buf[0], g: buf[1], b: buf[2], a: buf[3] };
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
  }
}
