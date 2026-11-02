import {MAX_TRACK_SPEED} from '../data/gameBalance.js';
import {LANE_CENTERS} from '../core/hazards.js';

const PICKUP_NOTES = [60, 62, 64, 67, 72].map(note => 440 * 2 ** ((note - 69) / 12));
const MAX_VOICES = 12;

/** Cosmetic feedback only; Phaser owns the shared AudioContext and master mute/volume. */
export class RunFeedback {
  constructor(scene, {navigator = globalThis.navigator, report = console.warn} = {}) {
    this.context = scene.sound?.context;
    this.destination = scene.sound?.destination;
    this.navigator = navigator;
    this.report = report;
    this.warnings = new Set();
    this.voices = new Set();
    this.suspensions = new Set();
    this.removers = [];
    this.engineSpeed = null;
    this.lastPickup = -Infinity;
    this.pickupStreak = 0;
    this.interacted = false;
    this.destroyed = false;
    this.unlocking = null;
    const unlock = () => this.unlock();
    const canvas = scene.game.canvas;
    const document = canvas.ownerDocument;
    for (const [target, event] of [[canvas, 'pointerdown'], [document, 'keydown']]) {
      // Capture precedes menu controls that stop Phaser's pointer propagation.
      target.addEventListener(event, unlock, true);
      this.removers.push(() => target.removeEventListener(event, unlock, true));
    }
    for (const [emitter, off, on, reason] of [
      [scene.events, 'pause', 'resume', 'pause'],
      [scene.events, 'sleep', 'wake', 'sleep'],
      [scene.game.events, 'blur', 'focus', 'blur'],
      [scene.game.events, 'hidden', 'visible', 'hidden'],
    ]) {
      const suspend = () => this.suspend(reason);
      const resume = () => this.resume(reason);
      emitter.on(off, suspend);
      emitter.on(on, resume);
      this.removers.push(() => { emitter.off(off, suspend); emitter.off(on, resume); });
    }
    const shutdown = () => this.destroy();
    scene.events.once('shutdown', shutdown);
    this.removers.push(() => scene.events.off('shutdown', shutdown));
    if (document.hidden) this.suspensions.add('hidden');
  }

  warn(kind, error) {
    if (this.warnings.has(kind)) return;
    this.warnings.add(kind);
    this.report(`Cargo Run ${kind} feedback unavailable.`, error);
  }

  unlock() {
    if (this.destroyed) return;
    this.interacted = true;
    if (!this.context || this.context.state === 'closed') return;
    if (this.context.state === 'running') {
      this.createAudio();
      this.syncEngine();
      return;
    }
    if (this.unlocking) return;
    this.unlocking = this.context.resume().then(() => {
      if (!this.destroyed && this.context.state === 'running') {
        this.createAudio();
        this.syncEngine();
      }
    }, error => this.warn('audio unlock', error)).finally(() => { this.unlocking = null; });
  }

  createAudio() {
    if (this.master || this.destroyed) return;
    const context = this.context;
    this.master = context.createGain();
    this.master.gain.value = this.suspensions.size ? 0 : 0.35;
    this.master.connect(this.destination);
    this.engineGain = context.createGain();
    this.engineGain.gain.value = 0;
    this.engineGain.connect(this.master);
    this.engine = context.createOscillator();
    this.engine.type = 'triangle';
    this.engine.frequency.value = 90;
    this.engine.connect(this.engineGain);
    this.engine.start();
    this.noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.6), context.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
  }

  get ready() {
    return !this.destroyed && this.interacted && !this.suspensions.size &&
      this.context?.state === 'running' && Boolean(this.master);
  }

  setEngine(speed) {
    this.engineSpeed = speed;
    this.syncEngine();
  }

  syncEngine() {
    if (!this.engine || this.destroyed) return;
    const speed = this.engineSpeed;
    const fraction = Math.max(0, Math.min(1, ((speed ?? 320) - 320) / (MAX_TRACK_SPEED - 320)));
    const now = this.context.currentTime;
    this.engine.frequency.setTargetAtTime(90 * (1 + 0.25 * fraction), now, 0.05);
    this.engineGain.gain.setTargetAtTime(this.ready && speed > 0 ? 0.06 : 0, now, 0.03);
  }

  resetRun(x) {
    this.clearVoices();
    this.lastPickup = -Infinity;
    this.pickupStreak = 0;
    this.resetSteering(x);
    this.setEngine(null);
  }

  laneAt(x) {
    return LANE_CENTERS.reduce((best, center, lane) =>
      Math.abs(center - x) < Math.abs(LANE_CENTERS[best] - x) ? lane : best, 0);
  }

  resetSteering(x) {
    this.lane = this.laneAt(x);
  }

  steer(x) {
    const lane = this.laneAt(x);
    if (this.lane !== undefined && lane !== this.lane) this.vibrate(15);
    this.lane = lane;
  }

  vibrate(pattern) {
    if (this.destroyed || !this.interacted || this.suspensions.size ||
        typeof this.navigator?.vibrate !== 'function') return;
    try {
      if (!this.navigator.vibrate(pattern)) this.warn('haptic', 'Vibration was declined by the browser.');
    } catch (error) {
      if (!['NotAllowedError', 'SecurityError', 'NotSupportedError'].includes(error.name)) throw error;
      this.warn('haptic', error);
    }
  }

  addVoice(source, gain, filter, start, duration, volume) {
    while (this.voices.size >= MAX_VOICES) this.releaseVoice(this.voices.values().next().value, true);
    const voice = {source, gain, filter};
    this.voices.add(voice);
    source.connect(filter ?? gain);
    if (filter) filter.connect(gain);
    gain.connect(this.master);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.onended = () => this.releaseVoice(voice);
    source.start(start);
    source.stop(start + duration);
  }

  releaseVoice(voice, stop = false) {
    if (!this.voices.delete(voice)) return;
    voice.source.onended = null;
    if (stop) voice.source.stop();
    voice.source.disconnect();
    voice.filter?.disconnect();
    voice.gain.disconnect();
  }

  clearVoices() {
    for (const voice of this.voices) this.releaseVoice(voice, true);
  }

  tone(frequency, delay = 0, duration = 0.18, volume = 0.12, type = 'sine', endFrequency) {
    if (!this.ready) return;
    const start = this.context.currentTime + delay;
    const source = this.context.createOscillator();
    source.type = type;
    source.frequency.setValueAtTime(frequency, start);
    if (endFrequency) source.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
    this.addVoice(source, this.context.createGain(), null, start, duration, volume);
  }

  hiss(frequency, duration, type, volume) {
    if (!this.ready) return;
    const source = this.context.createBufferSource();
    source.buffer = this.noise;
    const filter = this.context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    this.addVoice(source, this.context.createGain(), filter, this.context.currentTime, duration, volume);
  }

  cargoPickup(now) {
    this.pickupStreak = now - this.lastPickup <= 2 ? this.pickupStreak + 1 : 1;
    this.lastPickup = now;
    const note = (this.pickupStreak - 1) % PICKUP_NOTES.length;
    this.tone(PICKUP_NOTES[note]);
    if (note === 4) {
      this.tone(PICKUP_NOTES[2] * 2, 0.07, 0.3, 0.08);
      this.tone(PICKUP_NOTES[3] * 2, 0.14, 0.3, 0.08);
    }
    this.vibrate(30);
  }

  impact() {
    this.tone(105, 0, 0.3, 0.2, 'triangle', 38);
    this.hiss(1800, 0.18, 'highpass', 0.12);
    this.vibrate([30, 20, 30]);
  }

  depot() {
    this.setEngine(null);
    this.lastPickup = -Infinity;
    this.pickupStreak = 0;
    this.hiss(1600, 0.4, 'lowpass', 0.1);
    this.tone(PICKUP_NOTES[3], 0.42, 0.18);
    this.tone(PICKUP_NOTES[4], 0.6, 0.3);
    this.vibrate(200);
  }

  suspend(reason) {
    this.suspensions.add(reason);
    this.clearVoices();
    if (this.master) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setValueAtTime(0, this.context.currentTime);
    }
    if (this.interacted && typeof this.navigator?.vibrate === 'function') this.vibrateStop();
    this.syncEngine();
  }

  vibrateStop() {
    try {
      this.navigator.vibrate(0);
    } catch (error) {
      if (!['NotAllowedError', 'SecurityError', 'NotSupportedError'].includes(error.name)) throw error;
      this.warn('haptic', error);
    }
  }

  resume(reason) {
    this.suspensions.delete(reason);
    if (this.master && !this.suspensions.size) {
      this.master.gain.setTargetAtTime(0.35, this.context.currentTime, 0.03);
    }
    this.syncEngine();
  }

  destroy() {
    if (this.destroyed) return;
    this.suspend('shutdown');
    this.destroyed = true;
    this.removers.forEach(remove => remove());
    this.removers = [];
    if (this.engine) {
      this.engine.stop();
      this.engine.disconnect();
      this.engineGain.disconnect();
      this.master.disconnect();
    }
    this.noise = null;
  }
}
