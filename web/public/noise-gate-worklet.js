// WebSpeak noise gate: silences the microphone between phrases so residual
// hiss (left after noise suppression) is not sent while you are quiet.
//
// The level is the block RMS times the input volume, the same measure the
// voice-activation threshold uses. The gate opens at once above the threshold,
// stays open through short pauses (hold), then fades out; it fades in and out
// smoothly so it never clicks. Settings change live through the port:
//   { enabled: boolean, threshold: number (linear RMS), volume: number }
class WebSpeakNoiseGate extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.enabled = false;
    this.threshold = 0.008;
    this.volume = 1;
    this.gain = 1;
    this.holdSamples = 0;
    // Hold through pauses between words; fade in fast, fade out slower.
    this.holdLength = Math.round(sampleRate * 0.3);
    this.attack = 1 / (sampleRate * 0.005);
    this.release = 1 / (sampleRate * 0.08);
    this.port.onmessage = (event) => this.configure(event.data);
    // Initial settings arrive with the node, so the gate works from the first sample.
    this.configure(options && options.processorOptions);
  }

  configure(data) {
    if (!data) return;
    if (typeof data.enabled === "boolean") this.enabled = data.enabled;
    if (typeof data.threshold === "number" && Number.isFinite(data.threshold) && data.threshold > 0) this.threshold = data.threshold;
    if (typeof data.volume === "number" && Number.isFinite(data.volume) && data.volume >= 0) this.volume = data.volume;
  }

  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0];
    const output = outputs[0] && outputs[0][0];
    if (!output) return true;
    if (!input) { output.fill(0); return true; }
    if (!this.enabled) {
      output.set(input);
      this.gain = 1;
      return true;
    }
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const level = Math.sqrt(sum / input.length) * this.volume;
    // A little hysteresis: stay open until the level falls clearly below.
    const open = level >= (this.holdSamples > 0 ? this.threshold * 0.7 : this.threshold);
    if (open) this.holdSamples = this.holdLength;
    else this.holdSamples = Math.max(0, this.holdSamples - input.length);
    const target = this.holdSamples > 0 ? 1 : 0;
    for (let i = 0; i < input.length; i++) {
      if (this.gain < target) this.gain = Math.min(target, this.gain + this.attack);
      else if (this.gain > target) this.gain = Math.max(target, this.gain - this.release);
      output[i] = input[i] * this.gain;
    }
    return true;
  }
}

registerProcessor("webspeak-noise-gate", WebSpeakNoiseGate);
