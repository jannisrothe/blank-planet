import GUI from 'lil-gui';
import Stats from 'stats.js';
import { paint as paintCfg, post, density, audio, flight as flightCfg } from './config.js';

/**
 * Live tuning panel. Loaded only when the URL has ?debug, so the production bundle
 * never pulls lil-gui or stats.js in at all (see the dynamic import in main.js).
 *
 * The point is that the final constants come from you moving sliders and looking at
 * the result, rather than from me picking numbers that seemed reasonable.
 */
export function createDebug({ post: postFx, paint, ambience }) {
  const stats = new Stats();
  stats.showPanel(0);
  Object.assign(stats.dom.style, { left: 'auto', right: '0px', top: '0px' });
  document.body.appendChild(stats.dom);

  const gui = new GUI({ title: 'blank planet' });

  const fSplat = gui.addFolder('splat');
  fSplat.add(paintCfg, 'radius', 1, 80, 0.5).name('splat size (units)');
  fSplat.add(paintCfg, 'spikes', 0, 3, 0.02).name('spike length');
  fSplat.add(paintCfg, 'satellites', 0, 3, 0.02).name('spatter spread');
  fSplat.add(paintCfg, 'edgeSoftness', 0, 0.5, 0.005).name('edge softness');
  fSplat.add(paintCfg, 'wobble', 0, 1, 0.01).name('out of round');
  fSplat.add(paintCfg, 'tooth', 0, 1, 0.01).name('canvas tooth');

  const fWash = gui.addFolder('paint');
  fWash.add(paintCfg, 'coverGamma', 0.3, 2, 0.01).name('coverage gamma');
  fWash.add(paintCfg, 'shadeFloor', 0, 1, 0.01).name('shading floor');
  fWash.add(paintCfg, 'shadeRange', 0, 2, 0.01).name('shading range');
  fWash.add(paintCfg, 'chroma', 1, 2.5, 0.01).name('chroma boost');

  const fPaper = gui.addFolder('paper');
  fPaper.add(postFx.watercolor, 'radius', 0, 8, 1).name('kuwahara radius');
  const u = (k) => postFx.watercolor.uniforms.get(k);
  fPaper.add({ v: post.grain }, 'v', 0, 0.4, 0.005).name('grain')
    .onChange((x) => { u('uGrain').value = x; });
  fPaper.add({ v: post.outline }, 'v', 0, 1, 0.01).name('ink outline')
    .onChange((x) => { u('uOutline').value = x; });
  fPaper.add({ v: post.contour }, 'v', 0, 1, 0.01).name('contour (depth)')
    .onChange((x) => { u('uContour').value = x; });
  fPaper.add({ v: post.crease }, 'v', 0, 1, 0.01).name('crease (inside shapes)')
    .onChange((x) => { u('uCrease').value = x; });
  fPaper.add({ v: post.contourWidth }, 'v', 0.5, 4, 0.1).name('contour width')
    .onChange((x) => { u('uContourWidth').value = x; });
  fPaper.add({ v: post.vignette }, 'v', 0, 1, 0.01).name('vignette')
    .onChange((x) => { u('uVignette').value = x; });
  fPaper.add({ v: post.fibre }, 'v', 0, 8, 0.1).name('paper fibre')
    .onChange((x) => { u('uFibre').value = x; });
  fPaper.add({ on: true }, 'on').name('painterly pass')
    .onChange((on) => postFx.setEnabled(on));

  const fFlight = gui.addFolder('flight');
  fFlight.add(flightCfg, 'driftSpeed', 1, 30, 0.5).name('drift speed');
  fFlight.add(flightCfg, 'groundClearance', 5, 400, 1).name('min altitude');
  fFlight.add(flightCfg, 'smoothing', 0.5, 8, 0.1).name('steering weight');
  fFlight.add(flightCfg, 'camUp', 0, 40, 0.5).name('camera height');
  fFlight.add(flightCfg, 'camBack', 2, 30, 0.5).name('camera distance');
  fFlight.add(flightCfg, 'camAim', 0, 30, 0.5).name('camera look-down');

  const fAudio = gui.addFolder('audio');
  fAudio.add(audio, 'gainWet', 0, 1, 0.01).name('volume when wet');
  fAudio.add(audio, 'cutoffDry', 100, 4000, 10).name('cutoff when dry');
  fAudio.add({ mute: false }, 'mute').onChange(() => ambience.toggleMute());

  // Density needs a reload: the instanced meshes are built once at startup.
  const fDensity = gui.addFolder('density (reload to apply)');
  const counts = { ...density };
  for (const k of Object.keys(counts)) {
    // One range for everything put the lifeform counts, which are in the tens, on a
    // slider that stepped by 100. Scale the range and step to the value it starts at.
    const max = Math.max(50, counts[k] * 4);
    fDensity.add(counts, k, 0, max, max > 4000 ? 100 : 1).onFinishChange(() => {
      const q = new URLSearchParams(location.search);
      q.set('debug', '1');
      for (const [key, v] of Object.entries(counts)) q.set(key, v);
      location.search = q.toString();
    });
  }
  fDensity.close();

  const readout = { coverage: 0, splats: 0 };
  gui.add(readout, 'coverage').listen().disable().name('coverage (audio input)');
  gui.add(readout, 'splats').listen().disable().name('splats landed');

  return {
    begin: () => stats.begin(),
    end: () => {
      stats.end();
      readout.coverage = Number(paint.coverage.toFixed(3));
      readout.splats = paint.splats;
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
