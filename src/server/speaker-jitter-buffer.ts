/**
 * Per-speaker jitter buffer for the WebRTC mixer.
 *
 * TeamSpeak voice reaches the gateway in uneven bursts: packets from browser
 * speakers already crossed a TCP WebSocket, and any network adds jitter. The
 * mixer runs a strict 20 ms clock, so a frame that is a millisecond late used
 * to be replaced by hard silence, and the resulting step in the waveform is
 * heard as a click. Repeated, that is crackle.
 *
 * This buffer (1) waits for a small cushion before a speaker starts or
 * resumes, (2) fades the last sample out instead of jumping to zero when the
 * cushion runs dry, and (3) cross-fades every discontinuity, including a frame
 * dropped to keep latency bounded.
 */

export const FRAME_SAMPLES = 960; // 20 ms at 48 kHz
export const FRAME_MS = 20;
/** Frames collected before a speaker starts or resumes (60 ms). */
export const PREFILL_FRAMES = 3;
/** Above this the oldest frame is dropped, bounding added delay (160 ms). */
export const MAX_FRAMES = 8;
/** A short final utterance shorter than the prefill still plays after this wait. */
export const PREFILL_TIMEOUT_MS = PREFILL_FRAMES * FRAME_MS;
/** Length of fade-outs and cross-fades: 5 ms keeps them inaudible as clicks. */
export const RAMP_SAMPLES = 240;

interface BufferedFrame {
  samples: Int16Array;
  receivedAt: number;
}

export interface JitterBufferStats {
  /** Frames discarded because the speaker ran more than MAX_FRAMES ahead. */
  dropped: number;
  /** Times a playing speaker ran dry mid-stream and was faded out. */
  underruns: number;
}

export class SpeakerJitterBuffer {
  private readonly frames: BufferedFrame[] = [];
  private playing = false;
  /** Last sample this speaker contributed to the mix, for continuity. */
  private lastSample = 0;
  /** The next emitted frame must cross-fade from `lastSample`. */
  private discontinuity = false;
  readonly stats: JitterBufferStats = { dropped: 0, underruns: 0 };

  get size(): number {
    return this.frames.length;
  }

  /** True when the speaker has nothing left to play and can be released. */
  get idle(): boolean {
    return !this.playing && this.frames.length === 0 && this.lastSample === 0;
  }

  push(samples: Int16Array, now: number): void {
    if (samples.length !== FRAME_SAMPLES) return;
    this.frames.push({ samples, receivedAt: now });
    if (this.frames.length > MAX_FRAMES) {
      this.frames.shift();
      this.stats.dropped++;
      // Skipping a frame breaks the waveform just like a gap does.
      this.discontinuity = true;
    }
  }

  /**
   * One 20 ms frame for the mixer clock, or null when this speaker is silent.
   * The returned array is owned by the caller.
   */
  pull(now: number): Int16Array | null {
    if (!this.playing) {
      const oldest = this.frames[0];
      const ready = this.frames.length >= PREFILL_FRAMES || (oldest !== undefined && now - oldest.receivedAt >= PREFILL_TIMEOUT_MS);
      if (!ready) return this.fadeOutTail();
      this.playing = true;
      this.discontinuity = true;
    }
    const next = this.frames.shift();
    if (!next) {
      // Ran dry while playing: fade out, then collect a fresh cushion.
      this.playing = false;
      this.stats.underruns++;
      return this.fadeOutTail();
    }
    const output = Int16Array.from(next.samples);
    if (this.discontinuity) {
      crossFadeFrom(this.lastSample, output);
      this.discontinuity = false;
    }
    this.lastSample = output[FRAME_SAMPLES - 1]!;
    return output;
  }

  /** Bring a backlog after a stalled clock back to the normal cushion. */
  trim(): void {
    while (this.frames.length > PREFILL_FRAMES) {
      this.frames.shift();
      this.stats.dropped++;
      this.discontinuity = true;
    }
  }

  /** A frame that ramps the previous output to zero, or null if already silent. */
  private fadeOutTail(): Int16Array | null {
    if (this.lastSample === 0) return null;
    const output = new Int16Array(FRAME_SAMPLES);
    const start = this.lastSample;
    for (let index = 0; index < RAMP_SAMPLES; index++) {
      output[index] = Math.round(start * (1 - (index + 1) / RAMP_SAMPLES));
    }
    this.lastSample = 0;
    // Whatever plays next starts from silence and fades in from zero.
    this.discontinuity = true;
    return output;
  }
}

/** Blend the first RAMP_SAMPLES of `frame` from `from` so there is no step. */
function crossFadeFrom(from: number, frame: Int16Array): void {
  for (let index = 0; index < RAMP_SAMPLES; index++) {
    const weight = (index + 1) / RAMP_SAMPLES;
    frame[index] = Math.round(from * (1 - weight) + frame[index]! * weight);
  }
}
