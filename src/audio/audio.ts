// src/audio/audio.ts
// All sound is synthesized live with Web Audio — no audio files, nothing to
// license. Two parts:
//
//   MUSIC  generative ambient score: slow detuned pads walking a 4-chord loop
//          over a sub drone, sparse echoing bells from the chord's pentatonic,
//          all through a generated-impulse reverb. Seeded PRNG, so it's the
//          same piece every time but never obviously looping.
//   SFX    short synthesized cues: step done, paint repaired / rejected,
//          boots clunk, door open, jump.
//
// Browsers (iOS especially) only allow audio after a user gesture: call
// unlock() from a tap/click (the title screen's Start button). Audio pauses
// while the app is hidden/backgrounded. Settings persist in localStorage.

export type Sfx = "tick" | "repaired" | "rejected" | "boots" | "door" | "hop";

export interface GameAudio {
  /** Create/resume the AudioContext — must be called inside a user gesture. */
  unlock(): void;
  musicOn(): boolean;
  setMusic(on: boolean): void;
  play(s: Sfx): void;
}

const MUSIC_KEY = "fp_music";

// D dorian-ish loop: Dm9 -> Bbmaj7 -> Fmaj7/A -> C6/9, as MIDI note numbers.
const CHORDS: number[][] = [
  [50, 57, 60, 64, 65],
  [46, 53, 57, 62, 65],
  [45, 53, 57, 60, 64],
  [48, 55, 57, 62, 64],
];
const BAR = 9; // seconds per chord
const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function readSetting(key: string, dflt: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? dflt : v === "on";
  } catch {
    return dflt;
  }
}

export function createAudio(): GameAudio {
  let ctx: AudioContext | null = null;
  let master: GainNode;
  let musicBus: GainNode;
  let sfxBus: GainNode;
  let reverb: ConvolverNode;
  let music = readSetting(MUSIC_KEY, true);
  let scheduler = 0;
  let nextBar = 0;
  let barIndex = 0;
  const rnd = mulberry32(20260929);

  const build = (): void => {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);

    // Generated reverb impulse: 4 s of decaying stereo noise.
    reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 4;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    reverb.connect(wet).connect(master);

    musicBus = ctx.createGain();
    musicBus.gain.value = 0;
    musicBus.connect(master);
    musicBus.connect(reverb);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.5;
    sfxBus.connect(master);
    const sfxVerb = ctx.createGain();
    sfxVerb.gain.value = 0.25;
    sfxBus.connect(sfxVerb).connect(reverb);
  };

  // ---- music ----------------------------------------------------------------

  const pad = (freq: number, t0: number, dur: number): void => {
    if (!ctx) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.045, t0 + 3);
    g.gain.setValueAtTime(0.045, t0 + dur - 1);
    g.gain.linearRampToValueAtTime(0, t0 + dur + 3);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(500, t0);
    lp.frequency.linearRampToValueAtTime(900 + rnd() * 700, t0 + dur / 2);
    lp.frequency.linearRampToValueAtTime(450, t0 + dur + 3);
    lp.connect(g).connect(musicBus);
    for (const det of [-7, 6]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(lp);
      o.start(t0);
      o.stop(t0 + dur + 3.2);
    }
  };

  const drone = (freq: number, t0: number, dur: number): void => {
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.11, t0 + 2.5);
    g.gain.setValueAtTime(0.11, t0 + dur - 0.5);
    g.gain.linearRampToValueAtTime(0, t0 + dur + 2.5);
    o.connect(g).connect(musicBus);
    o.start(t0);
    o.stop(t0 + dur + 2.6);
  };

  const bell = (freq: number, t0: number, bus: AudioNode, vol = 0.05): void => {
    if (!ctx) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + 3.5);
    g.connect(bus);
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = freq;
    const o2 = ctx.createOscillator(); // inharmonic partial = bell-ish
    o2.type = "sine";
    o2.frequency.value = freq * 2.76;
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(g);
    o2.connect(g2).connect(g);
    for (const x of [o, o2]) {
      x.start(t0);
      x.stop(t0 + 3.6);
    }
  };

  const scheduleBar = (t0: number): void => {
    const chord = CHORDS[barIndex % CHORDS.length];
    barIndex++;
    drone(midi(chord[0] - 12), t0, BAR);
    for (const n of chord.slice(1)) pad(midi(n), t0, BAR);
    // 2-4 sparse bells per bar, from the chord an octave or two up.
    const count = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < count; i++) {
      const n = chord[1 + Math.floor(rnd() * (chord.length - 1))] + (rnd() < 0.5 ? 12 : 24);
      bell(midi(n), t0 + 1 + rnd() * (BAR - 2), musicBus, 0.035);
    }
  };

  const startMusic = (): void => {
    if (!ctx || scheduler) return;
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setTargetAtTime(1, ctx.currentTime, 1.2);
    nextBar = Math.max(nextBar, ctx.currentTime + 0.1);
    const tick = (): void => {
      if (!ctx) return;
      while (nextBar < ctx.currentTime + 2) {
        scheduleBar(nextBar);
        nextBar += BAR;
      }
    };
    tick();
    scheduler = window.setInterval(tick, 500);
  };

  const stopMusic = (): void => {
    window.clearInterval(scheduler);
    scheduler = 0;
    if (ctx) musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
  };

  // ---- sfx ------------------------------------------------------------------

  const tone = (type: OscillatorType, f0: number, f1: number, t0: number, dur: number, vol: number): void => {
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
    o.connect(g).connect(sfxBus);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  };

  const noiseBurst = (t0: number, dur: number, from: number, to: number, vol: number): void => {
    if (!ctx) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = rnd() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(from, t0);
    bp.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
    src.connect(bp).connect(g).connect(sfxBus);
    src.start(t0);
  };

  const play = (s: Sfx): void => {
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime + 0.01;
    switch (s) {
      case "tick":
        bell(midi(81), t, sfxBus, 0.12);
        bell(midi(88), t + 0.09, sfxBus, 0.1);
        break;
      case "repaired":
        for (const [i, n] of [74, 78, 81, 86].entries()) bell(midi(n), t + i * 0.08, sfxBus, 0.13);
        break;
      case "rejected":
        tone("square", 180, 120, t, 0.28, 0.08);
        tone("square", 150, 100, t + 0.12, 0.3, 0.07);
        break;
      case "boots":
        tone("sine", 140, 55, t, 0.18, 0.35);
        noiseBurst(t, 0.08, 2400, 900, 0.18);
        break;
      case "hop":
        tone("sine", 110, 260, t, 0.22, 0.18);
        break;
      case "door":
        noiseBurst(t, 1.1, 300, 2600, 0.22);
        for (const [i, n] of [62, 69, 74, 78].entries()) bell(midi(n), t + 0.3 + i * 0.12, sfxBus, 0.1);
        break;
    }
  };

  // Pause everything while the app is hidden; resume when it's back.
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.visibilityState === "visible") void ctx.resume();
    else void ctx.suspend();
  });

  return {
    unlock() {
      if (!ctx) build();
      if (!ctx) return;
      void ctx.resume();
      if (music) startMusic();
    },
    musicOn: () => music,
    setMusic(on) {
      music = on;
      try {
        localStorage.setItem(MUSIC_KEY, on ? "on" : "off");
      } catch {
        /* ignore */
      }
      if (!ctx) return;
      if (on) startMusic();
      else stopMusic();
    },
    play,
  };
}
