/**
 * Frame-time harness. Launches the REAL system Chrome, headed, so WebGL runs on
 * the actual GPU. Headless Chrome falls back to SwiftShader software rendering,
 * which makes its FPS numbers useless for this project.
 *
 *   node scripts/measure.mjs --baseline      measure the original prototype
 *   node scripts/measure.mjs                 measure the current blank-planet build
 *   node scripts/measure.mjs --url <url>     measure anything else
 *
 * Flags: --seconds <n>  --no-walk  --shot <path>
 */

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const SECONDS = Number(value('seconds', 12));
const WALK = !flag('no-walk');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
};

function serve(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]);
      let file = path.join(dir, rel === '/' ? 'index.html' : rel);
      if (!file.startsWith(dir)) return res.writeHead(403).end();
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        const html = fs.readdirSync(dir).find((f) => f.endsWith('.html'));
        if (rel === '/' && html) file = path.join(dir, html);
        else return res.writeHead(404).end('not found');
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/**
 * Runs before any page script. Counts real GL draw calls per frame by wrapping the
 * context prototypes, and records rAF deltas. Works on any page, no app hooks needed.
 */
const PROBE = () => {
  const frames = [];
  let draws = 0;
  let drawsAtStart = 0;

  for (const Ctx of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!Ctx) continue;
    for (const m of ['drawArrays', 'drawElements', 'drawArraysInstanced',
                     'drawElementsInstanced', 'drawRangeElements']) {
      const orig = Ctx.prototype[m];
      if (!orig) continue;
      Ctx.prototype[m] = function (...args) { draws++; return orig.apply(this, args); };
    }
  }

  let last = performance.now();
  let recording = false;
  const tick = () => {
    const now = performance.now();
    if (recording) frames.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  window.__probe = {
    start() { frames.length = 0; drawsAtStart = draws; recording = true; last = performance.now(); },
    stop() {
      recording = false;
      const s = frames.slice(2).sort((a, b) => a - b);
      const at = (q) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : NaN);
      return {
        samples: s.length,
        p50: at(0.5), p95: at(0.95), p99: at(0.99),
        worst: s[s.length - 1],
        mean: s.reduce((a, b) => a + b, 0) / (s.length || 1),
        // averaged over the window: per-frame sampling races the app's own rAF
        drawCalls: s.length ? Math.round((draws - drawsAtStart) / s.length) : NaN,
      };
    },
    /**
     * Look around without touching the real mouse. Absolute mouse.move() while
     * pointer-locked makes Chrome drop the lock, which silently ends the walk
     * and re-shows the white overlay.
     */
    look(dx, dy) {
      // movementX/Y are readonly accessors, so they must come from the init dict
      document.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, movementX: dx, movementY: dy,
      }));
    },
    locked: () => document.pointerLockElement !== null,
  };
};

/**
 * Share of pixels that are effectively pure paper white.
 * Reads a real screenshot rather than the live canvas: without
 * preserveDrawingBuffer the WebGL drawing buffer is already cleared by the time
 * any in-page read runs, so drawImage() would report a blank frame.
 */
async function whiteness(page, skip) {
  // Playwright waits for a stable compositor frame, which never arrives with
  // vsync disabled. Perf runs skip the pixel check; visual gates run capped.
  if (skip) return { white: NaN, coloured: NaN };
  const b64 = (await page.screenshot({ type: 'png' })).toString('base64');
  return page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const w = 320, h = Math.max(1, Math.round((img.height / img.width) * 320));
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const ctx = off.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    let white = 0;
    let coloured = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (r > 248 && g > 248 && b > 248) white++;
      // Chroma, not brightness. The contour pass draws the world in grey line, so an
      // unpainted planet is no longer a blank sheet -- but it must still carry no
      // pigment, and grey has none.
      else if (Math.max(r, g, b) - Math.min(r, g, b) > 22) coloured++;
    }
    return { white: white / (w * h), coloured: coloured / (w * h) };
  }, b64);
}

const ms = (n) => (Number.isFinite(n) ? `${n.toFixed(2)} ms` : 'n/a');
const fps = (n) => (Number.isFinite(n) ? `${(1000 / n).toFixed(1)} fps` : 'n/a');

async function main() {
  const baseline = flag('baseline');
  const dir = baseline ? path.resolve(ROOT, '../prototype') : path.join(ROOT, 'dist');
  let url = value('url', null);
  let server = null;

  if (!url) {
    if (!baseline && !fs.existsSync(dir)) {
      console.error(`No build at ${dir}. Run \`npm run build\` first, or pass --url http://localhost:5173`);
      process.exit(1);
    }
    ({ server } = await serve(dir));
    url = `http://127.0.0.1:${server.address().port}/`;
  }

  console.log(`\n  target   ${baseline ? 'BASELINE (original prototype)' : url}`);
  console.log(`  chrome   system Google Chrome, headed, hardware GPU`);
  console.log(`  window   ${SECONDS}s${WALK ? ', walking a circle' : ', stationary'}`);
  console.log(`  vsync    ${flag('uncapped') ? 'OFF (true frame cost)' : 'ON (capped at 60fps)'}\n`);

  // Capped runs pin to vsync at 16.67 ms and tell you nothing about headroom.
  // Uncapped removes the vsync wait so the number is the actual cost of a frame.
  const uncapped = flag('uncapped');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: uncapped ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(PROBE);
  const page = await context.newPage();

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  // What can this browser do with nothing to draw? Every frame number below is capped by
  // this, and when the display drops to 30Hz -- an external monitor, a power setting, a
  // Chrome throttle -- the whole run silently reads 30.0 fps no matter what the code
  // does. That is worse than no number, because it looks like a measurement: a session
  // spent here concluded the renderer was fill-bound and that cutting 72,000 instances
  // changed nothing, when in fact nothing could have changed anything.
  await page.setContent('<body></body>');
  const cadence = await page.evaluate(() => new Promise((res) => {
    const d = []; let last = performance.now(); let i = 0;
    const tick = () => {
      const n = performance.now(); d.push(n - last); last = n;
      if (++i < 60) requestAnimationFrame(tick);
      else { d.sort((a, b) => a - b); res(d[30]); }
    };
    requestAnimationFrame(tick);
  }));
  const cadenceFps = 1000 / cadence;
  const throttled = !uncapped && cadenceFps < 50;
  console.log(`  cadence  blank page runs at ${cadenceFps.toFixed(1)} fps`
    + (throttled ? '  ** THROTTLED: frame numbers below are meaningless **' : ''));

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2500); // let textures build and the first frames settle

  const whiteIdle = (await whiteness(page, uncapped)).white;

  // A trusted click on the overlay grants pointer lock and unblocks audio.
  // bringToFront() matters: without focus Chrome rejects the lock request.
  // Chrome under automation sometimes grants the lock on its own before we get here,
  // in which case the overlay is already gone and clicking it would hang.
  await page.bringToFront();
  const overlay = page.locator('#overlay');
  if (await overlay.isVisible()) await overlay.click();
  await page.waitForTimeout(600);

  // Chrome revokes pointer lock on its own within seconds under automation, even with
  // no input at all, so the harness drives movement through the app's test input hook
  // instead. Without this the player never moves and every gate passes vacuously.
  const driven = await page.evaluate(() => {
    const i = globalThis.__blankPlanet?.input;
    if (!i) return false;
    i.active = true;
    return true;
  });
  if (!driven) console.warn('  ! no input hook; falling back to pointer lock\n');

  await page.evaluate(() => window.__probe.start());
  if (WALK) {
    // Constant yaw, so the player walks a circle of roughly 40 units instead of
    // sprinting into the world edge and staring at empty space for half the run.
    // The moth always drifts forward, so the harness only has to steer. A constant
    // turn keeps it circling inside the world instead of pinning to the edge.
    await page.evaluate(async (seconds) => {
      const g = globalThis.__blankPlanet;
      g.input.turn = 0.22;
      const t0 = performance.now();
      window.__wet = [];
      window.__alt = [];
      while (performance.now() - t0 < seconds * 1000) {
        await new Promise((r) => requestAnimationFrame(r));
        window.__wet.push(g.paint.coverage);
        const p = g.flight.state.pos;
        window.__alt.push(g.altitudeAt(p));
      }
      g.input.turn = 0;
    }, SECONDS);
  } else {
    await page.evaluate(async (seconds) => {
      const g = globalThis.__blankPlanet;
      window.__wet = [];
      const t0 = performance.now();
      while (performance.now() - t0 < seconds * 1000) {
        await new Promise((r) => requestAnimationFrame(r));
        window.__wet.push(g.paint.coverage);
      }
    }, SECONDS);
  }
  const r = await page.evaluate(() => window.__probe.stop());
  const wet = await page.evaluate(() => {
    const w = (window.__wet ?? []).filter((v) => v > 0).sort((a, b) => a - b);
    if (!w.length) return null;
    return { min: w[0], med: w[(w.length / 2) | 0], max: w[w.length - 1] };
  });
  const whiteWalk = (await whiteness(page, uncapped)).white;

  // Shot goes here, right after the walk: later steps unlock the pointer, which
  // brings the entry overlay back and washes the whole frame out.
  const shot = value('shot', null);
  if (shot && !uncapped) {
    // Paint some pigment into view first, otherwise the shot is a blank sheet.
    await page.evaluate(async () => {
      const g = globalThis.__blankPlanet;
      g.input.turn = 0.06;
      // Climb first, so the shot looks out over the landscape rather than sitting in it.
      g.input.climb = 0.5;
      await new Promise((r) => setTimeout(r, 2000));
      g.input.climb = 0;
      for (let i = 0; i < 26; i++) {
        g.dropPigment();
        await new Promise((r) => setTimeout(r, 190));
      }
      g.input.turn = 0;
      g.input.climb = -0.25;
      await new Promise((r) => setTimeout(r, 900));
      g.input.climb = 0;
      await new Promise((r) => setTimeout(r, 2600));
    });
    await page.evaluate(() => {
      document.getElementById('overlay')?.classList.add('hidden');
      document.getElementById('hint')?.classList.add('hidden');
    });
    await page.screenshot({ path: shot });
  }

  // The core promise: with no ink on the paper you cannot see the world at all.
  // Wiping the mask and looking at the same view is a direct test of that.
  let blank = null;
  if (!uncapped && (await page.evaluate(() => !!globalThis.__blankPlanet))) {
    // Let anything still falling land first. Hiding a droplet mid-flight races with the
    // screenshot, and a single airborne blob is enough to fail this gate.
    await page.evaluate(async () => {
      const g = globalThis.__blankPlanet;
      const t0 = performance.now();
      while (g.droplets?.live.length && performance.now() - t0 < 9000) {
        await new Promise((r) => requestAnimationFrame(r));
      }
    });
    await page.evaluate(() => {
      const g = globalThis.__blankPlanet;
      (g.clearPigment ?? (() => g.paint.clear()))();

      // Aim at the ground before measuring anything. The walk leaves the camera wherever
      // the flight path put it, which after the beauty-shot climb is usually the sky, and
      // then both halves of this gate are measuring framing luck: a frame of empty white
      // passes "no pigment" for the wrong reason and fails "contours" for the wrong
      // reason. Flattening the mountains was what exposed it -- the horizon dropped out
      // of frame and the contour reading fell from 7% to 0.26% with nothing wrong.
      if (g.flight && g.camera && g.radiusAt) {
        g.input.active = false;
        g.flight.state.locked = false;
        const st = g.flight.state;
        const surface = g.radiusAt(st.pos);
        // Stand off along the surface and look back down at it, so the frame is ground
        // rather than sky whatever heading the walk finished on.
        g.camera.position.copy(st.pos).normalize().multiplyScalar(surface + 70)
          .addScaledVector(st.forward, -90);
        g.camera.up.copy(st.up);
        g.camera.lookAt(st.pos.clone().normalize().multiplyScalar(surface));
      }

      // The moth is deliberately never ink-washed, so it is always visible. This gate
      // is about whether the WORLD disappears, so the moth is not part of it.
      if (g.moth) g.moth.root.visible = false;
      // droplets in flight are not world either; they are paint you have not landed yet
      for (const d of g.droplets?.live ?? []) d.mesh.visible = false;
      // The debug panel and FPS meter are DOM, not world. Counting their pixels
      // would fail this gate for a reason that has nothing to do with the render.
      document.getElementById('overlay')?.classList.add('hidden');
      document.getElementById('hint')?.classList.add('hidden');
      for (const el of document.querySelectorAll('.lil-gui, .stats, #stats')) el.style.display = 'none';
      for (const el of document.querySelectorAll('body > div')) {
        if (el.style.position === 'fixed' && el.querySelector('canvas')) el.style.display = 'none';
      }
    });
    await page.waitForTimeout(400);
    blank = await whiteness(page, false);
    // Save the frame when it fails: "something is still visible" is not actionable
    // without seeing what.
    if (blank.coloured > 0.002) {
      await page.screenshot({ path: 'docs/_blankfail.png' });
      const why = await page.evaluate(() => {
        const g = globalThis.__blankPlanet;
        const visible = [];
        g.scene.traverse((o) => {
          if (o.isMesh && o.visible && o.parent?.visible !== false) {
            visible.push(`${o.geometry?.type ?? '?'} @${o.position.toArray().map((v) => v.toFixed(0)).join(',')}`);
          }
        });
        return {
          mothVisible: g.moth.root.visible,
          dropletsLive: g.droplets.live.length,
          dropletsVisible: g.droplets.live.filter((d) => d.mesh.visible).length,
          visibleMeshes: visible.slice(0, 8),
        };
      });
      console.log('  blank debug ', JSON.stringify(why));
    }
    await page.evaluate(() => {
      globalThis.__blankPlanet.freeze = false;
      if (globalThis.__blankPlanet.moth) globalThis.__blankPlanet.moth.root.visible = true;
    });
  }

  // Flight: the moth must never clip through the land it is flying over.
  const alt = await page.evaluate(() => {
    const a = window.__alt ?? [];
    if (!a.length) return null;
    return { min: Math.min(...a), max: Math.max(...a), samples: a.length };
  });

  // Paint gates. Oil covers rather than blends and never dries away, so these assert
  // behaviour rather than just checking nothing crashed.
  let bloom = null;
  if (!uncapped && (await page.evaluate(() => !!globalThis.__blankPlanet?.paint))) {
    bloom = await page.evaluate(async () => {
      const g = globalThis.__blankPlanet;
      const Colour = g.paint.uniforms.uColor.value.constructor;
      const Vec3 = g.paint.uniforms.uCentreDir.value.constructor;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      // Somewhere on the equator. The splat takes a world position now, not an x/z pair.
      const spot = new Vec3(1, 0, 0);
      const at = spot.clone().multiplyScalar(g.radiusAt(spot));
      const vel = new Vec3(0, -1, 0);

      (g.clearPigment ?? (() => g.paint.clear()))();
      await wait(200);
      const before = await g.paint.sampleAt(spot);

      g.paint.splat(at, new Colour(1, 0, 1), vel, 1);
      await wait(600);
      const landed = await g.paint.sampleAt(spot);

      await wait(9000);
      const later = await g.paint.sampleAt(spot);

      // Cyan straight over the magenta: oil covers, so the result should read cyan,
      // not the violet an averaging model would produce.
      g.paint.splat(at, new Colour(0, 1, 1), vel, 1);
      await wait(600);
      const over = await g.paint.sampleAt(spot);

      return { before, landed, later, over };
    });
  }

  // Droplets must actually fall and land, not stamp instantly.
  let fall = null;
  if (!uncapped && (await page.evaluate(() => !!globalThis.__blankPlanet?.droplets))) {
    fall = await page.evaluate(async () => {
      const g = globalThis.__blankPlanet;
      // Wait out anything still falling from the beauty-shot pass, or its landing is
      // mistaken for this droplet stamping instantly.
      const settle = performance.now();
      while (g.droplets.live.length && performance.now() - settle < 8000) {
        await new Promise((r) => requestAnimationFrame(r));
      }
      const before = g.paint.splats;
      g.dropPigment();
      const airborneAfterAFrame = await new Promise((r) => requestAnimationFrame(() => r(g.droplets.live.length)));
      const stampedImmediately = g.paint.splats > before;
      let t0 = performance.now();
      while (g.paint.splats === before && performance.now() - t0 < 8000) {
        await new Promise((r) => requestAnimationFrame(r));
      }
      return {
        airborneAfterAFrame,
        stampedImmediately,
        flightMs: Math.round(performance.now() - t0),
        landed: g.paint.splats > before,
      };
    });
  }

  // The whole point of the sphere: hold a heading and you come back. Nothing about a
  // screenshot can show this, and a flat world with a wrap-around hack would fail it by
  // drifting, so it is worth its own gate.
  let lap = null;
  if (!uncapped && (await page.evaluate(() => !!globalThis.__blankPlanet?.radiusAt))) {
    lap = await page.evaluate(async () => {
      const g = globalThis.__blankPlanet;
      const st = g.flight.state;
      g.input.active = true;
      g.input.turn = 0;
      g.input.trim = 0;
      // Start from a known state. The walk above leaves an accumulated pending yaw and
      // whatever speed its trim wandered to, and inheriting either makes this measure
      // the walk rather than the geometry.
      st.turn = 0;
      st.speed = 20;
      // Nose level. The ground-clearance rule pitches up whenever it clips the floor and
      // nothing pulls it back, so a long flight climbs; that is a separate question.
      st.pitch = 0;
      st.targetPitch = 0;
      const start = st.pos.clone();
      let closest = Infinity;
      let at = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < 100000) {
        await new Promise((r) => requestAnimationFrame(r));
        st.targetPitch = 0;
        st.speed = 20;
        const dt = performance.now() - t0;
        if (dt > 25000) {
          const d = st.pos.distanceTo(start);
          if (d < closest) { closest = d; at = dt; }
        }
      }
      g.input.active = false;
      return { closest: Math.round(closest), seconds: Math.round(at / 1000) };
    });
  }

  // A splat must be as round at the pole as at the equator. The map is equirectangular,
  // so measuring 2D distance in it would smear a polar splat across the whole width;
  // the shader measures angle instead, and this is what proves it.
  let poles = null;
  if (!uncapped && (await page.evaluate(() => !!globalThis.__blankPlanet?.paint))) {
    poles = await page.evaluate(async () => {
      const g = globalThis.__blankPlanet;
      const V = g.flight.state.pos.constructor;
      const C = g.scene.background.constructor ?? Object;
      const area = async (dir) => {
        g.paint.clear();
        const at = dir.clone().multiplyScalar(g.radiusAt(dir));
        g.paint.splat(at, new C(0xff00ff), new V(1, 0, 0), 1);
        await new Promise((r) => requestAnimationFrame(r));
        const S = 2048;
        const buf = new Uint8Array(S * S * 4);
        await g.renderer.readRenderTargetPixelsAsync(g.paint.target, 0, 0, S, S, buf);
        // Weight each row by cos(latitude): equirect rows near a pole cover far less
        // actual surface, so raw texel counts would say a polar splat is enormous.
        let a = 0;
        for (let y = 0; y < S; y++) {
          const w = Math.cos((y / S - 0.5) * Math.PI);
          for (let x = 0; x < S; x++) if (buf[(y * S + x) * 4 + 3] > 8) a += w;
        }
        return a;
      };
      const equator = await area(new V(1, 0, 0));
      const pole = await area(new V(0, 1, 0));
      g.paint.clear();
      return { equator: Math.round(equator), pole: Math.round(pole),
               ratio: Number((pole / Math.max(equator, 1)).toFixed(3)) };
    });
  }

  // Audio: the bed must actually be running, and the ink must actually move the mix.
  let sound = null;
  if (!uncapped) {
    sound = await page.evaluate(() => {
      const a = globalThis.__blankPlanet?.ambience;
      if (!a) return null;
      a.wanted = true;
      a.update(0.0);  // blank canvas
      const dry = { gain: a.lastGain, cutoff: a.lastCutoff };
      a.update(0.60); // well-painted ground
      const wet = { gain: a.lastGain, cutoff: a.lastCutoff };
      return {
        ready: a.ready,
        playing: a.sound.isPlaying,
        state: a.listener.context.state,
        seconds: a.sound.buffer?.duration ?? 0,
        dry, wet,
      };
    });
  }



  console.log(`  frame time   p50 ${ms(r.p50)}   p95 ${ms(r.p95)}   p99 ${ms(r.p99)}   worst ${ms(r.worst)}`);
  console.log(`  fps          p50 ${fps(r.p50)}   p95 ${fps(r.p95)}`
    + (throttled ? `  ** capped by a ${cadenceFps.toFixed(0)}Hz display, not by the code **` : ''));
  if (uncapped && r.p50 < 1) {
    console.log('  ! p50 under 1ms means the JS loop has run ahead of the GPU: rAF is');
    console.log('    returning before the frame is drawn, so these deltas are JS time,');
    console.log('    not frame cost. Trust the capped run instead.');
  }
  console.log(`  draw calls   ${r.drawCalls}`);
  console.log(`  samples      ${r.samples}`);
  console.log(`  input        ${driven ? 'driven directly (pointer lock is unreliable in automation)' : 'pointer lock'}`);
  if (Number.isFinite(whiteIdle)) {
    console.log(`  white pixels ${(whiteIdle * 100).toFixed(1)}% before entering -> ${(whiteWalk * 100).toFixed(1)}% while walking`);
  }
  if (alt) {
    const pass = alt.min > 0;
    console.log(`  clearance    above terrain: min ${alt.min.toFixed(1)} max ${alt.max.toFixed(1)} over ${alt.samples} frames  ${pass ? 'PASS' : 'FAIL (clipped through)'}`);
  }
  if (wet) {
    console.log(`  coverage     min ${wet.min.toFixed(3)}  median ${wet.med.toFixed(3)}  max ${wet.max.toFixed(3)}  (drives the audio mix)`);
  }
  if (bloom) {
    const b = bloom;
    const grew = b.before.a < 8 && b.landed.a > 60;
    console.log(`  splat        coverage ${b.before.a} -> ${b.landed.a} on impact  ${grew ? 'PASS' : 'FAIL (nothing landed)'}`);

    // Permanence: oil never dries away. This would regress silently.
    const kept = b.later.a >= b.landed.a - 3;
    console.log(`  permanence   coverage ${b.landed.a} -> ${b.later.a} 9s later  ${kept ? 'PASS' : 'FAIL (paint faded)'}`);

    // Covering, not blending: cyan over magenta must read cyan.
    const o = b.over;
    const covered = o.g > 150 && o.b > 150 && o.r < 120;
    console.log(`  covers       magenta rgb(${b.landed.r},${b.landed.g},${b.landed.b}) then cyan -> rgb(${o.r},${o.g},${o.b})  ${covered ? 'PASS' : 'FAIL (blended instead of covering)'}`);
  }
  if (fall) {
    const ok = fall.airborneAfterAFrame > 0 && !fall.stampedImmediately && fall.landed;
    console.log(`  droplet      airborne ${fall.airborneAfterAFrame}, fell for ${fall.flightMs}ms, ${fall.landed ? 'landed' : 'NEVER LANDED'}  ${ok ? 'PASS' : 'FAIL (did not travel before splatting)'}`);
  }
  if (lap) {
    const ok = lap.closest < 60;
    console.log(`  lap          held a heading and came back within ${lap.closest} units after ${lap.seconds}s  ${ok ? 'PASS' : 'FAIL (heading drifts, or the world does not wrap)'}`);
  }
  if (poles) {
    const ok = poles.ratio > 0.85 && poles.ratio < 1.18;
    console.log(`  polar splat  pole/equator painted area ${poles.ratio}  ${ok ? 'PASS' : 'FAIL (splats distort toward the poles)'}`);
  }
  if (blank && Number.isFinite(blank.coloured)) {
    // The premise moved. It used to be "with the ink wiped the frame is pure white",
    // which the contour pass now breaks on purpose: the planet is drawn in grey line so
    // you can tell you are moving. What has to hold is that none of it carries pigment.
    const clean = blank.coloured <= 0.002;
    const drawn = blank.white < 0.995;
    console.log(`  no pigment   ${(blank.coloured * 100).toFixed(2)}% of pixels carry colour with the ink wiped  ${clean ? 'PASS' : 'FAIL (pigment survived the wipe)'}`);
    console.log(`  contours     ${((1 - blank.white) * 100).toFixed(2)}% of pixels are line work  ${drawn ? 'PASS' : 'FAIL (unpainted world is invisible)'}`);
  }
  console.log(`  console errs ${errors.length}${errors.length ? '\n    ' + errors.slice(0, 5).join('\n    ') : ''}\n`);

  await browser.close();
  server?.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
