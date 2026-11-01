// Plays 48 kHz stereo s16le chunks from the capture helper with a small
// cushion, so the frame's audio can be captured into a screen share.
const TARGET = 48000 * 0.06; // start or resume after 60 ms
const LIMIT = 48000 * 0.25;  // never let more than 250 ms pile up

class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.frames = 0;
    this.playing = false;
    this.port.onmessage = (event) => {
      const samples = new Int16Array(event.data);
      this.queue.push(samples);
      this.frames += samples.length / 2;
      while (this.frames > LIMIT && this.queue.length > 1) {
        const dropped = this.queue.shift();
        this.frames -= (dropped.length - this.offset) / 2;
        this.offset = 0;
      }
    };
  }
  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    if (!this.playing && this.frames >= TARGET) this.playing = true;
    for (let index = 0; index < left.length; index++) {
      if (!this.playing || this.queue.length === 0) {
        this.playing = false;
        left[index] = 0;
        if (right) right[index] = 0;
        continue;
      }
      const chunk = this.queue[0];
      left[index] = chunk[this.offset] / 32768;
      if (right) right[index] = chunk[this.offset + 1] / 32768;
      this.offset += 2;
      this.frames--;
      if (this.offset >= chunk.length) { this.queue.shift(); this.offset = 0; }
    }
    return true;
  }
}
registerProcessor("pcm-player", PcmPlayer);
