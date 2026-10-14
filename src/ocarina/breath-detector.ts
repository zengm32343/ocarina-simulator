/**
 * Decides from microphone features whether the player is blowing, and how hard.
 * Kept free of Web Audio so it can be tested with synthetic signals.
 *
 * A breath on the microphone is loud low-frequency noise that lasts. A breath
 * starts only when the low band has stayed well above the room for ON_MS without
 * fading (a tap on the screen is a thump that dies away). A tonal sound (voices,
 * whistling and music have harmonics) needs to be much louder to count, since phones
 * can show tonal peaks even in a quiet room and a real breath is far louder than
 * talking. Once blowing, a lower threshold on the
 * smoothed level keeps the note going, and tonality is ignored so the ocarina's own
 * sound from the speaker cannot cut the breath.
 */

/** Low band (dB) above the room needed to start, and to keep going. */
const ON_DB = 12;
const STAY_DB = 8;
/** How long the start condition must hold, and how long quiet must last to stop. */
const ON_MS = 100;
const OFF_MS = 120;
/** Falling this far below the loudest moment so far means a thump dying away, not a breath. */
const FADE_DB = 20;
/** dB per millisecond the remembered loudest moment decays. */
const PEAK_DECAY = 0.03;
/** A spectral peak this far above its neighbourhood marks a tonal sound. */
const TONAL_DB = 15;
/** Low band (dB) above the room a tonal sound needs to start. */
const TONAL_ON_DB = 35;
/** dB above the keep-going threshold that maps to full strength. */
const RANGE_DB = 26;
const CALIBRATE_MS = 500;
/** Time constants: the smoothed level, and how quickly the room level is followed. */
const SMOOTH_MS = 40;
const ROOM_MS = 1500;

export interface BreathFrame {
  /** 0 when not blowing, otherwise 0.05–1. */
  level: number;
  blowing: boolean;
}

export class BreathDetector {
  private floor = Infinity;
  private smooth = -Infinity;
  private start: number | null = null;
  private last: number | null = null;
  private loudSince: number | null = null;
  private peak = -Infinity;
  private quietSince: number | null = null;
  private blowing = false;
  private level = 0;
  /** Frames that were loud enough but did not start a breath, by reason; for the debug readout. */
  readonly blocked = { tonal: 0, fading: 0 };

  /**
   * @param lowDb Level of the low band (below ~170 Hz) over the last few milliseconds.
   * @param tonal Whether the current spectrum has a clear pitch (see {@link peakiness}).
   * @param now Time in milliseconds.
   */
  update(lowDb: number, tonal: boolean, now: number): BreathFrame {
    this.start ??= now;
    const dt = Math.min(100, now - (this.last ?? now));
    this.last = now;
    const calibrating = now - this.start < CALIBRATE_MS;
    // Digital silence (a muted or starting microphone) says nothing about the room.
    if (lowDb > -100) {
      this.smooth = Number.isFinite(this.smooth) ? this.smooth + (lowDb - this.smooth) * ease(dt, SMOOTH_MS) : lowDb;
      this.track(dt, calibrating);
    }
    const above = Number.isFinite(this.floor) ? lowDb - this.floor : 0;
    const smoothAbove = Number.isFinite(this.floor) ? this.smooth - this.floor : 0;

    if (!this.blowing) {
      // The loudest moment of the current loud stretch, decaying slowly so a strong first puff
      // does not block a steadier breath; thumps fade far faster than this.
      this.peak = smoothAbove >= ON_DB ? Math.max(lowDb, this.peak - dt * PEAK_DECAY) : -Infinity;
      const loud = !calibrating && smoothAbove >= ON_DB;
      const fading = lowDb < this.peak - FADE_DB;
      const tooQuietForTonal = tonal && above < TONAL_ON_DB;
      if (loud && fading) this.blocked.fading++;
      else if (loud && tooQuietForTonal) this.blocked.tonal++;
      const candidate = loud && !fading && !tooQuietForTonal;
      this.loudSince = candidate ? (this.loudSince ?? now) : null;
      if (this.loudSince !== null && now - this.loudSince >= ON_MS) {
        this.blowing = true;
        this.quietSince = null;
      }
    } else {
      this.quietSince = smoothAbove >= STAY_DB ? null : (this.quietSince ?? now);
      if (this.quietSince !== null && now - this.quietSince >= OFF_MS) {
        this.blowing = false;
        this.loudSince = null;
      }
    }

    if (!this.blowing) {
      this.level = 0;
      return { level: 0, blowing: false };
    }
    const target = Math.min(1, Math.max(0.05, (smoothAbove - STAY_DB) / RANGE_DB));
    this.level += (target - this.level) * (target > this.level ? 0.5 : 0.15);
    return { level: Math.max(0.05, this.level), blowing: true };
  }

  /** Room level and smoothed low-band level in dB, for the debug readout. */
  get levels(): { floor: number; smooth: number } {
    return { floor: this.floor, smooth: this.smooth };
  }

  /** Follow the room's average level while the player is not blowing. */
  private track(dt: number, calibrating: boolean): void {
    if (!Number.isFinite(this.floor)) this.floor = this.smooth;
    else if (calibrating) this.floor += (this.smooth - this.floor) * ease(dt, 100);
    else if (this.smooth < this.floor) this.floor += (this.smooth - this.floor) * ease(dt, 200);
    else if (!this.blowing && this.smooth < this.floor + ON_DB) this.floor += (this.smooth - this.floor) * ease(dt, ROOM_MS);
  }
}

/** Fraction of the way to move towards a target in `dt` ms for an exponential time constant `tau`. */
function ease(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / tau);
}

/**
 * How far the strongest spectral peak in [loHz, hiHz] stands above its
 * neighbourhood, in dB, and its frequency. The default range starts above mains hum. Noise (breath, wind, rumble) stays low; voices,
 * whistles and instruments have harmonics that stand out.
 */
export function peakiness(spectrumDb: Float32Array, binHz: number, loHz = 300, hiHz = 2000): { db: number; hz: number } {
  const lo = Math.max(12, Math.round(loHz / binHz));
  const hi = Math.min(spectrumDb.length - 13, Math.round(hiHz / binHz));
  let best = 0;
  let at = 0;
  for (let i = lo; i <= hi; i++) {
    const v = spectrumDb[i];
    if (v < spectrumDb[i - 1] || v < spectrumDb[i + 1]) continue;
    let sum = 0;
    let n = 0;
    // Neighbourhood excludes the peak's own main lobe.
    for (let k = 4; k <= 12; k++) {
      sum += spectrumDb[i - k] + spectrumDb[i + k];
      n += 2;
    }
    if (v - sum / n > best) {
      best = v - sum / n;
      at = i;
    }
  }
  return { db: best, hz: at * binHz };
}

export const TONAL_THRESHOLD_DB = TONAL_DB;
