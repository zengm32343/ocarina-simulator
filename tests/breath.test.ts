import { describe, expect, it } from 'vitest';
import { BreathDetector, peakiness, TONAL_THRESHOLD_DB } from '../src/ocarina/breath-detector';

const RATE = 48000;
const FFT = 4096;
const BIN = RATE / FFT;

// Seeded noise so the tests are deterministic.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32 - 0.5;
  };
}

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const ar = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const ai = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
      }
    }
  }
}

/** Spectrum in dB the way AnalyserNode computes it: Blackman window, magnitude smoothing over frames. */
function analyse(signal: Float64Array, smoothing = 0.5, frames = 6, hop = 800): Float32Array {
  const mag = new Float64Array(FFT / 2);
  for (let f = 0; f < frames; f++) {
    const re = new Float64Array(FFT);
    const im = new Float64Array(FFT);
    for (let i = 0; i < FFT; i++) {
      const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / FFT) + 0.08 * Math.cos((4 * Math.PI * i) / FFT);
      re[i] = signal[f * hop + i] * w;
    }
    fft(re, im);
    for (let k = 0; k < FFT / 2; k++) {
      const m = Math.hypot(re[k], im[k]) / FFT;
      mag[k] = f === 0 ? m : smoothing * mag[k] + (1 - smoothing) * m;
    }
  }
  return Float32Array.from(mag, (m) => 20 * Math.log10(m + 1e-12));
}

const LEN = FFT + 6 * 800;

function noise(seed: number, brown: boolean, gain = 0.3) {
  const r = rng(seed);
  const out = new Float64Array(LEN);
  let acc = 0;
  for (let i = 0; i < LEN; i++) {
    acc = brown ? acc * 0.995 + r() * 0.2 : r();
    out[i] = acc * gain;
  }
  return out;
}

function harmonic(f0: number, partials: number, seed = 1) {
  const r = rng(seed);
  const out = new Float64Array(LEN);
  for (let i = 0; i < LEN; i++) {
    let s = 0;
    for (let h = 1; h <= partials; h++) s += Math.sin((2 * Math.PI * f0 * h * i) / RATE) / h;
    out[i] = 0.2 * s + 0.01 * r();
  }
  return out;
}

const clip = (s: Float64Array, limit: number) => s.map((x) => Math.max(-limit, Math.min(limit, x)));

describe('peakiness', () => {
  it('stays low for breath-like noise, even when the microphone clips', () => {
    expect(peakiness(analyse(noise(1, false)), BIN).db).toBeLessThan(TONAL_THRESHOLD_DB);
    expect(peakiness(analyse(noise(2, true)), BIN).db).toBeLessThan(TONAL_THRESHOLD_DB);
    expect(peakiness(analyse(clip(noise(3, true, 3), 0.5)), BIN).db).toBeLessThan(TONAL_THRESHOLD_DB);
  });

  it('is high for voices, whistles and the ocarina itself', () => {
    expect(peakiness(analyse(harmonic(120, 12)), BIN).db).toBeGreaterThan(TONAL_THRESHOLD_DB);
    expect(peakiness(analyse(harmonic(220, 8)), BIN).db).toBeGreaterThan(TONAL_THRESHOLD_DB);
    expect(peakiness(analyse(harmonic(587, 3)), BIN).db).toBeGreaterThan(TONAL_THRESHOLD_DB);
    expect(peakiness(analyse(harmonic(1500, 1)), BIN).db).toBeGreaterThan(TONAL_THRESHOLD_DB);
  });
});

describe('BreathDetector', () => {
  const ROOM = -70;
  /** Feed frames at `fps` from `from` ms to `to` ms; returns whether any frame was blowing. */
  function feed(d: BreathDetector, from: number, to: number, db: (t: number) => number, tonal = false, fps = 120) {
    let any = false;
    for (let t = from; t < to; t += 1000 / fps) any = d.update(db(t), tonal, t).blowing || any;
    return any;
  }
  function calibrated() {
    const d = new BreathDetector();
    feed(d, 0, 1000, () => ROOM);
    return d;
  }

  it('ignores the room while calibrating', () => {
    const d = new BreathDetector();
    expect(feed(d, 0, 400, () => -40)).toBe(false);
  });

  it('starts on a sustained breath and stops shortly after it ends', () => {
    const d = calibrated();
    expect(feed(d, 1000, 1080, () => ROOM + 25)).toBe(false);
    expect(feed(d, 1080, 1600, () => ROOM + 25)).toBe(true);
    expect(d.update(ROOM + 25, false, 1600).level).toBeGreaterThan(0.3);
    feed(d, 1600, 1800, () => ROOM);
    expect(d.update(ROOM, false, 1800).blowing).toBe(false);
  });

  it('ignores taps on the screen', () => {
    const d = calibrated();
    for (let i = 0; i < 8; i++) {
      const at = 1000 + i * 250;
      expect(feed(d, at, at + 40, () => ROOM + 30)).toBe(false);
      expect(feed(d, at + 40, at + 250, () => ROOM)).toBe(false);
    }
  });

  it('ignores thumps that ring on for a while as they die away', () => {
    const d = calibrated();
    for (let i = 0; i < 4; i++) {
      const at = 1000 + i * 200;
      // 50 dB above the room, fading at 700 dB/s: above the start threshold for ~55 ms.
      expect(feed(d, at, at + 200, (t) => Math.max(ROOM, ROOM + 50 - (t - at) * 0.7))).toBe(false);
    }
  });

  it('ignores quick repeated taps whose ringing overlaps', () => {
    const d = calibrated();
    const tap = (t: number) => {
      const since = (t - 1000) % 200;
      return Math.max(ROOM, ROOM + 60 - since * 0.28);
    };
    expect(feed(d, 1000, 2000, tap)).toBe(false);
  });

  it('still starts when a breath opens with a strong puff and then settles', () => {
    const d = calibrated();
    expect(feed(d, 1000, 1700, (t) => (t < 1060 ? ROOM + 40 : ROOM + 27))).toBe(true);
  });

  it('stops soon after a breath even when the room level jitters', () => {
    const d = calibrated();
    const jitter = rng(5);
    feed(d, 1000, 1500, () => ROOM + 30 + jitter() * 8);
    feed(d, 1500, 1800, () => ROOM + jitter() * 10);
    expect(d.update(ROOM, false, 1800).blowing).toBe(false);
  });

  it('ignores talking and music near the microphone', () => {
    const d = calibrated();
    expect(feed(d, 1000, 2000, () => ROOM + 25, true)).toBe(false);
  });

  it('still starts on a strong breath when the phone reports a tonal spectrum', () => {
    const d = calibrated();
    expect(feed(d, 1000, 1500, () => ROOM + 40, true)).toBe(true);
  });

  it('ignores small changes in the room', () => {
    const d = calibrated();
    expect(feed(d, 1000, 3000, (t) => ROOM + 6 + 4 * Math.sin(t / 100))).toBe(false);
  });

  it('keeps blowing through the ocarina sound and brief dips', () => {
    const d = calibrated();
    feed(d, 1000, 1300, () => ROOM + 25);
    // Once blowing, a tonal spectrum (the ocarina from the speaker) and a 100 ms dip do not stop it.
    expect(feed(d, 1300, 1500, () => ROOM + 20, true)).toBe(true);
    feed(d, 1500, 1600, () => ROOM + 2);
    expect(d.update(ROOM + 20, true, 1600).blowing).toBe(true);
  });

  it('works the same at 60 fps', () => {
    const d = new BreathDetector();
    feed(d, 0, 1000, () => ROOM, false, 60);
    expect(feed(d, 1000, 1040, () => ROOM + 30, false, 60)).toBe(false);
    expect(feed(d, 1040, 1600, () => ROOM + 25, false, 60)).toBe(true);
  });
});
