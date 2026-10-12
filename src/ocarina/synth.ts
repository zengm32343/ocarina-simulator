import { NOTE_FREQ, type Note } from './notes';
import type { OcarinaSample, OcarinaSound } from './styles';

type SynthParams = NonNullable<OcarinaSound['synth']>;

/** The original voice: a sine fundamental with a faint second harmonic. */
const DEFAULT_SYNTH: SynthParams = { harmonics: [1, 0.1], breath: 0.025, vibrato: 0.0045, brightness: 2600 };

const REVERB_WET = 0.35;
/** Pitch rise at full breath, in semitones; ocarinas go sharp when blown harder. */
const BREATH_BEND = 0.3;

/** Stereo impulse response: decaying noise that loses its highs as it fades, like a small hall. */
function roomImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const smoothing = 0.2 + 0.75 * t;
      low = low * smoothing + (Math.random() * 2 - 1) * (1 - smoothing);
      data[i] = low * Math.pow(1 - t, 3);
    }
  }
  return impulse;
}

const noteMidi = (note: Note) => 69 + 12 * Math.log2(NOTE_FREQ[note] / 440);
const midiFreq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

interface Voice {
  /** Glide to a new pitch; false when this voice cannot reach it. */
  retune(midi: number, now: number): boolean;
  stop(now: number, fast?: boolean): void;
}

/**
 * Monophonic ocarina voice. Styles with recordings play looped samples,
 * re-pitched from the nearest recorded note; the others use an oscillator
 * voice (harmonics, band-passed breath noise and delayed vibrato).
 * Changing note while one is held glides like a real ocarina.
 */
export class OcarinaSynth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private expression: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voice: Voice | null = null;
  private sound: OcarinaSound | null = null;
  private base: number | null = null;
  private shift = 0;
  private bend = 0;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private ready = new Map<string, AudioBuffer>();

  /** Must run inside a user gesture the first time (autoplay policy). */
  private ensure(): AudioContext {
    if (!this.ctx) {
      // iOS: play through the silent switch like other media.
      const session = (navigator as { audioSession?: { type: string } }).audioSession;
      if (session) session.type = 'playback';
      this.ctx = new AudioContext();
      const compressor = this.ctx.createDynamicsCompressor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(compressor).connect(this.ctx.destination);
      // The game plays the ocarina with reverb; a short synthetic room does the same here.
      const convolver = this.ctx.createConvolver();
      convolver.buffer = roomImpulse(this.ctx, 1.6);
      const wet = this.ctx.createGain();
      wet.gain.value = REVERB_WET;
      this.master.connect(convolver).connect(wet).connect(compressor);
      this.expression = this.ctx.createGain();
      this.expression.connect(this.master);
      const length = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Create or resume the audio context; call from a user gesture. */
  unlock(): void {
    this.ensure();
  }

  /** Switch instrument; recordings download in the background. */
  setSound(sound: OcarinaSound): Promise<void> {
    this.sound = sound;
    return Promise.all((sound.samples ?? []).map((s) => this.load(s.url))).then(() => undefined);
  }

  private load(url: string): Promise<AudioBuffer | null> {
    let buffer = this.buffers.get(url);
    if (!buffer) {
      // Decoding needs no running AudioContext, so samples can load before the first tap.
      const decoder = new OfflineAudioContext(1, 1, 44100);
      buffer = fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((data) => decoder.decodeAudioData(data))
        .then((decoded) => {
          this.ready.set(url, decoded);
          return decoded;
        })
        .catch(() => {
          this.buffers.delete(url);
          return null;
        });
      this.buffers.set(url, buffer);
    }
    return buffer;
  }

  noteOn(note: Note): void {
    this.base = noteMidi(note) + 12 * (this.sound?.octave ?? 0);
    this.play();
  }

  /** Raise or lower notes by semitones, like holding R or Z in the game; bends a sounding note. */
  setShift(semitones: number): void {
    if (semitones === this.shift) return;
    this.shift = semitones;
    if (this.voice && this.base !== null) this.play();
  }

  /**
   * Follow the player's breath (0–1): louder and slightly sharper when blown harder.
   * null returns to fixed volume and pitch.
   */
  setBreath(level: number | null): void {
    const ctx = this.ensure();
    const now = ctx.currentTime;
    this.expression!.gain.setTargetAtTime(level ?? 1, now, 0.03);
    const bend = level === null ? 0 : (level - 0.5) * BREATH_BEND;
    if (Math.abs(bend - this.bend) < 0.01) return;
    this.bend = bend;
    if (this.voice && this.base !== null) this.play();
  }

  private play(): void {
    const ctx = this.ensure();
    const now = ctx.currentTime;
    const midi = this.base! + this.shift + this.bend;
    if (this.voice?.retune(midi, now)) return;
    const legato = !!this.voice;
    this.voice?.stop(now, true);
    this.voice = this.createVoice(ctx, midi, now, legato);
  }

  noteOff(): void {
    this.base = null;
    if (!this.ctx || !this.voice) return;
    this.voice.stop(this.ctx.currentTime);
    this.voice = null;
  }

  private createVoice(ctx: AudioContext, midi: number, now: number, legato: boolean): Voice {
    const samples = this.sound?.samples ?? [];
    if (samples.length && samples.every((s) => this.ready.has(s.url))) {
      return this.sampleVoice(ctx, samples, midi, now, legato);
    }
    if (samples.length) {
      // Fall back to the default voice until the recordings have loaded.
      return this.synthVoice(ctx, DEFAULT_SYNTH, midi - 12 * this.sound!.octave, now);
    }
    return this.synthVoice(ctx, this.sound?.synth ?? DEFAULT_SYNTH, midi, now);
  }

  private sampleVoice(ctx: AudioContext, samples: OcarinaSample[], midi: number, now: number, legato: boolean): Voice {
    const nearest = (m: number) =>
      samples.reduce((best, s) => (Math.abs(s.midi - m) < Math.abs(best.midi - m) ? s : best));
    const sample = nearest(midi);
    const rate = (m: number) => 2 ** ((m - sample.midi) / 12);

    const source = ctx.createBufferSource();
    source.buffer = this.ready.get(sample.url)!;
    source.loop = true;
    source.loopStart = sample.loopStart;
    source.loopEnd = sample.loopEnd;
    source.playbackRate.value = rate(midi);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(1.6, now + (legato ? 0.03 : 0.008));
    source.connect(env).connect(this.expression!);
    // A legato change of recording skips the attack, like a change of fingering.
    source.start(now, legato ? sample.loopStart : 0);

    return {
      retune(m, t) {
        if (nearest(m) !== sample) return false;
        source.playbackRate.setTargetAtTime(rate(m), t, 0.012);
        return true;
      },
      stop(t, fast) {
        env.gain.cancelScheduledValues(t);
        env.gain.setValueAtTime(env.gain.value, t);
        env.gain.setTargetAtTime(0, t, fast ? 0.012 : 0.045);
        source.stop(t + 0.35);
      },
    };
  }

  private synthVoice(ctx: AudioContext, params: SynthParams, midi: number, now: number): Voice {
    const f = midiFreq(midi);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(1, now + 0.035);
    env.gain.setTargetAtTime(0.82, now + 0.035, 0.08);

    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = params.brightness;
    env.connect(tone).connect(this.expression!);

    const oscs = params.harmonics.map((level, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * (i + 1);
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(env);
      osc.start(now);
      return osc;
    });

    const lfo = ctx.createOscillator();
    lfo.frequency.value = params.rate ?? 5.4;
    const lfoDepth = ctx.createGain();
    const startVibrato = (freq: number, t: number) => {
      lfoDepth.gain.cancelScheduledValues(t);
      lfoDepth.gain.setValueAtTime(0, t);
      lfoDepth.gain.linearRampToValueAtTime(freq * params.vibrato, t + 0.45);
    };
    startVibrato(f, now);
    lfo.connect(lfoDepth);
    for (const [i, osc] of oscs.entries()) {
      const scaled = ctx.createGain();
      scaled.gain.value = i + 1;
      lfoDepth.connect(scaled).connect(osc.frequency);
    }
    lfo.start(now);

    const breath = ctx.createBufferSource();
    breath.buffer = this.noise;
    breath.loop = true;
    const breathFilter = ctx.createBiquadFilter();
    breathFilter.type = 'bandpass';
    breathFilter.frequency.value = f * 2;
    breathFilter.Q.value = 1.2;
    const breathGain = ctx.createGain();
    breathGain.gain.setValueAtTime(params.breath * 3.6, now);
    breathGain.gain.setTargetAtTime(params.breath, now + 0.04, 0.1);
    breath.connect(breathFilter).connect(breathGain).connect(env);
    breath.start(now);

    return {
      retune(m, t) {
        const next = midiFreq(m);
        for (const [i, osc] of oscs.entries()) osc.frequency.setTargetAtTime(next * (i + 1), t, 0.012);
        breathFilter.frequency.setTargetAtTime(next * 2, t, 0.012);
        startVibrato(next, t);
        return true;
      },
      stop(t, fast) {
        env.gain.cancelScheduledValues(t);
        env.gain.setValueAtTime(env.gain.value, t);
        env.gain.setTargetAtTime(0, t, fast ? 0.012 : 0.045);
        const end = t + 0.35;
        for (const osc of oscs) osc.stop(end);
        breath.stop(end);
        lfo.stop(end);
      },
    };
  }

  /** A short rising arpeggio for "song recognised". */
  chime(): void {
    const ctx = this.ensure();
    const start = ctx.currentTime + 0.05;
    [587.33, 739.99, 880, 1174.66].forEach((f, i) => {
      const t = start + i * 0.085;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.35, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      osc.connect(g).connect(this.master!);
      osc.start(t);
      osc.stop(t + 0.65);
    });
  }

  dispose(): void {
    this.noteOff();
    void this.ctx?.close();
    this.ctx = null;
  }
}
