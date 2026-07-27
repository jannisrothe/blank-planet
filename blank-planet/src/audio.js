import * as THREE from 'three';
import { audio as cfg } from './config.js';

/**
 * The ambient bed, mixed by the ink rather than just played underneath it.
 *
 * Gain and a lowpass both follow how much paint is on the ground around you: over blank
 * canvas the piano is distant and muffled, and it opens up over a painted stretch. That
 * makes the sound part of the mechanic instead of wallpaper.
 *
 * Looped through an AudioBufferSourceNode rather than an <audio loop> tag, because the
 * tag inserts an audible gap at the seam.
 */
export class Ambience {
  constructor(camera) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);

    this.sound = new THREE.Audio(this.listener);
    this.filter = this.listener.context.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = cfg.reactToPaint ? cfg.cutoffDry : cfg.cutoffWet;
    this.filter.Q.value = 0.7;
    this.sound.setFilter(this.filter);

    this.ready = false;
    this.muted = false;
    this.wanted = false; // whether the player is currently in the garden
  }

  async load() {
    const buffer = await new THREE.AudioLoader().loadAsync(cfg.src);
    this.sound.setBuffer(buffer);
    this.sound.setLoop(true);
    this.sound.setVolume(0);
    this.ready = true;
    if (this.wanted) this.start();
  }

  /** Must be called from a user gesture: browsers start the context suspended. */
  start() {
    this.wanted = true;
    if (!this.ready) return;
    const ctx = this.listener.context;
    if (ctx.state === 'suspended') ctx.resume();
    if (!this.sound.isPlaying) this.sound.play();
  }

  stop() {
    this.wanted = false;
    this.#rampGain(0);
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  #rampGain(target) {
    if (!this.ready) return;
    const g = this.sound.getOutput().gain;
    g.setTargetAtTime(target, this.listener.context.currentTime, cfg.smoothing);
  }

  /** Whether the mix follows how much ground has been painted. Read by the gates. */
  get reactsToPaint() { return !!cfg.reactToPaint; }

  /** @param {number} coverage 0..1 of painted ground around the player */
  update(coverage) {
    if (!this.ready || !this.wanted) return;
    // Held at the open end unless the bed is set to react. The mapping below is kept
    // rather than deleted because it is a real thing the piece can do; it just made the
    // music drop out whenever you flew somewhere you had not painted yet.
    let t = 1;
    if (cfg.reactToPaint) {
      // Map the measured coverage band onto 0..1. See config for where those came from.
      const span = cfg.coverageWet - cfg.coverageDry;
      const x = Math.max(0, Math.min(1, (coverage - cfg.coverageDry) / span));
      t = x * x * (3 - 2 * x); // smoothstep, so the ends ease instead of clipping
    }
    const gain = this.muted ? 0 : cfg.gainDry + (cfg.gainWet - cfg.gainDry) * t;
    // Cutoff moves geometrically, because pitch perception is logarithmic.
    const cutoff = cfg.cutoffDry * (cfg.cutoffWet / cfg.cutoffDry) ** t;
    const now = this.listener.context.currentTime;
    this.#rampGain(gain);
    this.filter.frequency.setTargetAtTime(cutoff, now, cfg.smoothing);
    // Recorded so a test can assert the mapping without waiting for the ramps to settle.
    this.lastGain = gain;
    this.lastCutoff = cutoff;
  }
}
