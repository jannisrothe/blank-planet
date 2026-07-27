import * as THREE from 'three';
import { PLANET_RADIUS, paint as cfg } from '../config.js';

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

/**
 * The quad covers only the splat's own bounding box, not the whole map.
 *
 * It used to be a full-screen -1..1 plane, so every stamp ran the fragment shader over
 * all 4.2 million texels and threw away the 99.9% that missed. Harmless while the shape
 * was a bare disc; the spatter reaches 5.9 radii and made it cost 45ms frames.
 *
 * The box is computed on the CPU now, because on an equirectangular map its width in
 * longitude depends on how near the pole the splat landed. `uOffsetU` shifts the whole
 * quad by one texture width so a splat straddling the +/-180 meridian can be drawn a
 * second time instead of being cut in half at the seam.
 */
const VERT = /* glsl */`
uniform vec2 uQuadCentre;
uniform vec2 uQuadHalf;
uniform float uOffsetU;
varying vec2 vUv;
void main() {
  vUv = uQuadCentre + position.xy * uQuadHalf;
  gl_Position = vec4(vec2(vUv.x + uOffsetU, vUv.y) * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FRAG = /* glsl */`
precision highp float;

uniform vec3  uColor;
uniform vec3  uCentreDir;  // splat centre, as a direction from the planet centre
uniform vec3  uTanX;       // tangent frame at uCentreDir, so the spatter has a bearing
uniform vec3  uTanY;
uniform float uAngRadius;  // splat radius as an angle at the planet centre
uniform vec2  uDir;        // impact bearing in that tangent frame, throws spatter downrange
uniform float uSeed;
uniform float uSatellites;
uniform float uSpikes;
uniform float uEdge;       // 0 = razor sharp, higher = softer
uniform float uTooth;      // canvas texture breaking up the coverage
uniform float uWobble;     // how far out of round the blob is allowed to go
uniform float uBound;      // how far out the shape can reach, in radii

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
  // Reconstruct this texel's own direction on the planet, then measure the ANGLE to the
  // splat's centre. Measuring 2D distance in equirect space instead would stretch every
  // splat into a smear as it approached a pole; in angle there are no poles.
  float lon = (vUv.x - 0.5) * 6.2831853;
  float lat = (vUv.y - 0.5) * 3.1415927;
  float cl = cos(lat);
  vec3 dir = vec3(cl * cos(lon), sin(lat), cl * sin(lon));

  float angDist = acos(clamp(dot(dir, uCentreDir), -1.0, 1.0));
  // Bearing from the centre, in the splat's own tangent frame. p keeps the same meaning
  // it had on the plane -- offset in units of the splat radius -- so the shape code below
  // is untouched.
  vec3 t = dir - uCentreDir * dot(dir, uCentreDir);
  float tl = length(t);
  vec2 bearing = tl > 1e-6 ? vec2(dot(t, uTanX), dot(t, uTanY)) / tl : vec2(1.0, 0.0);
  float r = angDist / uAngRadius;
  vec2 p = bearing * r;
  // Same bound the quad was sized to. It has to clear the spatter, not just the core,
  // or the far droplets are cut off and the splat looks round again.
  if (r > uBound) discard;

  float ang = atan(p.y, p.x);

  // Central blob. Low frequency only, so the outline stays a smooth closed curve
  // rather than picking up the high-frequency detail that reads as jagged.
  float wobble = fbm(vec2(cos(ang), sin(ang)) * 1.15 + uSeed * 7.0);
  float core = 0.78 + (wobble - 0.5) * uWobble;
  float d = r / core;

  // Spikes: narrow radial fingers thrown outward, biased downrange of the impact.
  if (uSpikes > 0.001) for (int i = 0; i < 9; i++) {
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
  if (uSatellites > 0.001) for (int i = 0; i < 14; i++) {
    float fi = float(i);
    vec2 h = hash2(vec2(fi + 40.0, uSeed * 5.0));
    float a = h.x * 6.28318;
    vec2 dir = vec2(cos(a), sin(a));
    float bias = 1.0 + max(0.0, dot(dir, uDir)) * 1.8;
    float dist = (0.85 + h.y * 1.35) * bias * uSatellites;
    float rr = 0.05 + hash(vec2(fi, uSeed * 3.0)) * 0.13;
    d = min(d, length(p - dir * dist) / rr);
  }

  // Clean edge: crisp enough to read as opaque paint, wide enough to antialias.
  float mask = 1.0 - smoothstep(1.0 - uEdge, 1.0, d);
  if (mask <= 0.001) discard;

  // Canvas tooth, off by default. It speckles the edge, which is the opposite of clean.
  if (uTooth > 0.001) {
    float tooth = fbm(vUv * 900.0);
    mask *= mix(1.0, smoothstep(0.16, 0.62, tooth * 0.55 + mask * 0.65), uTooth);
  }

  gl_FragColor = vec4(uColor, clamp(mask, 0.0, 1.0));
}
`;

/** Patch of the map averaged for the audio signal, in texels. */
const SAMPLE_SPAN = 48;

const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _axisY = new THREE.Vector3(0, 1, 0);
const _axisX = new THREE.Vector3(1, 0, 0);

export class PaintMap {
  constructor(renderer) {
    this.renderer = renderer;
    const size = cfg.resolution;

    this.target = new THREE.WebGLRenderTarget(size, size, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType, // no tiny per-frame increments to quantise away now
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });

    this.uniforms = {
      uColor: { value: new THREE.Color(1, 0, 1) },
      uCentreDir: { value: new THREE.Vector3(0, 1, 0) },
      uTanX: { value: new THREE.Vector3(1, 0, 0) },
      uTanY: { value: new THREE.Vector3(0, 0, 1) },
      uAngRadius: { value: cfg.radius / PLANET_RADIUS },
      uQuadCentre: { value: new THREE.Vector2(0.5, 0.5) },
      uQuadHalf: { value: new THREE.Vector2(0.1, 0.1) },
      uOffsetU: { value: 0 },
      uDir: { value: new THREE.Vector2(1, 0) },
      uSeed: { value: 0 },
      uSatellites: { value: cfg.satellites },
      uSpikes: { value: cfg.spikes },
      uEdge: { value: cfg.edgeSoftness },
      uTooth: { value: cfg.tooth },
      uWobble: { value: cfg.wobble },
      uBound: { value: 2.6 },
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

  /** Equirectangular map coordinates for a direction. */
  static toUv(dir, out) {
    const d = _dir.copy(dir).normalize();
    return out.set(
      Math.atan2(d.z, d.x) / (Math.PI * 2) + 0.5,
      Math.asin(Math.max(-1, Math.min(1, d.y))) / Math.PI + 0.5,
    );
  }

  /**
   * Stamp a splat. Called once when a droplet lands, never per frame.
   * @param {THREE.Vector3} at world position of the impact; only its direction matters
   * @param {THREE.Color} color
   * @param {THREE.Vector3} vel impact velocity, which throws the spatter downrange
   * @param {number} scale 1 is the configured radius
   */
  splat(at, color, vel, scale = 1) {
    const u = this.uniforms;
    const centre = _dir.copy(at).normalize();
    u.uCentreDir.value.copy(centre);

    // A tangent frame at the impact. Built off whichever world axis is least parallel to
    // the surface normal, so it never degenerates at the poles.
    const seed = Math.abs(centre.y) < 0.9 ? _axisY : _axisX;
    const tanX = u.uTanX.value.copy(seed).cross(centre).normalize();
    const tanY = u.uTanY.value.copy(centre).cross(tanX).normalize();

    // The impact bearing, projected into that frame.
    const vx = _tmp.copy(vel).dot(tanX);
    const vy = _tmp.copy(vel).dot(tanY);
    const vlen = Math.hypot(vx, vy);
    u.uDir.value.set(vlen > 1e-5 ? vx / vlen : 1, vlen > 1e-5 ? vy / vlen : 0);

    u.uColor.value.copy(color);
    u.uAngRadius.value = (cfg.radius * scale) / PLANET_RADIUS;
    u.uSeed.value = Math.random() * 100;
    u.uSatellites.value = cfg.satellites;
    u.uSpikes.value = cfg.spikes;
    u.uEdge.value = cfg.edgeSoftness;
    u.uTooth.value = cfg.tooth;
    u.uWobble.value = cfg.wobble;
    // Furthest a satellite or spike can land, from the constants in the loops above.
    u.uBound.value = 2.6 + cfg.satellites * 6.4 + cfg.spikes * 3.0;

    PaintMap.toUv(centre, this._sampleUv);
    u.uQuadCentre.value.copy(this._sampleUv);

    // Bounding box in equirect space. Latitude is simple; longitude has to widen by
    // 1/cos(lat) and go all the way round once the box reaches over a pole.
    const maxAng = u.uAngRadius.value * u.uBound.value;
    const lat = (this._sampleUv.y - 0.5) * Math.PI;
    const halfV = maxAng / Math.PI;
    const reachesPole = Math.abs(lat) + maxAng >= Math.PI / 2 - 1e-4;
    const halfU = reachesPole
      ? 0.5
      : Math.min(0.5, Math.asin(Math.min(1, Math.sin(maxAng) / Math.cos(lat))) / (Math.PI * 2));
    u.uQuadHalf.value.set(halfU, halfV);

    const prevTarget = this.renderer.getRenderTarget();
    const prevAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.setRenderTarget(this.target);
    // Three passes, offset by one texture width each way. Only the middle one lands
    // unless the box straddles the +/-180 meridian, and the other two are clipped
    // whole -- four vertices each, which is cheaper than deciding whether to skip them.
    for (const offset of [-1, 0, 1]) {
      u.uOffsetU.value = offset;
      this.renderer.render(this.scene, this.camera);
    }
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.autoClear = prevAutoClear;
    this.splats++;
  }

  /**
   * How much paint is on the ground around the player, 0..1, for the audio mix.
   * Async, so it never stalls the pipeline.
   */
  async sampleCoverage(at) {
    if (this._reading) return this._coverage;
    this._reading = true;
    try {
      const S = cfg.resolution;
      const R = SAMPLE_SPAN;
      PaintMap.toUv(at, this._sampleUv);
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
  /** @param {THREE.Vector3} at a direction from the planet centre */
  async sampleAt(at) {
    const S = cfg.resolution;
    const uv = PaintMap.toUv(at, new THREE.Vector2());
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
