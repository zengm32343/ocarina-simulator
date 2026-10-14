import { BreathDetector, peakiness, TONAL_THRESHOLD_DB } from './breath-detector';

/**
 * Breath input: how hard the player is blowing at the microphone, 0–1 (0 when not blowing).
 * The level comes from the signal below ~170 Hz; {@link BreathDetector} decides what counts
 * as a breath. Echo cancellation stays off: on phones it switches on call-style voice
 * processing that boosts speech and suppresses wind noise, which is exactly the breath.
 * The ocarina's own notes (293 Hz and up) are filtered out instead. Audio is analysed in
 * the browser and never recorded or sent anywhere.
 */
export class BreathInput {
  private frame = 0;
  private ticks = 0;
  private readonly detector = new BreathDetector();
  /** Latest analysis, read by the `?breathdebug` readout. */
  readonly stats = { lowDb: -Infinity, peakiness: 0, peakHz: 0, maxAbove: -Infinity, maxPeakiness: 0, blowing: false };
  private readonly wave: Float32Array<ArrayBuffer>;
  private readonly spectrum: Float32Array<ArrayBuffer>;

  private constructor(
    private readonly ctx: AudioContext,
    private readonly stream: MediaStream,
    private readonly low: AnalyserNode,
    private readonly full: AnalyserNode,
    private readonly onLevel: (level: number) => void,
  ) {
    this.wave = new Float32Array(low.fftSize);
    this.spectrum = new Float32Array(full.frequencyBinCount);
  }

  /**
   * Ask for the microphone and start reporting levels every frame; rejects if access is denied.
   * Call synchronously from a click: iOS only grants the microphone and starts audio inside the gesture.
   */
  static async start(onLevel: (level: number) => void): Promise<BreathInput> {
    if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('No microphone API', 'NotSupportedError');
    // iOS refuses to record (InvalidStateError) while the page's audio session is 'playback'.
    setAudioSession('play-and-record');
    const ctx = new AudioContext();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices
        .getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
        .catch((error: unknown) => {
          // Some embedded browsers reject the processing constraints; plain audio still works there.
          const name = (error as DOMException)?.name;
          if (name === 'OverconstrainedError' || name === 'TypeError') {
            return navigator.mediaDevices.getUserMedia({ audio: true });
          }
          throw error;
        });
    } catch (error) {
      void ctx.close();
      setAudioSession('playback');
      throw error;
    }
    const source = ctx.createMediaStreamSource(stream);
    // Fine frequency resolution separates the harmonics of low voices.
    const full = ctx.createAnalyser();
    full.fftSize = 4096;
    full.smoothingTimeConstant = 0.5;
    source.connect(full);
    const low = ctx.createAnalyser();
    low.fftSize = 2048;
    let node: AudioNode = source;
    // Eight stages: about 80 dB down at the ocarina's lowest note, so the speaker can't keep a breath going.
    for (let i = 0; i < 8; i++) {
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 170;
      node = node.connect(lowpass);
    }
    node.connect(low);
    // iOS can refuse to start audio while it switches to recording; the analyser retries each frame.
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
    const input = new BreathInput(ctx, stream, low, full, onLevel);
    input.tick();
    return input;
  }

  private tick = (now = performance.now()) => {
    if (this.ctx.state !== 'running' && this.ticks++ % 30 === 0) void this.ctx.resume().catch(() => undefined);
    this.low.getFloatTimeDomainData(this.wave);
    // Only the newest ~20 ms, so a tap on the screen stays as short as it really is.
    let sum = 0;
    const recent = this.wave.subarray(this.wave.length / 2);
    for (const x of recent) sum += x * x;
    const lowDb = 10 * Math.log10(sum / recent.length + 1e-12);
    this.full.getFloatFrequencyData(this.spectrum);
    const binHz = this.ctx.sampleRate / this.full.fftSize;
    const peak = peakiness(this.spectrum, binHz);
    const frame = this.detector.update(lowDb, peak.db > TONAL_THRESHOLD_DB, now);
    const { floor } = this.detector.levels;
    Object.assign(this.stats, {
      lowDb,
      peakiness: peak.db,
      peakHz: peak.hz,
      maxAbove: Math.max(this.stats.maxAbove, lowDb - floor),
      maxPeakiness: Math.max(this.stats.maxPeakiness, peak.db || 0),
      blowing: frame.blowing,
    });
    this.onLevel(frame.level);
    this.frame = requestAnimationFrame(this.tick);
  };

  /** Audio state and the microphone's processing settings, for the debug readout. */
  get info(): string {
    const s = this.stream.getAudioTracks()[0]?.getSettings() ?? {};
    const { floor, smooth } = this.detector.levels;
    const { tonal, fading } = this.detector.blocked;
    return `blocked: tonal ${tonal} fading ${fading}\nctx ${this.ctx.state} ${this.ctx.sampleRate} Hz · echo ${s.echoCancellation} noise ${s.noiseSuppression} agc ${s.autoGainControl}\nfloor ${floor.toFixed(0)} smooth ${smooth.toFixed(0)}`;
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    for (const track of this.stream.getTracks()) track.stop();
    void this.ctx.close();
    setAudioSession('playback');
  }
}

/** iOS 16.4+ audio session; 'playback' ignores the silent switch but cannot record. */
function setAudioSession(type: 'playback' | 'play-and-record'): void {
  const session = (navigator as { audioSession?: { type: string } }).audioSession;
  if (session) session.type = type;
}
