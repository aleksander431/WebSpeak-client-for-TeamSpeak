(async () => {
  const context = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
  await context.audioWorklet.addModule("system-audio-worklet.js");
  const player = new AudioWorkletNode(context, "pcm-player", { numberOfInputs: 0, outputChannelCount: [2] });
  player.connect(context.destination);
  await context.resume();
  window.webspeakSystemAudio.onChunk((chunk) => {
    // Copy into a transferable buffer of whole stereo frames.
    const usable = chunk.byteLength - (chunk.byteLength % 4);
    if (usable <= 0) return;
    const buffer = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + usable);
    player.port.postMessage(buffer, [buffer]);
  });
  window.webspeakSystemAudio.ready();
})();
