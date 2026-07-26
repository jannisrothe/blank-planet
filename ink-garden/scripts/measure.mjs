/**
 * Frame-time harness. Launches the REAL system Chrome, headed, so WebGL runs on
 * the actual GPU. Headless Chrome falls back to SwiftShader software rendering,
 * which makes its FPS numbers useless for this project.
 *
 *   node scripts/measure.mjs --baseline      measure the original prototype
 *   node scripts/measure.mjs                 measure the current ink-garden build
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
  if (skip) return NaN;
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
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 248 && d[i + 1] > 248 && d[i + 2] > 248) white++;
    }
    return white / (w * h);
  }, b64);
}

const ms = (n) => (Number.isFinite(n) ? `${n.toFixed(2)} ms` : 'n/a');
const fps = (n) => (Number.isFinite(n) ? `${(1000 / n).toFixed(1)} fps` : 'n/a');

async function main() {
  const baseline = flag('baseline');
  const dir = baseline ? path.resolve(ROOT, '../ink-game') : path.join(ROOT, 'dist');
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

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2500); // let textures build and the first frames settle

  const whiteIdle = await whiteness(page, uncapped);

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
    const i = globalThis.__inkGarden?.input;
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
      const g = globalThis.__inkGarden;
      g.input.turn = 0.22;
      const t0 = performance.now();
      window.__wet = [];
      window.__alt = [];
      while (performance.now() - t0 < seconds * 1000) {
        await new Promise((r) => requestAnimationFrame(r));
        window.__wet.push(g.inkMap.wetness);
        const p = g.flight.state.pos;
        window.__alt.push(p.y - g.heightAt(p.x, p.z));
      }
      g.input.turn = 0;
    }, SECONDS);
  } else {
    await page.evaluate(async (seconds) => {
      const g = globalThis.__inkGarden;
      window.__wet = [];
      const t0 = performance.now();
      while (performance.now() - t0 < seconds * 1000) {
        await new Promise((r) => requestAnimationFrame(r));
        window.__wet.push(g.inkMap.wetness);
      }
    }, SECONDS);
  }
  const r = await page.evaluate(() => window.__probe.stop());
  const wet = await page.evaluate(() => {
    const w = (window.__wet ?? []).filter((v) => v > 0).sort((a, b) => a - b);
    if (!w.length) return null;
    return { min: w[0], med: w[(w.length / 2) | 0], max: w[w.length - 1] };
  });
  const whiteWalk = await whiteness(page, uncapped);

  // Shot goes here, right after the walk: later steps unlock the pointer, which
  // brings the entry overlay back and washes the whole frame out.
  const shot = value('shot', null);
  if (shot && !uncapped) {
    await page.evaluate(() => {
      document.getElementById('overlay')?.classList.add('hidden');
      document.getElementById('hint')?.classList.add('hidden');
    });
    await page.screenshot({ path: shot });
  }

  // The core promise: with no ink on the paper you cannot see the world at all.
  // Wiping the mask and looking at the same view is a direct test of that.
  let whiteBlank = NaN;
  if (!uncapped && (await page.evaluate(() => !!globalThis.__inkGarden))) {
    await page.evaluate(() => {
      const g = globalThis.__inkGarden;
      g.freeze = true;      // stop the loop re-inking under the player
      g.inkMap.clear();
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
    whiteBlank = await whiteness(page, false);
    await page.evaluate(() => { globalThis.__inkGarden.freeze = false; });
  }

  // Flight: the moth must never clip through the land it is flying over.
  const alt = await page.evaluate(() => {
    const a = window.__alt ?? [];
    if (!a.length) return null;
    return { min: Math.min(...a), max: Math.max(...a), samples: a.length };
  });

  // Audio: the bed must actually be running, and the ink must actually move the mix.
  let sound = null;
  if (!uncapped) {
    sound = await page.evaluate(() => {
      const a = globalThis.__inkGarden?.ambience;
      if (!a) return null;
      a.wanted = true;
      a.update(0.148); // measured stationary equilibrium
      const dry = { gain: a.lastGain, cutoff: a.lastCutoff };
      a.update(0.245); // measured walking peak
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
  console.log(`  fps          p50 ${fps(r.p50)}   p95 ${fps(r.p95)}`);
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
    console.log(`  wetness      min ${wet.min.toFixed(3)}  median ${wet.med.toFixed(3)}  max ${wet.max.toFixed(3)}  (drives the audio mix)`);
  }
  if (sound) {
    const moves = sound.wet.cutoff > sound.dry.cutoff * 2 && sound.wet.gain > sound.dry.gain * 1.5;
    console.log(`  audio        ${sound.ready ? `loaded ${sound.seconds.toFixed(0)}s` : 'NOT LOADED'}, `
      + `context ${sound.state}, ${sound.playing ? 'playing' : 'not playing'}`);
    console.log(`  audio mix    dry ${sound.dry.cutoff.toFixed(0)}Hz @${sound.dry.gain.toFixed(2)} `
      + `-> wet ${sound.wet.cutoff.toFixed(0)}Hz @${sound.wet.gain.toFixed(2)}  ${moves ? 'PASS' : 'FAIL (ink does not move the mix)'}`);
  }
  if (Number.isFinite(whiteBlank)) {
    const pass = whiteBlank > 0.99;
    console.log(`  blank paper  ${(whiteBlank * 100).toFixed(2)}% white with the ink wiped  ${pass ? 'PASS' : 'FAIL (world still visible)'}`);
  }
  console.log(`  console errs ${errors.length}${errors.length ? '\n    ' + errors.slice(0, 5).join('\n    ') : ''}\n`);

  await browser.close();
  server?.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
