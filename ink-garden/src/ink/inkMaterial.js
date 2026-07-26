import * as THREE from 'three';
import { WORLD_SIZE, ink as cfg } from '../config.js';

/**
 * Patches any three material so its fragments fade to paper white wherever there is
 * no ink, in two stages.
 *
 * The prototype approximated this with `material.color.lerp(GRAY, FULL)`, which just
 * multiplies the texture by 0x999999 -- muted colour, never actually grayscale, and it
 * flips a whole object at once so there is no edge. Sampling a mask per fragment means
 * the boundary can cut straight through a tree trunk, which is what an ink bleed does.
 *
 * Stage 1 (wash): the shape emerges from blank paper as a desaturated gray form.
 * Stage 2 (pigment): colour floods in behind it.
 * Plus a wet edge, where pigment pools darker at the boundary of the blot.
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
  float ink = texture2D(uInkMap, inkUv).r;

  // A wet edge is pigment migrating to the boundary of the wash and drying there.
  // So the rim is not a gray shadow: it carries MORE colour than its surroundings
  // and sits darker. Adding it to pigment before the mix is what sells it.
  float rim = smoothstep(uRim.x, uRim.y, ink) * (1.0 - smoothstep(uRim.y, uRim.z, ink));

  float wash = smoothstep(uWash.x, uWash.y, ink);
  float pigment = clamp(smoothstep(uPig.x, uPig.y, ink) + rim * 0.65, 0.0, 1.0);

  vec3 lum = vec3(dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722)));
  vec3 col = mix(lum, gl_FragColor.rgb, pigment);
  col *= 1.0 - rim * uRimStrength;

  gl_FragColor.rgb = mix(uPaper, col, wash);
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

    shader.uniforms.uInkMap = { value: null };
    shader.uniforms.uInkWorldSize = { value: WORLD_SIZE };
    shader.uniforms.uPaper = { value: new THREE.Color(0xffffff) };
    shader.uniforms.uWash = { value: new THREE.Vector2(cfg.washLo, cfg.washHi) };
    shader.uniforms.uPig = { value: new THREE.Vector2(cfg.pigLo, cfg.pigHi) };
    shader.uniforms.uRim = { value: new THREE.Vector3(cfg.rimLo, cfg.rimMid, cfg.rimHi) };
    shader.uniforms.uRimStrength = { value: cfg.rimStrength };

    if (!shader.vertexShader.includes(VERTEX_HOOK)) {
      console.warn('[ink] no vertex hook in', material.type, '- object will not fade to paper');
      return;
    }
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vInkWorld;\nvoid main() {')
      .replace(VERTEX_HOOK, VERTEX_INJECT);

    const hook = FRAGMENT_HOOKS.find((h) => shader.fragmentShader.includes(h));
    if (!hook) {
      console.warn('[ink] no fragment hook in', material.type, '- object will not fade to paper');
      return;
    }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        'varying vec3 vInkWorld;\n'
        + 'uniform sampler2D uInkMap;\nuniform float uInkWorldSize;\nuniform vec3 uPaper;\n'
        + 'uniform vec2 uWash;\nuniform vec2 uPig;\nuniform vec3 uRim;\nuniform float uRimStrength;\n'
        + 'void main() {',
      )
      .replace(hook, hook + FRAGMENT_INJECT);

    patched.add(shader);
  };

  // Without this three can hand back a cached program compiled before the patch.
  material.customProgramCacheKey = () => 'ink-v1';
  material.needsUpdate = true;
  return material;
}

/** Point every patched material at this frame's mask, and push live tuning values. */
export function updateInkUniforms(texture) {
  for (const shader of patched) {
    shader.uniforms.uInkMap.value = texture;
    shader.uniforms.uWash.value.set(cfg.washLo, cfg.washHi);
    shader.uniforms.uPig.value.set(cfg.pigLo, cfg.pigHi);
    shader.uniforms.uRim.value.set(cfg.rimLo, cfg.rimMid, cfg.rimHi);
    shader.uniforms.uRimStrength.value = cfg.rimStrength;
  }
}
