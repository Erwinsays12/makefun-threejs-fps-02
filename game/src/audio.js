// audio.js - every sound in DUSKLINE is synthesised in WebAudio.
//
// There are no audio files: a gunshot is a shaped noise burst with a
// low sine thump, a reload is three filtered clicks, the bomb is a piezo
// beep, and the explosion is a long noise fall with a sub drop. Distance
// dulls and quiets other fighters' shots, so your ears give you the same
// information the bots' hearing model uses.

export class SoundFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
  }

  // Must be called from a user gesture (the click that starts a match).
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.ambient();
    } catch (e) {
      this.ctx = null;
    }
  }

  ambient() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 320;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.014;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.006;
    lfo.connect(lfoGain); lfoGain.connect(gain.gain);
    src.connect(filt); filt.connect(gain); gain.connect(this.master);
    src.start(); lfo.start();
  }

  // A noise burst through a filter. dist in metres (0 = your own gun).
  burst(dur, freq, gain, dist = 0, type = 'lowpass', sweepTo = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const vol = gain / (1 + dist * 0.085);
    if (vol < 0.004) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(Math.max(240, freq - dist * 55), t);
    if (sweepTo) filt.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 0.4, dur + 0.05);
    src.stop(t + dur + 0.05);
  }

  tone(type, f0, f1, dur, gain, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  shot(kind, dist = 0) {
    if (kind === 'rifle') {
      this.burst(0.16, 3400, 0.85, dist, 'lowpass', 300);
      this.tone('square', 160, 55, 0.1, 0.25 / (1 + dist * 0.1));
    } else if (kind === 'smg') {
      this.burst(0.11, 3900, 0.6, dist, 'lowpass', 400);
      this.tone('square', 190, 70, 0.07, 0.18 / (1 + dist * 0.1));
    } else {
      this.burst(0.12, 3200, 0.62, dist, 'lowpass', 350);
      this.tone('square', 175, 60, 0.08, 0.2 / (1 + dist * 0.1));
    }
  }
  dryFire() { this.burst(0.04, 2500, 0.2, 0, 'highpass'); }
  reload() {
    this.burst(0.05, 1800, 0.25, 0, 'bandpass');
    this.burst(0.05, 1200, 0.3, 0, 'bandpass');
    setTimeout(() => this.burst(0.06, 2200, 0.32, 0, 'bandpass'), 700);
  }
  hitmark(kill) {
    this.tone('square', kill ? 1320 : 990, kill ? 1320 : 990, 0.05, 0.16);
    if (kill) this.tone('square', 1760, 1760, 0.07, 0.14, 0.05);
  }
  hurt() { this.burst(0.14, 500, 0.4, 0, 'lowpass'); this.tone('sawtooth', 110, 60, 0.14, 0.12); }
  footstep(running) { this.burst(running ? 0.07 : 0.05, 700, running ? 0.1 : 0.05); }
  botStep(dist) { this.burst(0.05, 650, 0.12, dist); }
  throwWhoosh() { this.burst(0.18, 900, 0.16, 0, 'bandpass', 2400); }
  smokePop() { this.burst(0.3, 500, 0.3, 0, 'lowpass', 140); }
  plantBeep(last) { this.tone('square', last ? 1560 : 1180, last ? 1560 : 1180, last ? 0.16 : 0.07, 0.12); }
  channelTick() { this.tone('square', 880, 880, 0.03, 0.05); }
  explosion(dist = 0) {
    this.burst(1.4, 900, 1.0, dist, 'lowpass', 60);
    this.tone('sine', 120, 28, 1.2, 0.7 / (1 + dist * 0.05));
  }
  buy() { this.tone('square', 740, 740, 0.05, 0.12); this.tone('square', 1180, 1180, 0.06, 0.12, 0.06); }
  denied() { this.tone('square', 220, 180, 0.11, 0.14); }
  roundWin() { this.tone('triangle', 523, 523, 0.14, 0.2); this.tone('triangle', 784, 784, 0.22, 0.2, 0.12); }
  roundLose() { this.tone('triangle', 392, 392, 0.16, 0.2); this.tone('triangle', 262, 262, 0.26, 0.2, 0.13); }
}
