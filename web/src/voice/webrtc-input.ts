export interface WebRtcInput {
  readonly stream: MediaStream;
  setAccompaniment(stream: MediaStream | null): void;
  setVolume(value: number): void;
  /** Level of the shared application audio (accompaniment), 0..1. */
  setAccompanimentVolume(value: number): void;
  dispose(): void;
}

// Own only the mixing nodes and their output. Capture controllers own the input
// streams. Keep the sender track alive when accompaniment starts/stops/changes.
export function createWebRtcInput(context: AudioContext, microphone: MediaStream, volume: number, accompanimentVolume = 1): WebRtcInput {
  let destination: MediaStreamAudioDestinationNode | null = null;
  let microphoneSource: MediaStreamAudioSourceNode | null = null;
  let microphoneGain: GainNode | null = null;
  let accompanimentSource: MediaStreamAudioSourceNode | null = null;
  let accompanimentGain: GainNode | null = null;
  let disposed = false;
  const clean = (operation: () => void): void => { try { operation(); } catch { /* release other resources too */ } };

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (accompanimentSource) clean(() => accompanimentSource!.disconnect());
    if (microphoneSource) clean(() => microphoneSource!.disconnect());
    if (microphoneGain) clean(() => microphoneGain!.disconnect());
    if (accompanimentGain) clean(() => accompanimentGain!.disconnect());
    if (destination) {
      clean(() => destination!.disconnect());
      for (const track of destination.stream.getTracks()) clean(() => track.stop());
    }
    accompanimentSource = null;
    microphoneSource = null;
    microphoneGain = null;
    accompanimentGain = null;
    destination = null;
  }

  try {
    destination = context.createMediaStreamDestination();
    destination.channelCount = 1;
    destination.channelCountMode = "explicit";
    if (!destination.stream.getAudioTracks().some(track => track.readyState === "live")) {
      throw new Error("WebRTC input has no live output track");
    }
    microphoneSource = context.createMediaStreamSource(microphone);
    microphoneGain = context.createGain();
    microphoneGain.gain.value = volume;
    microphoneSource.connect(microphoneGain);
    microphoneGain.connect(destination);
    // Application audio has its own level, independent of microphone gain.
    accompanimentGain = context.createGain();
    accompanimentGain.gain.value = clampLevel(accompanimentVolume);
    accompanimentGain.connect(destination);
    return {
      stream: destination.stream,
      setAccompaniment(stream) {
        if (disposed) {
          if (stream) throw new DOMException("WebRTC input closed", "AbortError");
          return;
        }
        let candidate: MediaStreamAudioSourceNode | null = null;
        try {
          if (stream) {
            if (!stream.getAudioTracks().some(track => track.readyState === "live")) {
              throw new Error("Accompaniment has no live audio track");
            }
            candidate = context.createMediaStreamSource(stream);
            // Application audio bypasses microphone gain/denoising and has its
            // own level. Prepare it before disconnecting the previous source.
            candidate.connect(accompanimentGain!);
          }
        } catch (error) {
          if (candidate) clean(() => candidate!.disconnect());
          throw error;
        }
        const previous = accompanimentSource;
        accompanimentSource = candidate;
        if (previous) clean(() => previous.disconnect());
      },
      setVolume(value) { if (microphoneGain) microphoneGain.gain.value = value; },
      setAccompanimentVolume(value) { if (accompanimentGain) accompanimentGain.gain.value = clampLevel(value); },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

function clampLevel(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}
