// A single audio graph feeds both VAD and archival capture. 20 ms frames keep
// interruption confirmation responsive without copying every render quantum.
class MemoryBankCapture extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.size = Math.max(128, Math.round(sampleRate * (options.processorOptions?.frameMs || 20) / 1000));
    this.frame = new Float32Array(this.size); this.offset = 0;
    this.port.onmessage = ({ data }) => { if (data !== 'flush') return;
      if (this.offset) { const pcm = this.frame.slice(0, this.offset); this.port.postMessage({ pcm }, [pcm.buffer]); this.offset = 0; }
      this.port.postMessage({ flushed: true }); };
  }
  process(inputs, outputs) {
    const channels = inputs[0];
    if (channels?.length) for (let i = 0; i < channels[0].length; i++) {
      let value = 0; for (const channel of channels) value += channel[i] || 0;
      this.frame[this.offset++] = value / channels.length;
      if (this.offset === this.size) { const pcm = this.frame; this.port.postMessage({ pcm }, [pcm.buffer]); this.frame = new Float32Array(this.size); this.offset = 0; }
    }
    // Output stays silent: the microphone must never be monitored to speakers.
    for (const output of outputs) for (const channel of output) channel.fill(0);
    return true;
  }
}
registerProcessor('memory-bank-capture', MemoryBankCapture);
