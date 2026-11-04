import {LANE_CENTERS} from '../core/hazards.js';

const PICKUP_NOTES = [261.63, 293.66, 329.63, 392, 523.25];
const MAX_VOICES = 12;
const SCRAPE_INTERVAL = 0.12;
const SFX_VOLUME = 0.525;
const MUSIC_VOLUME = 0.35;

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
    this.lastScrape = -Infinity;
    this.musicBuffer = null;
    this.musicRequested = false;
    this.musicSource = null;
    this.musicGain = null;
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
    this.report(`Hazardous Haul ${kind} feedback unavailable.`, error);
  }

  unlock() {
    if (this.destroyed) return;
    this.interacted = true;
    if (!this.context || this.context.state === 'closed') return;
    if (this.context.state === 'running') {
      this.createAudio();
      this.startMusicSource();
      return;
    }
    if (this.unlocking) return;
    this.unlocking = this.context.resume().then(() => {
      if (!this.destroyed && this.context.state === 'running') {
        this.createAudio();
        this.startMusicSource();
      }
    }, error => this.warn('audio unlock', error)).finally(() => { this.unlocking = null; });
  }

  createAudio() {
    if (this.master || this.destroyed) return;
    const context = this.context;
    this.master = context.createGain();
    this.master.gain.value = this.suspensions.size ? 0 : SFX_VOLUME;
    this.compressor = context.createDynamicsCompressor();
    this.compressor.threshold.value = -12;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.12;
    this.master.connect(this.compressor);
    this.compressor.connect(this.destination);
    this.noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.6), context.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
  }

  get ready() {
    return !this.destroyed && this.interacted && !this.suspensions.size &&
      this.context?.state === 'running' && Boolean(this.master);
  }

  setMusicBuffer(buffer) {
    this.musicBuffer = buffer ?? null;
    this.startMusicSource();
  }

  startRunMusic(enabled) {
    this.musicRequested = Boolean(enabled);
    if (!this.musicRequested) {
      this.stopRunMusic();
      return;
    }
    this.startMusicSource();
  }

  startMusicSource() {
    if (!this.ready || !this.musicRequested || !this.musicBuffer || this.musicSource) return;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = this.musicBuffer;
    source.loop = true;
    gain.gain.setValueAtTime(this.suspensions.size ? 0 : MUSIC_VOLUME, this.context.currentTime);
    source.connect(gain);
    gain.connect(this.destination);
    source.onended = () => {
      if (this.musicSource !== source) return;
      this.musicSource = null;
      this.musicGain?.disconnect();
      this.musicGain = null;
      this.startMusicSource();
    };
    this.musicSource = source;
    this.musicGain = gain;
    source.start();
  }

  stopRunMusic() {
    this.musicRequested = false;
    if (!this.musicSource) return;
    const source = this.musicSource;
    const gain = this.musicGain;
    this.musicSource = null;
    this.musicGain = null;
    source.onended = null;
    source.stop();
    source.disconnect();
    gain?.disconnect();
  }

  resetRun(x) {
    this.clearVoices();
    this.lastScrape = -Infinity;
    this.resetSteering(x);
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

  addVoice(source, gain, filter, start, duration, volume, scheduleGain = null) {
    while (this.voices.size >= MAX_VOICES) this.releaseVoice(this.voices.values().next().value, true);
    const voice = {source, gain, filter};
    this.voices.add(voice);
    source.connect(filter ?? gain);
    if (filter) filter.connect(gain);
    gain.connect(this.master);
    if (scheduleGain) scheduleGain(gain.gain, start, duration);
    else {
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    }
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

  playPickupChime() {
    PICKUP_NOTES.forEach((frequency, index) => this.tone(frequency, index * 0.08, 0.3, 0.15));
  }

  playHardCrash() {
    if (!this.ready) return;
    const start = this.context.currentTime;
    this.tone(120, 0, 0.35, 0.4, 'triangle', 30);
    const noise = this.context.createBufferSource();
    noise.buffer = this.noise;
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, start);
    filter.frequency.linearRampToValueAtTime(100, start + 0.3);
    this.addVoice(noise, this.context.createGain(), filter, start, 0.35, 0.4);
  }

  playMetalScrape() {
    if (!this.ready || this.context.currentTime - this.lastScrape < SCRAPE_INTERVAL) return;
    this.lastScrape = this.context.currentTime;
    const start = this.context.currentTime;
    const source = this.context.createOscillator();
    source.type = 'sawtooth';
    source.frequency.setValueAtTime(350, start);
    source.frequency.linearRampToValueAtTime(280, start + 0.1);
    const filter = this.context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1800, start);
    filter.Q.setValueAtTime(5, start);
    this.addVoice(source, this.context.createGain(), filter, start, 0.12, 0.12);
  }

  playDepotWhoosh() {
    if (!this.ready) return;
    const start = this.context.currentTime;
    const noise = this.context.createBufferSource();
    noise.buffer = this.noise;
    const filter = this.context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(200, start);
    filter.frequency.exponentialRampToValueAtTime(2500, start + 0.3);
    filter.frequency.exponentialRampToValueAtTime(300, start + 0.6);
    filter.Q.setValueAtTime(3, start);
    this.addVoice(noise, this.context.createGain(), filter, start, 0.6, 0.25,
      (gain, at) => {
        gain.setValueAtTime(0.01, at);
        gain.linearRampToValueAtTime(0.25, at + 0.25);
        gain.exponentialRampToValueAtTime(0.001, at + 0.6);
      });
  }

  cargoPickup() {
    this.playPickupChime();
    this.vibrate(30);
  }

  impact() {
    this.playHardCrash();
    this.vibrate([30, 20, 30]);
  }

  airBrake() {
    this.hiss(1200, 0.32, 'highpass', 0.28);
    this.tone(80, 0, 0.12, 0.16, 'triangle', 45);
  }

  uiClick() {
    this.tone(1400, 0, 0.045, 0.22, 'triangle', 650);
  }

  depot() {
    this.playDepotWhoosh();
    this.tone(PICKUP_NOTES[3], 0.42, 0.18, 0.18);
    this.tone(PICKUP_NOTES[4], 0.6, 0.3, 0.18);
    this.vibrate(200);
  }

  suspend(reason) {
    this.suspensions.add(reason);
    this.clearVoices();
    if (this.master) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setValueAtTime(0, this.context.currentTime);
    }
    if (this.musicGain) {
      this.musicGain.gain.cancelScheduledValues(this.context.currentTime);
      this.musicGain.gain.setValueAtTime(0, this.context.currentTime);
    }
    if (this.interacted && typeof this.navigator?.vibrate === 'function') this.vibrateStop();
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
      this.master.gain.setTargetAtTime(SFX_VOLUME, this.context.currentTime, 0.03);
      this.musicGain?.gain.setTargetAtTime(MUSIC_VOLUME, this.context.currentTime, 0.03);
      this.startMusicSource();
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.suspend('shutdown');
    this.destroyed = true;
    this.removers.forEach(remove => remove());
    this.removers = [];
    this.stopRunMusic();
    if (this.master) {
      this.master.disconnect();
      this.compressor.disconnect();
    }
    this.noise = null;
    this.musicBuffer = null;
  }
}
