import { VoiceActivityDetector, VOICE_DEFAULTS, encodeWav, joinPCM } from './voice-vad.js';

export class VoiceCapture {
  constructor({ onSpeechStart = () => {}, onSpeechAudio = () => {}, onWave = () => {}, onSegment = () => {}, onFullSegment = () => {}, onState = () => {}, onError = () => {}, onLevel = () => {}, isPlaying = () => false, config = {}, env = {} } = {}) {
    this.config = { ...VOICE_DEFAULTS, ...config };
    Object.assign(this, { onSpeechStart, onSpeechAudio, onWave, onSegment, onFullSegment, onState, onError, onLevel, isPlaying });
    this.env = { mediaDevices: globalThis.navigator?.mediaDevices,
      AudioContext: globalThis.AudioContext || globalThis.webkitAudioContext, AudioWorkletNode: globalThis.AudioWorkletNode,
      now: () => Date.now(), ...env };
    this.epoch = 0; this.sequence = 0; this.disposed = false; this.fullFrames = []; this.fullSamples = 0; this.level = 0;
  }
  get active() { return !!this.stream && !this.draining; }
  get speaking() { return !!this.vad?.speaking; }
  async start() {
    if (this.pausing) await this.pausing;
    if (this.disposed) throw new Error('语音访谈已结束');
    if (this.active) return this.settings;
    if (this.starting) return this.starting;
    const token = ++this.epoch;
    this.starting = this.open(token).finally(() => { if (token === this.epoch) this.starting = null; });
    return this.starting;
  }
  async open(token) {
    let stream, ctx;
    try {
      if (!this.env.mediaDevices?.getUserMedia || !this.env.AudioContext) throw new Error('这里暂时不能开麦，可以打字继续');
      this.onState('opening');
      stream = await this.env.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
      if (token !== this.epoch || this.disposed) { stream.getTracks().forEach(t => t.stop()); return null; }
      ctx = new this.env.AudioContext(); await ctx.resume();
      if (token !== this.epoch || this.disposed) { stream.getTracks().forEach(t => t.stop()); await ctx.close(); return null; }
      this.ctx = ctx; this.sampleRate = ctx.sampleRate; this.settings = stream.getAudioTracks()[0]?.getSettings?.() || {};
      this.originAt = this.env.now(); this.capturedSamples = 0; this.fullStartedAt = this.originAt;
      this.fullFrames = []; this.fullSamples = 0;
      this.vad = new VoiceActivityDetector({ sampleRate: this.sampleRate, config: this.config, onSpeechStart: info => {
        this.sentStartFrame=true;this.onSpeechStart(info);
        this.onSpeechAudio(joinPCM(this.vad.frames),this.sampleRate);
      },
        onSegment: ({ pcm, ...segment }) => this.onSegment({ ...segment, blob: new Blob([encodeWav(pcm, this.sampleRate)], { type: 'audio/wav' }) }) });
      const source = ctx.createMediaStreamSource(stream), gain = ctx.createGain(); gain.gain.value = 0;
      this.source = source; this.gain = gain;
      if (ctx.audioWorklet && this.env.AudioWorkletNode) {
        await ctx.audioWorklet.addModule(new URL('./voice-worklet.js', import.meta.url));
        if (token !== this.epoch || this.disposed) { stream.getTracks().forEach(t => t.stop()); await ctx.close(); return null; }
        this.processor = new this.env.AudioWorkletNode(ctx, 'memory-bank-capture', { processorOptions: { frameMs: this.config.frameMs }, channelCount: 1 });
        this.processor.port.onmessage = ({ data }) => {
          if ((token === this.epoch || token === this.drainingToken) && this.stream && data?.pcm) this.accept(data.pcm);
          if (data?.flushed) this.flushReady?.();
        };
      } else {
        // Older Safari fallback; same shared stream and WAV encoding. Larger
        // callback size is reported as settings.captureMode for measurement.
        this.processor = ctx.createScriptProcessor(1024, 1, 1);
        this.processor.onaudioprocess = event => { if (token === this.epoch && this.active) this.accept(event.inputBuffer.getChannelData(0)); };
      }
      this.settings = { ...this.settings, sampleRate: this.sampleRate, captureMode: this.processor.port ? 'audio-worklet' : 'script-processor' };
      this.stream = stream;
      for (const track of stream.getTracks()) track.onended = () => { if (token !== this.epoch || !this.active) return;
        this.pause('device-lost'); this.onError(new Error('麦克风断开了，点开麦可继续，也可以打字')); };
      source.connect(this.processor); this.processor.connect(gain); gain.connect(ctx.destination);
      this.onState('listening'); return this.settings;
    } catch (error) {
      stream?.getTracks().forEach(t => t.stop());
      if (token === this.epoch) { await this.pause('error'); this.onError(error); }
      else await ctx?.close?.().catch(() => {});
      throw error;
    }
  }
  accept(input) {
    if (!this.stream || (this.disposed && !this.draining)) return;
    const frameSize = Math.max(1, Math.round(this.sampleRate * this.config.frameMs / 1000));
    // ScriptProcessor and injected audio may supply arbitrary block lengths.
    const joined = this.pendingPCM?.length ? joinPCM([this.pendingPCM, input]) : new Float32Array(input);
    let offset = 0;
    for (; offset + frameSize <= joined.length; offset += frameSize) this.acceptFrame(joined.slice(offset, offset + frameSize));
    this.pendingPCM = joined.slice(offset);
  }
  acceptFrame(pcm) {
    const at = this.originAt + this.capturedSamples * 1000 / this.sampleRate;
    this.capturedSamples += pcm.length; this.fullFrames.push(pcm); this.fullSamples += pcm.length;
    const wasSpeaking = this.vad.speaking;this.sentStartFrame=false;
    this.vad.push(pcm, at, { playing: this.isPlaying(), echoCancellation: this.settings?.echoCancellation });
    if(this.vad.speaking&&!this.sentStartFrame)this.onSpeechAudio(pcm,this.sampleRate);
    if (this.active && !this.disposed) this.updateLevel(pcm);
    if (wasSpeaking && !this.vad.speaking) this.onState('listening');
    if (this.fullSamples * 1000 / this.sampleRate >= this.config.maxFullMs) this.flushFull('chunk');
  }
  updateLevel(pcm) {
    // Meter the existing capture samples; never alter PCM or open another mic.
    let energy = 0;
    for (const sample of pcm) energy += sample * sample;
    const rms = Math.sqrt(energy / Math.max(1, pcm.length));
    const target = Math.sqrt(Math.min(1, Math.max(0, (rms - .0012) / .08)));
    const seconds = pcm.length / this.sampleRate, timeConstant = target > this.level ? .035 : .1;
    this.level += (target - this.level) * (1 - Math.exp(-seconds / timeConstant));
    if (this.level < .002 && target === 0) this.level = 0;
    this.onLevel(this.level);
    const wave=Array.from({length:24},(_,index)=>{
      const from=Math.floor(index*pcm.length/24),to=Math.floor((index+1)*pcm.length/24);let sum=0;
      for(let i=from;i<to;i++)sum+=pcm[i]*pcm[i];
      return Math.min(1,Math.sqrt(sum/Math.max(1,to-from))/.06);
    });
    this.onWave(wave);
  }
  flushFull(boundary) {
    if (!this.fullSamples) return;
    const durMs = this.fullSamples * 1000 / this.sampleRate;
    const segment = { blob: new Blob([encodeWav(joinPCM(this.fullFrames, this.fullSamples), this.sampleRate)], { type: 'audio/wav' }),
      durMs, sequence: this.sequence++, startedAt: this.fullStartedAt, endedAt: this.fullStartedAt + durMs, boundary };
    this.fullStartedAt += durMs; this.fullFrames = []; this.fullSamples = 0;
    this.onFullSegment(segment);
  }
  // Stops tracks synchronously so the device indicator disappears at the click.
  // PCM already delivered to the main thread is flushed before graph teardown.
  pause(boundary = 'pause', { flush = true } = {}) {
    if (this.pausing) return this.pausing;
    this.drainingToken = this.epoch; ++this.epoch; this.starting = null; this.draining = true;this.onWave(Array(24).fill(0));
    this.level = 0; this.onLevel(0);
    const stream = this.stream, ctx = this.ctx;
    stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    this.onState(boundary === 'end' ? 'closed' : 'paused');
    const drain = flush && stream && this.processor?.port ? new Promise(resolve => {
      const timer = setTimeout(() => { this.flushReady = null; resolve(); }, 120);
      this.flushReady = () => { clearTimeout(timer); this.flushReady = null; resolve(); };
      this.processor.port.postMessage('flush');
    }) : Promise.resolve();
    this.pausing = drain.then(async () => {
      try {
        if (flush && this.pendingPCM?.length) this.acceptFrame(this.pendingPCM);
        if (flush) { this.vad?.flush({ boundary, at: this.originAt + (this.capturedSamples || 0) * 1000 / (this.sampleRate || 1) }); this.flushFull(boundary); }
        else { this.vad?.reset(); this.fullFrames = []; this.fullSamples = 0; }
      } finally {
        this.pendingPCM = null; this.stream = null; this.ctx = null;
        if (this.processor?.port) { this.processor.port.onmessage = null; this.processor.port.close(); }
        if (this.processor) this.processor.onaudioprocess = null;
        for (const node of [this.source, this.processor, this.gain]) { try { node?.disconnect(); } catch {} }
        this.source = this.processor = this.gain = null; this.drainingToken = null; this.draining = false;
        await ctx?.close().catch(() => {});
        this.onState(boundary === 'end' ? 'closed' : 'paused');
      }
    }).finally(() => { this.pausing = null; });
    return this.pausing;
  }
  dispose({ flush = true } = {}) { this.disposed = true; return this.pause('end', { flush }); }
}
