interface RemotePlaybackOptions {
  getContext(): AudioContext;
  getVolume(clientId: number): number;
  onDecodeError(): void;
  onDrop(): void;
  /** Called when a speaker ran dry mid-speech and playback had to re-buffer. */
  onUnderrun?(): void;
}

interface SpeakerPlayback {
  context: AudioContext;
  decoder: AudioDecoder | null;
  gain: GainNode;
  sources: Set<AudioBufferSourceNode>;
  playTime: number;
  timestamp: number;
  /** The next scheduled buffer starts after silence and must fade in. */
  fadeIn: boolean;
  /** Whether anything has been scheduled since the last gap. */
  started: boolean;
}

// Network delivery is uneven: TCP holds frames back and releases them in a
// burst, and the sender's own tab can stall. Scheduling each 20 ms frame as
// soon as it decodes left no margin, so every late frame became a gap and
// every gap a click. Keep a small cushion instead, like a TeamSpeak client.
/** Delay before a speaker starts or resumes, absorbing ordinary jitter. */
export const PLAYBACK_PREFILL_SECONDS = 0.06;
/** Upper bound on scheduled audio; beyond it frames are dropped, not the decoder. */
export const MAX_PLAY_AHEAD_SECONDS = 0.25;
/** A frame scheduled closer than this to "now" counts as a gap. */
const UNDERRUN_MARGIN_SECONDS = 0.005;
/** Decoder backlog at which input is skipped like a lost packet. */
export const MAX_DECODE_QUEUE_FRAMES = 8;
/** A backlog this large (0.5 s) means the decoder is stuck and is replaced. */
export const STALLED_DECODE_QUEUE_FRAMES = 25;
/** 5 ms fade at a gap boundary removes the step that is heard as a click. */
const FADE_SECONDS = 0.005;

export function createRemotePlayback(options: RemotePlaybackOptions) {
  const speakers = new Map<number, SpeakerPlayback>();

  function clear(clientId: number): void {
    const stream = speakers.get(clientId);
    if (!stream) return;
    // Invalidate callbacks before closing their resources.
    speakers.delete(clientId);
    try { stream.decoder?.close(); } catch { /* decoder may already be closed */ }
    for (const source of stream.sources) {
      try { source.stop(); } catch { /* not started or already ended */ }
      source.disconnect();
    }
    stream.sources.clear();
    stream.gain.disconnect();
  }

  function output(clientId: number, stream: SpeakerPlayback, chunk: AudioData): void {
    try {
      if (speakers.get(clientId) !== stream) return;
      const { context, gain, sources } = stream;
      const { sampleRate, numberOfChannels, numberOfFrames } = chunk;
      const now = context.currentTime;
      const duration = numberOfFrames / sampleRate;
      let playTime = stream.playTime;
      if (!stream.started || playTime < now + UNDERRUN_MARGIN_SECONDS) {
        // First frame, or the previous audio already ran out: collect a fresh
        // cushion and fade in from silence instead of starting mid-waveform.
        if (stream.started) options.onUnderrun?.();
        playTime = now + PLAYBACK_PREFILL_SECONDS;
        stream.fadeIn = true;
        stream.started = true;
      }
      if (playTime + duration > now + MAX_PLAY_AHEAD_SECONDS) {
        // A burst larger than the cushion: drop this frame but keep the
        // decoder, so the codec state and the scheduled audio stay intact.
        options.onDrop();
        stream.fadeIn = true;
        return;
      }
      const buffer = context.createBuffer(numberOfChannels, numberOfFrames, sampleRate);
      const fadeSamples = stream.fadeIn ? Math.min(numberOfFrames, Math.round(FADE_SECONDS * sampleRate)) : 0;
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const samples = new Float32Array(numberOfFrames);
        chunk.copyTo(samples, { planeIndex: channel, format: "f32-planar" });
        for (let index = 0; index < fadeSamples; index++) samples[index]! *= (index + 1) / fadeSamples;
        buffer.copyToChannel(samples, channel);
      }
      stream.fadeIn = false;
      const source = context.createBufferSource();
      sources.add(source);
      source.buffer = buffer;
      source.connect(gain);
      source.addEventListener("ended", () => {
        source.disconnect();
        // The old stream owns this set; never delete a replacement's resources.
        sources.delete(source);
      }, { once: true });
      source.start(playTime);
      stream.playTime = playTime + duration;
    } catch {
      if (speakers.get(clientId) === stream) {
        options.onDecodeError();
        clear(clientId);
      }
    } finally {
      chunk.close();
    }
  }

  function create(clientId: number, context: AudioContext): SpeakerPlayback {
    const stream: SpeakerPlayback = {
      context, decoder: null, gain: context.createGain(), sources: new Set(),
      playTime: context.currentTime, timestamp: 0, fadeIn: true, started: false,
    };
    speakers.set(clientId, stream);
    stream.gain.gain.value = options.getVolume(clientId);
    stream.gain.connect(context.destination);
    stream.decoder = new AudioDecoder({
      output: chunk => output(clientId, stream, chunk),
      error: () => {
        if (speakers.get(clientId) !== stream) return;
        options.onDecodeError();
        clear(clientId);
      },
    });
    stream.decoder.configure({ codec: "opus", sampleRate: 48000, numberOfChannels: 1 });
    return stream;
  }

  function play(clientId: number, opusData: Uint8Array): void {
    if (opusData.length < 3) { options.onDrop(); return; }
    try {
      const context = options.getContext();
      let stream = speakers.get(clientId);
      // Only a different audio context or a stuck decoder needs a new one;
      // ordinary jitter and short stalls are handled by the cushion above.
      if (stream && (stream.context !== context || (stream.decoder?.decodeQueueSize ?? 0) >= STALLED_DECODE_QUEUE_FRAMES)) {
        clear(clientId);
        stream = undefined;
      }
      stream ??= create(clientId, context);
      if (speakers.get(clientId) !== stream) return;
      if ((stream.decoder?.decodeQueueSize ?? 0) >= MAX_DECODE_QUEUE_FRAMES) {
        // The page is too busy to decode in time; skip input like a lost
        // packet rather than discarding the decoder and everything scheduled.
        options.onDrop();
        stream.fadeIn = true;
        return;
      }
      stream.decoder?.decode(new EncodedAudioChunk({ type: "key", timestamp: stream.timestamp, duration: 20_000, data: opusData }));
      stream.timestamp += 20_000;
    } catch {
      options.onDecodeError();
      clear(clientId);
    }
  }

  return {
    play,
    clear,
    clearAll() { for (const id of speakers.keys()) clear(id); },
    updateVolume(clientId: number) {
      const stream = speakers.get(clientId);
      if (stream) stream.gain.gain.value = options.getVolume(clientId);
    },
    updateVolumes() { for (const [id, stream] of speakers) stream.gain.gain.value = options.getVolume(id); },
  };
}
