import { Effect, EffectAttribute } from 'postprocessing';
import { Uniform } from 'three';

/**
 * The painterly layer: Kuwahara, then paper, in one pass.
 *
 * Kuwahara is an edge-preserving filter that replaces each pixel with the mean of
 * whichever neighbouring quadrant has the least variance. Flat areas collapse into
 * single tones while boundaries stay crisp, which is why it reads as brushwork rather
 * than blur. This is the four-quadrant version; the anisotropic variant needs a
 * structure-tensor prepass, and the Susurrus build found that not worth its cost.
 *
 * On top of that: an ink outline from a luminance gradient, a paper grain that stays
 * locked to the screen (paper does not slide around when you turn your head), and a
 * vignette that falls off to white rather than black, so the frame reads as the edge
 * of a wet sheet.
 */

const fragment = /* glsl */`
uniform float uRadius;
uniform float uGrain;
uniform float uGrainScale;
uniform float uOutline;
uniform float uContour;
uniform float uContourWidth;
uniform float uVignette;
uniform float uFibre;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

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

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  // Paper fibre: nudge the sampling point so edges wobble the way pigment does when
  // it follows the grain of the sheet.
  vec2 warp = vec2(fbm(uv * 180.0), fbm(uv * 180.0 + 41.0)) - 0.5;
  vec2 base = uv + warp * texelSize * uFibre;

  int r = int(uRadius);
  vec3 mean[4];
  vec3 moment[4];
  for (int k = 0; k < 4; k++) { mean[k] = vec3(0.0); moment[k] = vec3(0.0); }
  float count = 0.0;

  // One quadrant offset table, four passes over the same loop bounds.
  for (int y = 0; y <= 8; y++) {
    if (y > r) break;
    for (int x = 0; x <= 8; x++) {
      if (x > r) break;
      vec2 o = vec2(float(x), float(y)) * texelSize;
      vec3 c0 = texture2D(inputBuffer, base + vec2(-o.x, -o.y)).rgb;
      vec3 c1 = texture2D(inputBuffer, base + vec2(o.x, -o.y)).rgb;
      vec3 c2 = texture2D(inputBuffer, base + vec2(-o.x, o.y)).rgb;
      vec3 c3 = texture2D(inputBuffer, base + vec2(o.x, o.y)).rgb;
      mean[0] += c0; moment[0] += c0 * c0;
      mean[1] += c1; moment[1] += c1 * c1;
      mean[2] += c2; moment[2] += c2 * c2;
      mean[3] += c3; moment[3] += c3 * c3;
      count += 1.0;
    }
  }

  vec3 best = mean[0] / count;
  float lowest = 1e9;
  for (int k = 0; k < 4; k++) {
    vec3 m = mean[k] / count;
    vec3 v = abs(moment[k] / count - m * m);
    float sigma = v.r + v.g + v.b;
    if (sigma < lowest) { lowest = sigma; best = m; }
  }

  // Ink outline from a luminance gradient. Pigment gathers where forms meet.
  vec2 e = texelSize * 1.5;
  float lc = luminance(texture2D(inputBuffer, base).rgb);
  float lx = luminance(texture2D(inputBuffer, base + vec2(e.x, 0.0)).rgb);
  float ly = luminance(texture2D(inputBuffer, base + vec2(0.0, e.y)).rgb);
  float edge = clamp(length(vec2(lc - lx, lc - ly)) * 6.0, 0.0, 1.0);
  best *= 1.0 - edge * uOutline;

  // Contour from depth, not from luminance. On an unpainted planet every surface is the
  // same white, so the gradient above finds nothing at all and the world is not merely
  // colourless, it is genuinely not there to look at. Sampling the depth buffer instead
  // draws the silhouettes: the horizon, the rim of an island, the shape of a creature.
  if (uContour > 0.001) {
    vec2 c = texelSize * uContourWidth;
    float z0 = getViewZ(readDepth(uv));
    float gx = abs(z0 - getViewZ(readDepth(uv + vec2(c.x, 0.0))))
             + abs(z0 - getViewZ(readDepth(uv - vec2(c.x, 0.0))));
    float gy = abs(z0 - getViewZ(readDepth(uv + vec2(0.0, c.y))))
             + abs(z0 - getViewZ(readDepth(uv - vec2(0.0, c.y))));
    // Relative to the distance, or a line is a slab in the foreground and invisible at
    // the far end of a 900-unit world.
    float g = (gx + gy) / max(abs(z0), 1.0);
    best *= 1.0 - smoothstep(0.012, 0.09, g) * uContour;
  }

  // Paper. Screen-locked on purpose: the sheet does not move when the camera does.
  float grain = fbm(uv * uGrainScale) * 0.6 + fbm(uv * uGrainScale * 3.7) * 0.4;
  best *= 1.0 - (grain - 0.5) * uGrain;

  float d = distance(uv, vec2(0.5));
  best = mix(best, vec3(1.0), smoothstep(0.55, 0.95, d) * uVignette);

  outputColor = vec4(best, inputColor.a);
}
`;

export class WatercolorEffect extends Effect {
  constructor({ radius = 3, grain = 0.09, grainScale = 900, outline = 0.28,
                contour = 0.55, contourWidth = 1.0,
                vignette = 0.5, fibre = 2.2 } = {}) {
    super('WatercolorEffect', fragment, {
      // The contour reads the depth buffer, which postprocessing only attaches, and only
      // defines readDepth/getViewZ for, when the effect declares it needs depth.
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ['uRadius', new Uniform(radius)],
        ['uGrain', new Uniform(grain)],
        ['uGrainScale', new Uniform(grainScale)],
        ['uOutline', new Uniform(outline)],
        ['uContour', new Uniform(contour)],
        ['uContourWidth', new Uniform(contourWidth)],
        ['uVignette', new Uniform(vignette)],
        ['uFibre', new Uniform(fibre)],
      ]),
    });
  }

  get radius() { return this.uniforms.get('uRadius').value; }
  set radius(v) { this.uniforms.get('uRadius').value = Math.max(0, Math.min(8, Math.round(v))); }
}
