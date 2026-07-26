import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(dir, rel === '/' ? 'index.html' : rel);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ channel: 'chrome', headless: false });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => console.log(` [${m.type()}]`, m.text().slice(0, 200)));
page.on('pageerror', (e) => console.log(' [pageerror]', String(e).slice(0, 300)));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(3000);

const info = await page.evaluate(async () => {
  const g = globalThis.__inkGarden;
  g.input.active = true;
  await new Promise((r) => setTimeout(r, 1500));
  const THREE = g.moth.root.constructor;
  const mp = g.moth.root.position, cp = g.camera.position;
  // is the moth in front of the camera at all?
  const toMoth = { x: mp.x - cp.x, y: mp.y - cp.y, z: mp.z - cp.z };
  const dist = Math.hypot(toMoth.x, toMoth.y, toMoth.z);
  const fwd = new (Object.getPrototypeOf(cp).constructor)(0, 0, -1).applyQuaternion(g.camera.quaternion);
  const dot = (toMoth.x * fwd.x + toMoth.y * fwd.y + toMoth.z * fwd.z) / (dist || 1);
  return {
    mothPos: [mp.x.toFixed(1), mp.y.toFixed(1), mp.z.toFixed(1)],
    camPos: [cp.x.toFixed(1), cp.y.toFixed(1), cp.z.toFixed(1)],
    distToMoth: dist.toFixed(2),
    dotForward: dot.toFixed(3),
    mothVisible: g.moth.root.visible,
    mothChildren: g.moth.root.children.length,
    groundY: g.heightAt(mp.x, mp.z).toFixed(1),
    renderCalls: g.renderer.info.render.calls,
    renderTris: g.renderer.info.render.triangles,
    sceneChildren: g.scene.children.length,
    postEnabled: !!g.post,
  };
});
console.log(info);

// render once with the post pass off, to see if the painterly pass is eating everything
await page.evaluate(() => globalThis.__inkGarden.post.setEnabled(false));
await page.waitForTimeout(500);
await page.screenshot({ path: 'docs/_nopost.png' });
await page.evaluate(() => globalThis.__inkGarden.post.setEnabled(true));
await page.waitForTimeout(500);
await page.screenshot({ path: 'docs/_post.png' });
console.log('shots -> docs/_nopost.png docs/_post.png');

await browser.close();
server.close();
