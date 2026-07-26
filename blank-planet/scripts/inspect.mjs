/**
 * Parks the camera over a painted patch and looks at it. The measure harness always
 * frames the moth, and from 300 units up with the camera aimed at the moth the ground
 * sits off the bottom edge, so its screenshot cannot show what the world looks like.
 *
 * flight.update() returns early when the player is neither locked nor driven, so once
 * input.active goes false the camera can be placed by hand and it stays put.
 */
import { chromium } from 'playwright';

const out = process.argv[2] ?? 'inspect.png';
const HEIGHT = Number(process.argv[3] ?? 150);
const browser = await chromium.launch({ headless: false, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'load' });
await page.waitForFunction(() => !!globalThis.__blankPlanet, null, { timeout: 60000 });

const where = await page.evaluate(async (height) => {
  const g = globalThis.__blankPlanet;
  g.input.active = true;
  // Crawl in a tight circle so the pigment lands in one patch instead of a long arc
  // stretched across the world, which is what makes it possible to frame the result.
  g.input.turn = 0.5;
  const start = g.flight.state.pos.clone();
  for (let i = 0; i < 70; i++) {
    g.flight.state.speed = 2;
    g.dropPigment();
    await new Promise((r) => setTimeout(r, 110));
  }
  const t0 = performance.now();
  while (g.droplets.live.length && performance.now() - t0 < 12000) {
    await new Promise((r) => requestAnimationFrame(r));
  }
  g.input.active = false;
  g.input.turn = 0;
  g.moth.root.visible = false; // it is the one thing that is never washed, and it blocks the view

  const ground = g.heightAt(start.x, start.z);
  g.camera.position.set(start.x, ground + height, start.z + height * 1.5);
  g.camera.lookAt(start.x, ground, start.z);
  return { x: Math.round(start.x), z: Math.round(start.z), ground: Math.round(ground) };
}, HEIGHT);

await page.evaluate(() => {
  document.getElementById('overlay')?.classList.add('hidden');
  document.getElementById('hint')?.classList.add('hidden');
});
await page.waitForTimeout(600);
await page.screenshot({ path: out });
await browser.close();
console.log('wrote', out, JSON.stringify(where));
