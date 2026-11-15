// All sound is synthesised with WebAudio: no audio files, no network, nothing
// to load. One shared noise buffer and a handful of tiny envelopes cover shots,
// reloads, hits, the bomb's beeps and the round stingers. Created lazily on the
// first user gesture, because browsers will not start audio before one.
export function createAudio() {
  let context = null;
  let noiseBuffer = null;
  let master = null;

  function ensure() {
    if (context) return true;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = 0.32;
      master.connect(context.destination);
      const length = context.sampleRate * 0.5;
      noiseBuffer = context.createBuffer(1, length, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      return false;
    }
    return true;
  }

  function noise(duration, filterFreq, gainValue, type = 'lowpass') {
    if (!ensure()) return;
    const now = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(now);
    source.stop(now + duration);
  }

  function tone(freq, duration, gainValue, type = 'sine', slideTo = 0) {
    if (!ensure()) return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, now);
    if (slideTo > 0) oscillator.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  return {
    unlock() {
      ensure();
      if (context && context.state === 'suspended') context.resume();
    },
    shot(kind) {
      if (kind === 'rifle') noise(0.12, 1800, 0.9);
      else if (kind === 'smg') noise(0.09, 2400, 0.7);
      else noise(0.14, 1200, 0.8);
      tone(180, 0.08, 0.5, 'square', 60);
    },
    enemyShot(distance) {
      const gain = Math.max(0.08, 0.55 - distance * 0.012);
      noise(0.1, 1400, gain);
    },
    dryClick() {
      tone(1200, 0.04, 0.25, 'square');
    },
    reload() {
      tone(500, 0.06, 0.2, 'square', 300);
      setTimeout(() => tone(700, 0.06, 0.2, 'square', 400), 350);
    },
    hit() {
      tone(2400, 0.05, 0.3, 'sine');
    },
    kill() {
      tone(1800, 0.07, 0.3, 'sine');
      setTimeout(() => tone(2400, 0.09, 0.3, 'sine'), 70);
    },
    hurt() {
      noise(0.15, 500, 0.5);
      tone(120, 0.15, 0.4, 'sawtooth', 70);
    },
    plantBeep() {
      tone(950, 0.09, 0.35, 'sine');
    },
    bombTick() {
      tone(1100, 0.05, 0.22, 'sine');
    },
    explosion() {
      noise(0.9, 300, 1.0);
      tone(55, 0.8, 0.7, 'sine', 30);
    },
    roundWin() {
      [523, 659, 784].forEach((freq, i) => setTimeout(() => tone(freq, 0.16, 0.3, 'triangle'), i * 110));
    },
    roundLose() {
      [392, 330, 262].forEach((freq, i) => setTimeout(() => tone(freq, 0.18, 0.3, 'triangle'), i * 130));
    },
    buy() {
      tone(880, 0.08, 0.25, 'triangle');
      setTimeout(() => tone(1174, 0.1, 0.25, 'triangle'), 80);
    },
    denied() {
      tone(220, 0.12, 0.3, 'square', 160);
    },
    smoke() {
      noise(0.5, 900, 0.35, 'bandpass');
    },
  };
}
