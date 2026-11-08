// Local, deliberately patient endpoint detector. This is an acoustic heuristic,
// not an ASR model; device AEC and real-room validation remain necessary.
export const VOICE_DEFAULTS = Object.freeze({
  frameMs: 20, speechStartMs: 160, minSpeechMs: 260,
  preRollMs: 400, tailMs: 220, endpointMs: 2200,
  maxSegmentMs: 45000, maxFullMs: 30000,
  minRms: .003, noiseFloorRms: .0012, noiseRatio: 2.5,
  playbackRatio: 1.2,
});

export function encodeWav(pcm, sampleRate = 16000) {
  const out = new Uint8Array(44 + pcm.length * 2), view = new DataView(out.buffer);
  const text = (at, value) => { for (let i = 0; i < value.length; i++) out[at + i] = value.charCodeAt(i); };
  text(0, 'RIFF'); view.setUint32(4, out.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) { const s = Math.max(-1, Math.min(1, pcm[i])); view.setInt16(44 + i * 2, Math.round(s * (s < 0 ? 32768 : 32767)), true); }
  return out;
}

export function joinPCM(frames, length = frames.reduce((n, f) => n + f.length, 0)) {
  const out = new Float32Array(length); let at = 0;
  for (const frame of frames) { const count = Math.min(frame.length, length - at); if (count <= 0) break; out.set(frame.subarray(0, count), at); at += count; }
  return out;
}

// Energy + crossing band + periodicity exclude silence, isolated impacts and
// broadband noise. Long coughs / speech-like background audio need real tests.
export function voiceFeatures(pcm, sampleRate) {
  let energy = 0, peak = 0, crossings = 0;
  for (let i = 0; i < pcm.length; i++) { const x = pcm[i]; energy += x * x; peak = Math.max(peak, Math.abs(x)); if (i && ((x >= 0) !== (pcm[i - 1] >= 0))) crossings++; }
  const rms = Math.sqrt(energy / Math.max(1, pcm.length));
  const crossingHz = crossings * sampleRate / (2 * Math.max(1, pcm.length));
  let periodicity = 0;
  // Decimate only for classification (archival PCM stays untouched).
  const step = Math.max(1, Math.round(sampleRate / 8000));
  const minLag = Math.max(1, Math.floor(sampleRate / 450 / step)), maxLag = Math.floor(sampleRate / 85 / step);
  if (rms > .0002 && crossingHz > 75 && crossingHz < 4200) {
    for (let lag = minLag; lag <= maxLag; lag += 2) {
      let dot = 0, a = 0, b = 0;
      for (let i = lag * step; i < pcm.length; i += step) { const x = pcm[i], y = pcm[i - lag * step]; dot += x * y; a += x * x; b += y * y; }
      periodicity = Math.max(periodicity, dot / (Math.sqrt(a * b) || 1));
    }
  }
  return { rms, crossingHz, periodicity, speechLike: crossingHz >= 85 && crossingHz <= 4200 && peak / (rms || 1) < 8 && (periodicity > .42 || crossingHz < 1800) };
}

export class VoiceActivityDetector {
  constructor({ sampleRate = 16000, config = {}, onSpeechStart = () => {}, onSegment = () => {} } = {}) {
    this.sampleRate = sampleRate; this.config = { ...VOICE_DEFAULTS, ...config };
    this.onSpeechStart = onSpeechStart; this.onSegment = onSegment;
    this.noiseFloor = this.config.noiseFloorRms; this.reset();
  }
  get speaking() { return this.inSpeech; }
  get bufferedMs() { return this.samples * 1000 / this.sampleRate; }
  reset() {
    this.inSpeech = false; this.frames = []; this.samples = 0; this.pre = []; this.preMs = 0;
    this.candidateMs = 0; this.voicedMs = 0; this.chunkVoicedMs = 0; this.lastSpeechEnd = 0; this.startedAt = 0; this.hadContinuation = false;
  }
  push(input, at, { playing = false, echoCancellation = true } = {}) {
    const pcm = new Float32Array(input), ms = pcm.length * 1000 / this.sampleRate, end = at + ms;
    const f = voiceFeatures(pcm, this.sampleRate), c = this.config;
    const threshold = Math.max(c.minRms, this.noiseFloor * c.noiseRatio) * (playing ? c.playbackRatio : 1);
    const human = f.speechLike && f.rms >= threshold;
    // AEC is requested by capture. Never turn off listening while playing, even
    // on browsers that cannot report whether AEC was honored.
    void echoCancellation;
    if (!this.inSpeech) {
      this.pre.push({ pcm, at, ms }); this.preMs += ms;
      while (this.pre.length > 1 && this.preMs - this.pre[0].ms >= c.preRollMs + c.speechStartMs) this.preMs -= this.pre.shift().ms;
      if (human) {
        if (!this.candidateMs) this.candidateAt = at;
        this.candidateMs += ms;
      } else {
        this.candidateMs = 0;
        if (!f.speechLike) this.noiseFloor += (Math.min(f.rms, .025) - this.noiseFloor) * (f.rms < this.noiseFloor ? .03 : .006);
      }
      if (this.candidateMs + .01 < c.speechStartMs) return;
      this.inSpeech = true; this.startedAt = this.pre[0].at; this.frames = this.pre.map(x => x.pcm);
      this.samples = this.frames.reduce((n, x) => n + x.length, 0); this.pre = []; this.preMs = 0;
      this.voicedMs = this.candidateMs; this.chunkVoicedMs = this.candidateMs; this.lastSpeechEnd = end;
      this.onSpeechStart({ speechAt: this.candidateAt, confirmedAt: end, confirmationMs: end - this.candidateAt });
    } else {
      this.frames.push(pcm); this.samples += pcm.length;
      if (human) { this.lastSpeechEnd = end; this.voicedMs += ms; this.chunkVoicedMs += ms; }
    }
    if (end - this.lastSpeechEnd + .01 >= c.endpointMs) {
      this.emit({ continuation: false, at: end, endpointMs: end - this.lastSpeechEnd }); this.reset();
    } else if (this.bufferedMs >= c.maxSegmentMs) {
      // Only split in speech. During endpoint silence the extra bounded tail is
      // held until we know whether another thought follows.
      if (human) this.emit({ continuation: true, at: end, endpointMs: 0 });
    }
  }
  emit({ continuation, at, endpointMs = 0, boundary }) {
    if (!continuation && this.hadContinuation && !this.chunkVoicedMs) {
      // The previous bounded chunk already contains the last spoken sample.
      // Tell the server to finish that utterance without ASR of silence and
      // without creating another raw transcript (also works on immediate pause).
      this.onSegment({pcm:new Float32Array(0), sampleRate:this.sampleRate, startedAt:this.startedAt, endedAt:this.startedAt,
        speechEndedAt:this.lastSpeechEnd, capturedAt:at, durMs:0, endpointMs, continuation:false, finalizeContinuation:true, ...(boundary?{boundary}:{})});
      return;
    }
    if (!this.samples || (!this.hadContinuation && this.voicedMs < this.config.minSpeechMs)) return;
    const count = continuation ? this.samples : Math.min(this.samples, Math.max(0, Math.round((this.lastSpeechEnd + this.config.tailMs - this.startedAt) * this.sampleRate / 1000)));
    if (!count) return;
    const pcm = joinPCM(this.frames, count), durMs = count * 1000 / this.sampleRate;
    this.onSegment({ pcm, sampleRate: this.sampleRate, startedAt: this.startedAt, endedAt: this.startedAt + durMs,
      speechEndedAt: this.lastSpeechEnd, capturedAt: at, durMs, endpointMs, continuation, ...(boundary ? { boundary } : {}) });
    if (continuation) { this.frames = []; this.samples = 0; this.startedAt = at; this.hadContinuation = true; this.chunkVoicedMs = 0; }
  }
  flush({ boundary = 'end', at = this.lastSpeechEnd } = {}) {
    if (this.inSpeech) this.emit({ continuation: false, at, boundary });
    this.reset();
  }
}
