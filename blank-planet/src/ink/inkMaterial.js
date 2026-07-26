import * as THREE from 'three';
import { WORLD_SIZE, paint as cfg } from '../config.js';

/**
 * Patches any three material so it is invisible on blank paper and takes on whatever
 * pigment has been dropped over it.
 *
 * The paint carries the colour, so a magenta splat stains ground, plants and rock alike,
 * and fresh paint covers what was under it rather than blending with it.
 *
 * The object's own shading still modulates the pigment, which is the difference between
 * a wash over a drawing and a flat fill: a tree and the ground both go magenta, but the
 * tree still reads as a tree.
 */

const patched = new Set();

const VERTEX_HOOK = '#include <project_vertex>';
const FRAGMENT_HOOKS = ['#include <dithering_fragment>', '#include <premultiplied_alpha_fragment>'];

const VERTEX_INJECT = /* glsl */`
#include <project_vertex>
{
  vec4 inkLocal = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    inkLocal = instanceMatrix * inkLocal;
  #endif
  vInkWorld = (modelMatrix * inkLocal).xyz;
}
`;

/**
 * Shared tail. Takes a pigment colour and a coverage and lays it over the paper, however
 * the two were arrived at.
 */
const SHADE = /* glsl */`
  // The form's own shading modulates the pigment rather than tinting it, so shapes
  // still read through a flat wash.
  // Re-saturate. Successive drops average together, and averaging two hues always
  // pulls toward gray, so without this a well-painted area turns to mud.
  float mx = max(pigment.r, max(pigment.g, pigment.b));
  float mn = min(pigment.r, min(pigment.g, pigment.b));
  pigment = clamp(mx > 1e-4 ? mn + (pigment - mn) * uChroma : pigment, 0.0, 1.0);

  float lum = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 painted = pigment * (uShade.x + uShade.y * lum);

  gl_FragColor.rgb = mix(uPaper, painted, cover);
`;

const FRAGMENT_INJECT = /* glsl */`
{
  vec2 inkUv = vInkWorld.xz / uInkWorldSize + 0.5;
  vec4 paintTex = texture2D(uPaintMap, inkUv);

  vec3 pigment = paintTex.rgb;
  float cover = pow(clamp(paintTex.a, 0.0, 1.0), uCoverGamma);
${SHADE}
}
`;

/**
 * The airborne variant. The paint map is a single texture indexed by world XZ, so it has
 * no idea about height: one splat on the ground would colour the island 200 units above
 * it and every creature drifting through that column. Things in the air therefore carry
 * their own colour per instance, written when a drop actually hits them.
 */
const VERTEX_INJECT_INSTANCE = /* glsl */`
#include <project_vertex>
vInkPaint = instancePaint;
`;

const FRAGMENT_INJECT_INSTANCE = /* glsl */`
{
  vec3 pigment = vInkPaint.rgb;
  float cover = pow(clamp(vInkPaint.a, 0.0, 1.0), uCoverGamma);
${SHADE}
}
`;

/**
 * @param {THREE.Material} material
 * @param {{perInstance?: boolean}} [opts] `perInstance` reads an `instancePaint` vec4
 *   attribute instead of the world paint map. For things in the air, which the XZ map
 *   cannot describe. The geometry must carry that attribute.
 * @returns {THREE.Material} the same material, patched in place
 */
export function applyInk(material, { perInstance = false } = {}) {
  const previous = material.onBeforeCompile?.bind(material);

  material.onBeforeCompile = (shader, renderer) => {
    previous?.(shader, renderer);

    shader.uniforms.uPaintMap = { value: null };
    shader.uniforms.uInkWorldSize = { value: WORLD_SIZE };
    shader.uniforms.uPaper = { value: new THREE.Color(0xffffff) };
    shader.uniforms.uCoverGamma = { value: cfg.coverGamma };
    shader.uniforms.uShade = { value: new THREE.Vector2(cfg.shadeFloor, cfg.shadeRange) };
    shader.uniforms.uChroma = { value: cfg.chroma };

    if (!shader.vertexShader.includes(VERTEX_HOOK)) {
      console.warn('[ink] no vertex hook in', material.type, '- object will not take pigment');
      return;
    }
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        perInstance
          ? 'attribute vec4 instancePaint;\nvarying vec4 vInkPaint;\nvoid main() {'
          : 'varying vec3 vInkWorld;\nvoid main() {',
      )
      .replace(VERTEX_HOOK, perInstance ? VERTEX_INJECT_INSTANCE : VERTEX_INJECT);

    const hook = FRAGMENT_HOOKS.find((h) => shader.fragmentShader.includes(h));
    if (!hook) {
      console.warn('[ink] no fragment hook in', material.type, '- object will not take pigment');
      return;
    }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        (perInstance
          ? 'varying vec4 vInkPaint;\n'
          : 'varying vec3 vInkWorld;\nuniform sampler2D uPaintMap;\nuniform float uInkWorldSize;\n')
        + 'uniform vec3 uPaper;\n'
        + 'uniform float uCoverGamma;\nuniform vec2 uShade;\nuniform float uChroma;\n'
        + 'void main() {',
      )
      .replace(hook, hook + (perInstance ? FRAGMENT_INJECT_INSTANCE : FRAGMENT_INJECT));

    patched.add(shader);
  };

  // Without this three can hand back a cached program compiled before the patch, and the
  // two modes compile to different shaders, so they must not share a key either.
  material.customProgramCacheKey = () => (perInstance ? 'paint-instance-v1' : 'paint-v1');
  material.needsUpdate = true;
  return material;
}

/** Point every patched material at this frame's maps, and push live tuning values. */
export function updateInkUniforms(paintTexture) {
  for (const shader of patched) {
    shader.uniforms.uPaintMap.value = paintTexture;
    shader.uniforms.uCoverGamma.value = cfg.coverGamma;
    shader.uniforms.uShade.value.set(cfg.shadeFloor, cfg.shadeRange);
    shader.uniforms.uChroma.value = cfg.chroma;
  }
}
