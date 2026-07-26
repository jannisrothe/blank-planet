import { EffectComposer, EffectPass, RenderPass } from 'postprocessing';
import { WatercolorEffect } from './WatercolorEffect.js';
import { post as cfg } from '../config.js';

export function createComposer(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const watercolor = new WatercolorEffect(cfg);
  const pass = new EffectPass(camera, watercolor);
  composer.addPass(pass);

  addEventListener('resize', () => composer.setSize(innerWidth, innerHeight));

  return {
    composer,
    watercolor,
    /** Lets the debug panel and the A/B comparison turn the painterly layer off. */
    setEnabled(on) { pass.enabled = on; },
    render(dt) { composer.render(dt); },
  };
}
