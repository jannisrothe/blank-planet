import * as THREE from 'three';
import { WORLD_SIZE, ink as cfg } from '../config.js';

/**
 * Patches any three material so it is invisible on blank paper and takes on whatever
 * pigment has been dropped over it.
 *
 * v1 sampled a scalar mask and mixed toward white: the ink was a clear reveal and each
 * object supplied its own colour. Now the pigment carries the colour, so a magenta drop
 * stains ground, plants and rock alike, and two overlapping drops mix.
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

const FRAGMENT_INJECT = /* glsl */`
{
  vec2 inkUv = vInkWorld.xz / uInkWorldSize + 0.5;
  vec4 dryTex = texture2D(uDryMap, inkUv);
  vec4 wetTex = texture2D(uWetMap, inkUv);

  // Suspended pigment sits on top of what has already dried.
  vec3 pigment = mix(dryTex.rgb, wetTex.rgb, clamp(wetTex.a * 1.6, 0.0, 1.0));
  float cover = clamp(dryTex.a + wetTex.a, 0.0, 1.0);
  cover = pow(cover, uCoverGamma);

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
}
`;

/**
 * @param {THREE.Material} material
 * @returns {THREE.Material} the same material, patched in place
 */
export function applyInk(material) {
  const previous = material.onBeforeCompile?.bind(material);

  material.onBeforeCompile = (shader, renderer) => {
    previous?.(shader, renderer);

    shader.uniforms.uWetMap = { value: null };
    shader.uniforms.uDryMap = { value: null };
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
      .replace('void main() {', 'varying vec3 vInkWorld;\nvoid main() {')
      .replace(VERTEX_HOOK, VERTEX_INJECT);

    const hook = FRAGMENT_HOOKS.find((h) => shader.fragmentShader.includes(h));
    if (!hook) {
      console.warn('[ink] no fragment hook in', material.type, '- object will not take pigment');
      return;
    }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        'varying vec3 vInkWorld;\n'
        + 'uniform sampler2D uWetMap;\nuniform sampler2D uDryMap;\n'
        + 'uniform float uInkWorldSize;\nuniform vec3 uPaper;\n'
        + 'uniform float uCoverGamma;\nuniform vec2 uShade;\nuniform float uChroma;\n'
        + 'void main() {',
      )
      .replace(hook, hook + FRAGMENT_INJECT);

    patched.add(shader);
  };

  // Without this three can hand back a cached program compiled before the patch.
  material.customProgramCacheKey = () => 'ink-v2';
  material.needsUpdate = true;
  return material;
}

/** Point every patched material at this frame's maps, and push live tuning values. */
export function updateInkUniforms(wetTexture, dryTexture) {
  for (const shader of patched) {
    shader.uniforms.uWetMap.value = wetTexture;
    shader.uniforms.uDryMap.value = dryTexture;
    shader.uniforms.uCoverGamma.value = cfg.coverGamma;
    shader.uniforms.uShade.value.set(cfg.shadeFloor, cfg.shadeRange);
    shader.uniforms.uChroma.value = cfg.chroma;
  }
}
