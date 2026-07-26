import * as THREE from 'three';
import { WORLD_SIZE, ink as cfg } from '../config.js';

/**
 * A simplified real-time reading of Curtis et al., "Computer-Generated Watercolor"
 * (SIGGRAPH '97). Their three-layer shallow-water model, cut to two render targets.
 *
 *   wet  RGB = suspended pigment colour, A = water saturation   (transient)
 *   dry  RGB = deposited pigment,        A = coverage           (never decays)
 *
 * v1 was one scalar channel through a symmetric 5-tap blur, which can only ever produce
 * a soft circle. Three things here produce the look in real watercolour references:
 *
 *   1. Water advances by max() against noise-modulated paper capacity, not by blurring.
 *      A max-based frontier STOPS HARD, and that hard stop is the wet edge. A blur can
 *      only ever give a soft gradient. This single change is most of the difference.
 *   2. Pigment is sampled from the direction opposite the water gradient, so it is
 *      dragged outward along the flow into tendrils rather than diffusing evenly.
 *   3. Pigment deposits into paper tooth while drying, which gives granulation, and
 *      deposits extra where the water gradient is steep, which gives edge darkening as
 *      a consequence of the physics rather than as a faked smoothstep band.
 */

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const NOISE = /* glsl */`
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return v;
}
`;

/** Pass 1: advance water, drag pigment along the flow, dry. */
const WET_FRAG = /* glsl */`
precision highp float;
${NOISE}

uniform sampler2D uWet;
uniform vec2  uTexel;
uniform float uDecay;
uniform float uCapillary;
uniform float uAdvection;
uniform float uPaperScale;

uniform vec2  uDropUv;      // < 0 when there is no drop this frame
uniform float uDropRadius;
uniform vec3  uDropColor;
uniform float uDropWater;

varying vec2 vUv;

void main() {
  vec4 self = texture2D(uWet, vUv);

  // Paper capacity. Where the sheet is thirsty water runs further, where it is dense the
  // frontier stalls. This is what makes the boundary ragged instead of circular.
  float capacity = 0.72 + fbm(vUv * uPaperScale) * 0.56;

  vec4 n0 = texture2D(uWet, vUv + vec2(uTexel.x, 0.0));
  vec4 n1 = texture2D(uWet, vUv - vec2(uTexel.x, 0.0));
  vec4 n2 = texture2D(uWet, vUv + vec2(0.0, uTexel.y));
  vec4 n3 = texture2D(uWet, vUv - vec2(0.0, uTexel.y));

  // Capillary advance: take the wettest neighbour, attenuated. Because this is a max
  // and not an average, the front holds a sharp edge as it spreads.
  float adv = max(max(n0.a, n1.a), max(n2.a, n3.a)) * uCapillary * capacity;
  float water = max(self.a, adv);

  // Which way is the water flowing? Outward, down the saturation gradient.
  vec2 grad = vec2(n0.a - n1.a, n2.a - n3.a);
  float gl = length(grad);

  // Colour must always be gathered weighted by water. A dry cell stores black RGB with
  // zero alpha, so any unweighted average with a neighbour pulls the pigment toward
  // black -- that turned whole painted hillsides into soot.
  float wsum = n0.a + n1.a + n2.a + n3.a;
  vec3 neighbourColour = wsum > 1e-5
    ? (n0.rgb * n0.a + n1.rgb * n1.a + n2.rgb * n2.a + n3.rgb * n3.a) / wsum
    : self.rgb;

  // Pigment is dragged from behind the front, so it piles up toward the edge and
  // strings out into tendrils instead of spreading uniformly.
  vec3 pigment = self.a > 1e-5 ? self.rgb : neighbourColour;
  if (gl > 1e-5) {
    vec2 back = normalize(grad) * uTexel * uAdvection;
    vec4 pulled = texture2D(uWet, vUv + back);
    if (pulled.a > 1e-5) {
      pigment = mix(pigment, pulled.rgb, clamp(gl * 6.0, 0.0, 0.85));
    }
  }
  // Where we just became wet from a neighbour, inherit its pigment.
  if (self.a < adv) {
    pigment = mix(neighbourColour, pigment, clamp(self.a / max(adv, 1e-4), 0.0, 1.0));
  }

  water *= uDecay;

  // A new drop: water and pigment injected at the impact point.
  if (uDropUv.x >= 0.0) {
    float d = distance(vUv, uDropUv);
    float edge = uDropRadius * (0.55 + fbm(vUv * uPaperScale * 0.6) * 0.9);
    float blot = 1.0 - smoothstep(edge * 0.25, edge, d);
    blot = pow(clamp(blot, 0.0, 1.0), 0.55) * uDropWater;
    if (blot > 0.0) {
      pigment = mix(pigment, uDropColor, clamp(blot / max(water + blot, 1e-4), 0.0, 1.0));
      water = max(water, blot);
    }
  }

  gl_FragColor = vec4(pigment, clamp(water, 0.0, 1.0));
}
`;

/** Pass 2: transfer pigment lost to drying into the permanent layer. */
const DRY_FRAG = /* glsl */`
precision highp float;
${NOISE}

uniform sampler2D uDry;
uniform sampler2D uWet;
uniform sampler2D uWetPrev;
uniform vec2  uTexel;
uniform float uGranulation;
uniform float uEdgeDarkening;
uniform float uPaperScale;

varying vec2 vUv;

void main() {
  vec4 dry = texture2D(uDry, vUv);
  vec4 wet = texture2D(uWet, vUv);
  vec4 prev = texture2D(uWetPrev, vUv);

  // Whatever water disappeared since last frame left its pigment behind.
  float dried = max(0.0, prev.a - wet.a);

  // Paper tooth: pigment settles into the valleys and skips the peaks. This is
  // granulation, and it is why a real wash is never a flat field of colour.
  float tooth = 0.78 + fbm(vUv * uPaperScale * 1.7) * 0.44;

  // Steep water gradient means the front is stalling here, so more pigment strands.
  float gx = texture2D(uWet, vUv + vec2(uTexel.x, 0.0)).a - texture2D(uWet, vUv - vec2(uTexel.x, 0.0)).a;
  float gy = texture2D(uWet, vUv + vec2(0.0, uTexel.y)).a - texture2D(uWet, vUv - vec2(0.0, uTexel.y)).a;
  float rim = length(vec2(gx, gy)) * uEdgeDarkening;

  float deposit = dried * mix(1.0, tooth, uGranulation) * (1.0 + rim * 8.0);
  deposit = clamp(deposit * 1.5, 0.0, 1.0);

  // If neither layer holds meaningful water there is no pigment in suspension to
  // deposit, and depositing anyway would write black into the permanent layer.
  if (prev.a < 1e-4 && wet.a < 1e-4) deposit = 0.0;

  // Weighted average, so magenta laid over cyan genuinely reads as the mix rather
  // than simply replacing it.
  // Same rule here: only take colour from the wet layer when it actually holds water,
  // otherwise a drying edge blends the deposit toward black.
  vec3 incoming = wet.a > 1e-5 ? wet.rgb : prev.rgb;
  float total = dry.a + deposit;
  vec3 colour = total > 1e-5 ? (dry.rgb * dry.a + incoming * deposit) / total : dry.rgb;

  // Averaging two hues drags them toward gray, and averaging complements lands on near
  // black -- violet over acid yellow was turning whole hillsides to mud. Rescale the
  // mix back up to the brightness of its brighter parent, so overlaps stay electric
  // while still landing on a genuinely mixed hue.
  float mixMax = max(colour.r, max(colour.g, colour.b));
  float parentMax = max(max(dry.r, max(dry.g, dry.b)), max(wet.r, max(wet.g, wet.b)));
  colour *= parentMax / max(mixMax, 1e-4);

  gl_FragColor = vec4(clamp(colour, 0.0, 1.0), clamp(total, 0.0, 1.4));
}
`;

const SAMPLE_SPAN = 64;

/** IEEE 754 half precision -> JS number, for reading back HalfFloatType targets. */
function halfToFloat(h) {
  const sign = (h & 0x8000) ? -1 : 1;
  const exp = (h & 0x7c00) >> 10;
  const frac = h & 0x03ff;
  if (exp === 0) return sign * 6.103515625e-5 * (frac / 1024);
  if (exp === 0x1f) return frac ? NaN : sign * Infinity;
  return sign * 2 ** (exp - 15) * (1 + frac / 1024);
}

function makeTarget(size) {
  return new THREE.WebGLRenderTarget(size, size, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    format: THREE.RGBAFormat,
    // Half float, not 8-bit. Deposition adds roughly 0.0017 per frame, which rounds
    // straight to zero in an 8-bit texture, so a bloom would never accumulate at all.
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

export class PigmentSim {
  constructor(renderer) {
    this.renderer = renderer;
    const size = cfg.resolution;

    this.wet = [makeTarget(size), makeTarget(size)];
    this.dry = [makeTarget(size), makeTarget(size)];
    this.wi = 0;
    this.di = 0;

    this.wetUniforms = {
      uWet: { value: null },
      uTexel: { value: new THREE.Vector2(1 / size, 1 / size) },
      uDecay: { value: 1 },
      uCapillary: { value: cfg.capillary },
      uAdvection: { value: cfg.advection },
      uPaperScale: { value: cfg.paperScale },
      uDropUv: { value: new THREE.Vector2(-1, -1) },
      uDropRadius: { value: cfg.dropRadius / WORLD_SIZE },
      uDropColor: { value: new THREE.Color(1, 0, 1) },
      uDropWater: { value: cfg.dropWater },
    };
    this.dryUniforms = {
      uDry: { value: null },
      uWet: { value: null },
      uWetPrev: { value: null },
      uTexel: { value: new THREE.Vector2(1 / size, 1 / size) },
      uGranulation: { value: cfg.granulation },
      uEdgeDarkening: { value: cfg.edgeDarkening },
      uPaperScale: { value: cfg.paperScale },
    };

    const quad = new THREE.PlaneGeometry(2, 2);
    const base = { vertexShader: VERT, depthTest: false, depthWrite: false };
    this.wetMat = new THREE.ShaderMaterial({ ...base, fragmentShader: WET_FRAG, uniforms: this.wetUniforms });
    this.dryMat = new THREE.ShaderMaterial({ ...base, fragmentShader: DRY_FRAG, uniforms: this.dryUniforms });

    this.scene = new THREE.Scene();
    this.mesh = new THREE.Mesh(quad, this.wetMat);
    this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this._buffer = new Uint16Array(SAMPLE_SPAN * SAMPLE_SPAN * 4);
    this._wetness = 0;
    this._reading = false;
    this._pending = null;
    this._sampleUv = new THREE.Vector2(0.5, 0.5);

    this.clear();
  }

  clear() {
    const prev = this.renderer.getRenderTarget();
    this.renderer.setClearColor(0x000000, 0);
    for (const t of [...this.wet, ...this.dry]) {
      this.renderer.setRenderTarget(t);
      this.renderer.clear(true, false, false);
    }
    this.renderer.setRenderTarget(prev);
  }

  static toUv(x, z, out) {
    return out.set(x / WORLD_SIZE + 0.5, z / WORLD_SIZE + 0.5);
  }

  /** Queue a pigment drop at a world position. Applied on the next update. */
  drop(x, z, color) {
    this._pending = { x, z, color };
  }

  get wetTexture() { return this.wet[this.wi].texture; }
  get dryTexture() { return this.dry[this.di].texture; }
  get wetness() { return this._wetness; }

  #blit(target, material) {
    this.mesh.material = material;
    const prevTarget = this.renderer.getRenderTarget();
    const prevAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.autoClear = prevAutoClear;
  }

  update(dt) {
    const wetRead = this.wet[this.wi];
    const wetWrite = this.wet[this.wi ^ 1];

    this.wetUniforms.uWet.value = wetRead.texture;
    this.wetUniforms.uDecay.value = Math.exp(-dt / cfg.drySeconds);
    this.wetUniforms.uCapillary.value = cfg.capillary;
    this.wetUniforms.uAdvection.value = cfg.advection;
    this.wetUniforms.uPaperScale.value = cfg.paperScale;
    this.wetUniforms.uDropRadius.value = cfg.dropRadius / WORLD_SIZE;
    this.wetUniforms.uDropWater.value = cfg.dropWater;

    if (this._pending) {
      PigmentSim.toUv(this._pending.x, this._pending.z, this.wetUniforms.uDropUv.value);
      this.wetUniforms.uDropColor.value.copy(this._pending.color);
      this._sampleUv.copy(this.wetUniforms.uDropUv.value);
      this._pending = null;
    } else {
      this.wetUniforms.uDropUv.value.set(-1, -1);
    }

    this.#blit(wetWrite, this.wetMat);

    // Deposition compares the new wet state against the one it replaced, so this must
    // run before the ping-pong index flips.
    const dryRead = this.dry[this.di];
    const dryWrite = this.dry[this.di ^ 1];
    this.dryUniforms.uDry.value = dryRead.texture;
    this.dryUniforms.uWet.value = wetWrite.texture;
    this.dryUniforms.uWetPrev.value = wetRead.texture;
    this.dryUniforms.uGranulation.value = cfg.granulation;
    this.dryUniforms.uEdgeDarkening.value = cfg.edgeDarkening;
    this.#blit(dryWrite, this.dryMat);

    this.wi ^= 1;
    this.di ^= 1;
  }

  /**
   * How wet the paper is around the most recent drop, 0..1, for the audio mix.
   * Async on purpose: the synchronous read flushes the GPU pipeline, this one does not.
   */
  async sampleWetness() {
    if (this._reading) return this._wetness;
    this._reading = true;
    try {
      const S = cfg.resolution;
      const R = SAMPLE_SPAN;
      const clamp = (v) => Math.max(0, Math.min(S - R, Math.round(v)));
      const x = clamp(this._sampleUv.x * S - R / 2);
      const y = clamp(this._sampleUv.y * S - R / 2);
      await this.renderer.readRenderTargetPixelsAsync(this.wet[this.wi], x, y, R, R, this._buffer);
      let sum = 0;
      for (let i = 3; i < this._buffer.length; i += 4) sum += halfToFloat(this._buffer[i]);
      this._wetness = sum / (R * R);
    } catch {
      this._wetness = 0; // readback unsupported: audio falls back to its dry setting
    } finally {
      this._reading = false;
    }
    return this._wetness;
  }

  /** Coverage and colour at a world point. Used by the persistence gate. */
  async sampleAt(x, z) {
    const S = cfg.resolution;
    const uv = PigmentSim.toUv(x, z, new THREE.Vector2());
    const px = Math.max(0, Math.min(S - 2, Math.round(uv.x * S)));
    const py = Math.max(0, Math.min(S - 2, Math.round(uv.y * S)));
    const buf = new Uint16Array(4 * 4);
    await this.renderer.readRenderTargetPixelsAsync(this.dry[this.di], px, py, 2, 2, buf);
    // Reported 0..255 so the gates read like colour values rather than raw floats.
    const at = (i) => Math.round(Math.min(1, Math.max(0, halfToFloat(buf[i]))) * 255);
    return { r: at(0), g: at(1), b: at(2), a: at(3) };
  }

  dispose() {
    [...this.wet, ...this.dry].forEach((t) => t.dispose());
    this.wetMat.dispose();
    this.dryMat.dispose();
  }
}
