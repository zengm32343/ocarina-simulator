/**
 * Breath input: how hard the player is blowing at the microphone, 0–1.
 * Blowing on a microphone makes loud low-frequency wind noise, so the level
 * comes from the signal below ~250 Hz, above a noise floor that follows the
 * room while the player is not blowing. The ocarina's own notes (277 Hz and up) are filtered out, and
 * echo cancellation keeps the speakers from feeding back. Audio is analysed
 * in the browser and never recorded or sent anywhere.
 */
export class BreathInput {
  private frame = 0;
  private level = 0;
  private floor = Infinity;
  private heard = 0;

  private constructor(
    private readonly ctx: AudioContext,
    private readonly stream: MediaStream,
    private readonly analyser: AnalyserNode,
    private readonly onLevel: (level: number) => void,
  ) {}

  /** Ask for the microphone and start reporting levels every frame; rejects if access is denied. */
  static async start(onLevel: (level: number) => void): Promise<BreathInput> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
    });
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    let node: AudioNode = ctx.createMediaStreamSource(stream);
    for (let i = 0; i < 2; i++) {
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 250;
      node = node.connect(lowpass);
    }
    node.connect(analyser);
    if (ctx.state === 'suspended') await ctx.resume();
    const input = new BreathInput(ctx, stream, analyser, onLevel);
    input.tick();
    return input;
  }

  private tick = () => {
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const x of data) sum += x * x;
    const db = 10 * Math.log10(sum / data.length + 1e-12);
    // Digital silence (a muted or starting microphone) says nothing about the room.
    if (db > -100) {
      this.heard++;
      if (!Number.isFinite(this.floor)) this.floor = db;
      // The first half second calibrates to the room.
      else if (this.heard < 30) this.floor += (db - this.floor) * 0.2;
      else if (db < this.floor) this.floor = db;
      // Follow the room while the player is not blowing; creep up slowly while they are.
      else if (db < this.floor + 8) this.floor += (db - this.floor) * 0.02;
      else this.floor += 0.03;
    }
    const target = Number.isFinite(this.floor) ? Math.min(1, Math.max(0, (db - this.floor - 8) / 28)) : 0;
    this.level += (target - this.level) * (target > this.level ? 0.5 : 0.15);
    this.onLevel(this.level);
    this.frame = requestAnimationFrame(this.tick);
  };

  stop(): void {
    cancelAnimationFrame(this.frame);
    for (const track of this.stream.getTracks()) track.stop();
    void this.ctx.close();
  }
}
