import GUI from 'lil-gui';
import Stats from 'stats.js';
import { ink, post, density, audio } from './config.js';

/**
 * Live tuning panel. Loaded only when the URL has ?debug, so the production bundle
 * never pulls lil-gui or stats.js in at all (see the dynamic import in main.js).
 *
 * The point is that the final constants come from you moving sliders and looking at
 * the result, rather than from me picking numbers that seemed reasonable.
 */
export function createDebug({ post: postFx, inkMap, ambience }) {
  const stats = new Stats();
  stats.showPanel(0);
  Object.assign(stats.dom.style, { left: 'auto', right: '0px', top: '0px' });
  document.body.appendChild(stats.dom);

  const gui = new GUI({ title: 'ink garden' });

  const fReveal = gui.addFolder('reveal');
  fReveal.add(ink, 'radius', 2, 40, 0.5).name('radius (world units)');
  fReveal.add(ink, 'fadeSeconds', 0.5, 15, 0.1).name('dry time (s)');
  fReveal.add(ink, 'bleed', 0, 4, 0.05).name('bleed');
  fReveal.add(ink, 'edgeWarp', 0, 1.5, 0.01).name('edge raggedness');

  const fPigment = gui.addFolder('pigment');
  fPigment.add(ink, 'washLo', 0, 0.5, 0.005).name('wash start');
  fPigment.add(ink, 'washHi', 0, 0.8, 0.005).name('wash full');
  fPigment.add(ink, 'pigLo', 0, 0.5, 0.005).name('colour start');
  fPigment.add(ink, 'pigHi', 0, 1, 0.005).name('colour full');
  fPigment.add(ink, 'rimStrength', 0, 1, 0.01).name('wet edge');

  const fPaper = gui.addFolder('paper');
  fPaper.add(postFx.watercolor, 'radius', 0, 8, 1).name('kuwahara radius');
  const u = (k) => postFx.watercolor.uniforms.get(k);
  fPaper.add({ v: post.grain }, 'v', 0, 0.4, 0.005).name('grain')
    .onChange((x) => { u('uGrain').value = x; });
  fPaper.add({ v: post.outline }, 'v', 0, 1, 0.01).name('ink outline')
    .onChange((x) => { u('uOutline').value = x; });
  fPaper.add({ v: post.vignette }, 'v', 0, 1, 0.01).name('vignette')
    .onChange((x) => { u('uVignette').value = x; });
  fPaper.add({ v: post.fibre }, 'v', 0, 8, 0.1).name('paper fibre')
    .onChange((x) => { u('uFibre').value = x; });
  fPaper.add({ on: true }, 'on').name('painterly pass')
    .onChange((on) => postFx.setEnabled(on));

  const fAudio = gui.addFolder('audio');
  fAudio.add(audio, 'gainWet', 0, 1, 0.01).name('volume when wet');
  fAudio.add(audio, 'cutoffDry', 100, 4000, 10).name('cutoff when dry');
  fAudio.add({ mute: false }, 'mute').onChange(() => ambience.toggleMute());

  // Density needs a reload: the instanced meshes are built once at startup.
  const fDensity = gui.addFolder('density (reload to apply)');
  const counts = { ...density };
  for (const k of Object.keys(counts)) {
    fDensity.add(counts, k, 0, 30000, 100).onFinishChange(() => {
      const q = new URLSearchParams(location.search);
      q.set('debug', '1');
      for (const [key, v] of Object.entries(counts)) q.set(key, v);
      location.search = q.toString();
    });
  }
  fDensity.close();

  const readout = { wetness: 0 };
  gui.add(readout, 'wetness').listen().disable().name('wetness (audio input)');

  return {
    begin: () => stats.begin(),
    end: () => {
      stats.end();
      readout.wetness = Number(inkMap.wetness.toFixed(3));
    },
  };
}

/** Density overrides from the query string, so a reload can change object counts. */
export function applyDensityOverrides(density) {
  const q = new URLSearchParams(location.search);
  for (const k of Object.keys(density)) {
    const v = Number(q.get(k));
    if (Number.isFinite(v) && q.has(k)) density[k] = v;
  }
}
