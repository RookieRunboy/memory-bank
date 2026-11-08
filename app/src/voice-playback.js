import { firstShort, splitSentences, ACKS, pickAck } from './split.js';
import { speakable } from './planner.js';

const CANCELLED = Symbol('cancelled');
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

// Every playback outlet belongs to one cancellable job. Stopping a job settles
// its waits immediately, including browsers/fetch implementations ignoring abort.
export class VoicePlayback {
  constructor({ env = globalThis, fetchImpl = globalThis.fetch?.bind(globalThis), timeoutMs = 9000,
    onState = () => {}, onFirstAudio = () => {}, onComplete = () => {}, now = () => performance.now() } = {}) {
    Object.assign(this, { env, fetchImpl, timeoutMs, onState, onFirstAudio, onComplete, now });
    this._enabled = false; this.job = null; this.context = null; this.audio = env.Audio ? new env.Audio() : null;
    this.config = null; this.ackBlobs = new Map(); this.warmJobs = new Set(); this.lastAck = null; this.command = 0;
  }
  get enabled() { return this._enabled; }
  get active() { return !!this.job?.audible; }
  get pending() { return !!this.job; }
  setEnabled(enabled) { this._enabled = !!enabled; if (!enabled) this.stop('muted'); }
  _context() {
    const C = this.env.AudioContext || this.env.webkitAudioContext;
    if (!this.context && C) this.context = new C();
    return this.context;
  }
  unlock() {
    try { this._context()?.resume()?.catch(() => {}); } catch {}
    if (this.unlocked || this.job) return;
    this.unlocked = true;
    try { if (this.audio) { this.audio.src = SILENCE; this.audio.play()?.catch(() => {}); } } catch {}
    try { if (this.env.speechSynthesis && this.env.SpeechSynthesisUtterance) {
      const u = new this.env.SpeechSynthesisUtterance(''); u.volume = 0; this.env.speechSynthesis.speak(u);
    } } catch {}
  }
  _newJob(options = {}) {
    const j = { ...options, requestedAt: this.now(), cleanups: new Set(), ended: false, audible: false, firstAt: null };
    j.cancelled = new Promise(resolve => { j.release = resolve; });
    return j;
  }
  _valid(j) { return !j.ended && (j === this.job || this.warmJobs.has(j)); }
  _guard(j) { if (!this._valid(j)) throw CANCELLED; }
  _cleanup(j) {
    for (const clean of [...j.cleanups]) { try { clean(); } catch {} }
    j.cleanups.clear(); j.release();
  }
  _finish(j, completed, reason) {
    if (j.ended) return j.result;
    j.ended = true;
    j.result = { responseId: j.responseId, kind: j.kind, completed, reason, text: j.text || '', spokenText: j.spokenText || '',
      audible: j.firstAt != null, firstAudioMs: j.firstAt == null ? null : j.firstAt - j.requestedAt,
      elapsedMs: this.now() - j.requestedAt };
    if (this.job === j) { this.job = null; this._cleanup(j); this.onState(false); }
    else this._cleanup(j);
    j.resolveDone?.(j.result);
    this.onComplete(j.result);
    return j.result;
  }
  stop(reason = 'cancel') { this.command++; return this._stop(reason); }
  _stop(reason) {
    const j = this.job;
    // Release this scope before completion callbacks can create a new scope.
    const warming = [...this.warmJobs]; this.warmJobs.clear();
    for (const warm of warming) { warm.ended = true; this._cleanup(warm); }
    // Stop the unlocked empty utterance before callbacks can create another job.
    try { this.audio?.pause(); } catch {}
    try { this.env.speechSynthesis?.cancel(); } catch {}
    if (j) this._finish(j, false, reason);
    return j?.result;
  }
  async dispose() { this.stop('dispose'); const c = this.context; this.context = null; await c?.close()?.catch(() => {}); }
  async _wait(promise, j, timeout = this.timeoutMs) {
    this._guard(j);
    let timer;
    const clear = () => this.env.clearTimeout(timer);
    j.cleanups.add(clear);
    try {
      const value = await Promise.race([Promise.resolve(promise), j.cancelled.then(() => { throw CANCELLED; }),
        new Promise((_, reject) => { timer = this.env.setTimeout(() => reject(new Error('audio timeout')), timeout); })]);
      this._guard(j); return value;
    } finally { clear(); j.cleanups.delete(clear); }
  }
  async _request(url, j) {
    this._guard(j);
    const ctl = new AbortController(), abort = () => ctl.abort(); j.cleanups.add(abort);
    try { const r = await this._wait(this.fetchImpl(url, { signal: ctl.signal }), j); if (!r.ok) throw new Error('audio request'); return r; }
    catch (e) { abort(); throw e; }
  }
  async _config(j) {
    if (this.config) return this.config;
    try { const r = await this._request('/api/tts/config', j), c = await this._wait(r.json(), j); this._guard(j); this.config = c; return c; }
    catch (e) { if (e === CANCELLED) throw e; return { enabled: false, stream: false }; }
  }
  _first(j, method, at = this.now()) {
    if (!this._valid(j)) return;
    if (j.sentence && j.startedSentence !== j.sentence) {
      j.spokenText = (j.spokenText || '') + j.sentence.text; j.startedSentence = j.sentence;
    }
    if (j.firstAt != null) return;
    j.firstAt = at; j.audible = true; this.onState(true);
    if (!this._valid(j)) return;
    this.onFirstAudio({ responseId: j.responseId, kind: j.kind, requestedAt: j.requestedAt, text: j.text || '', spokenText: j.spokenText || '',
      at, firstAudioMs: at - j.requestedAt, method,
      ttsFirstByteMs: j.readyAt == null ? null : Math.max(0, j.readyAt - j.ttsRequestedAt),
      networkWaitMs: j.readyAt == null ? null : Math.max(0, j.readyAt - j.requestedAt),
      playbackLeadMs: j.readyAt == null ? null : Math.max(0, at - j.readyAt) });
  }
  _audioReady(j, requestedAt, readyAt = this.now()) {
    if (!this._valid(j) || j.readyAt != null) return;
    j.ttsRequestedAt = requestedAt; j.readyAt = readyAt;
  }
  async speak(text, { force = false, kind = 'formal', responseId } = {}) {
    const command = ++this.command;
    this._stop('superseded');
    const j = this._newJob({ kind, responseId, text: String(text || '') });
    // A callback may deliberately issue a newer speak/stop synchronously.
    if (command !== this.command) return this._finish(j, false, 'superseded');
    this.job = j;
    if (!this.enabled && !force) return this._finish(j, false, 'muted');
    const parts = firstShort(splitSentences(speakable(text || '')));
    if (!parts.length) return this._finish(j, false, 'empty');
    try {
      const cfg = await this._config(j); this._guard(j);
      const streaming = cfg.enabled && cfg.stream && (this.env.AudioContext || this.env.webkitAudioContext);
      const prepare = async index => {
        if (index >= parts.length || !this._valid(j)) return null;
        const part = parts[index];
        if (this.ackBlobs.has(part)) return { blob: this.ackBlobs.get(part), requestedAt: this.now(), readyAt: this.now() };
        if (!cfg.enabled) return null;
        const requestedAt = this.now();
        if (streaming) {
          try { return { response: await this._request('/api/tts/stream?t=' + encodeURIComponent(part), j), requestedAt }; }
          catch (error) { return { error }; }
        }
        return { blob: await this._blob(part, j), requestedAt, readyAt: this.now() };
      };
      // Keep just one sentence ahead. Streaming prefetch starts when the prior
      // stream has downloaded, letting the browser buffer while sound plays.
      let prepared = prepare(0);
      for (let index = 0; index < parts.length; index++) {
        const part = parts[index], media = await this._wait(prepared, j); this._guard(j); j.sentence = { text: part };
        let nextPrepared, played = false;
        const next = () => { nextPrepared ??= prepare(index + 1).catch(error => ({ error })); };
        if (media?.blob) { this._audioReady(j, media.requestedAt, media.readyAt); next(); played = await this._playBlob(media.blob, j); }
        else if (streaming && media?.response) played = await this._stream(part, j, { response: media.response, requestedAt: media.requestedAt, onBuffered: next });
        this._guard(j); next();
        if (!played) played = await this._browserSay(part, j);
        this._guard(j);
        if (!played) return this._finish(j, false, 'playback-unavailable');
        prepared = nextPrepared;
      }
      return this._finish(j, true, 'ended');
    } catch (e) { return j.ended ? j.result : this._finish(j, false, e === CANCELLED ? 'cancel' : 'playback-error'); }
  }
  beginStream({ force = false, kind = 'formal', responseId } = {}) {
    const command = ++this.command;
    this._stop('superseded');
    const j = this._newJob({ kind, responseId, text: '', spokenText: '', tail: '', queue: [], inputEnded: false, sentenceCount: 0,
      silent: !this.enabled && !force, allowPrefetch: false });
    const done = new Promise(resolve => { j.resolveDone = resolve; });
    const wake = () => { const resolve = j.wake; j.wake = null; resolve?.(); };
    j.cleanups.add(wake);
    const enqueue = text => {
      for (const sentence of firstShort(splitSentences(speakable(text)))) { j.queue.push({ text: sentence }); j.sentenceCount++; }
      if (j.allowPrefetch && j.queue.length) j.prepare?.(j.queue[0]);
      wake();
    };
    const flush = final => {
      // Stream only stable sentence/phrase boundaries. A token or a short
      // punctuation-free prefix is not enough to start a separate TTS job.
      let end;
      while ((end = j.tail.search(/[。！？!?；;\n]/)) >= 0) {
        enqueue(j.tail.slice(0, end + 1)); j.tail = j.tail.slice(end + 1);
      }
      if (!final && j.tail.length >= 16) {
        const comma = j.tail.lastIndexOf('，', 32);
        if (comma >= 5) { enqueue(j.tail.slice(0, comma + 1)); j.tail = j.tail.slice(comma + 1); }
      }
      if (final && j.tail.trim()) { enqueue(j.tail); j.tail = ''; }
    };
    const handle = {
      append: delta => {
        if (!this._valid(j) || j.inputEnded || typeof delta !== 'string') return false;
        // Host replies are a few sentences. Bound a malformed endless stream
        // without allowing its queued audio to outlive this cancellation scope.
        if (j.text.length + delta.length > 12000) { this._finish(j, false, 'text-overflow'); return false; }
        j.text += delta;
        if (!j.silent) { j.tail += delta; flush(false); }
        return true;
      },
      finish: () => {
        if (this._valid(j) && !j.inputEnded) { j.inputEnded = true; flush(true); wake(); }
        return done;
      },
      cancel: (reason = 'cancel') => {
        // A handle retained by a stale network callback may only cancel itself.
        if (this.job === j && !j.ended) this.stop(reason);
        return done;
      },
      done,
    };
    if (command !== this.command) this._finish(j, false, 'superseded');
    else { this.job = j; this.onState(false); if (this._valid(j)) this._runTextStream(j); }
    return handle;
  }
  async _runTextStream(j) {
    try {
      this._guard(j);
      const cfg = j.silent ? null : await this._config(j); this._guard(j);
      const streaming = cfg?.enabled && cfg.stream && (this.env.AudioContext || this.env.webkitAudioContext);
      j.prepare = item => {
        if (!item || !this._valid(j)) return null;
        item.prepared ??= (async () => {
          if (this.ackBlobs.has(item.text)) return { blob: this.ackBlobs.get(item.text), requestedAt: this.now(), readyAt: this.now() };
          if (!cfg?.enabled) return null;
          const requestedAt = this.now();
          if (streaming) return { response: await this._request('/api/tts/stream?t=' + encodeURIComponent(item.text), j), requestedAt };
          return { blob: await this._blob(item.text, j), requestedAt, readyAt: this.now() };
        })().catch(error => ({ error }));
        return item.prepared;
      };
      while (this._valid(j)) {
        if (!j.queue.length) {
          if (j.inputEnded) break;
          // append/finish and cancellation all release this wait. Unlike audio
          // downloads, incoming model text has its own generous idle budget.
          await this._wait(new Promise(resolve => { j.wake = resolve; }), j, 45000);
          continue;
        }
        const item = j.queue.shift(); j.allowPrefetch = false;
        const media = await this._wait(j.prepare(item), j); this._guard(j);
        const next = () => { j.allowPrefetch = true; j.prepare(j.queue[0]); };
        j.sentence = item;
        let played = false;
        if (media?.blob) { this._audioReady(j, media.requestedAt, media.readyAt); next(); played = await this._playBlob(media.blob, j); }
        else if (streaming && media?.response) played = await this._stream(item.text, j, { response: media.response, requestedAt: media.requestedAt, onBuffered: next });
        this._guard(j); next();
        if (!played) played = await this._browserSay(item.text, j);
        this._guard(j);
        if (!played) return this._finish(j, false, 'playback-unavailable');
      }
      this._guard(j);
      return this._finish(j, !j.silent && j.sentenceCount > 0, j.silent ? 'muted' : j.sentenceCount ? 'ended' : 'empty');
    } catch (e) { return j.ended ? j.result : this._finish(j, false, e === CANCELLED ? 'cancel' : 'playback-error'); }
  }
  async _blob(text, j) {
    try { const r = await this._request('/api/tts?t=' + encodeURIComponent(text), j); return await this._wait(r.blob(), j); }
    catch (e) { if (e === CANCELLED) throw e; return null; }
  }
  async _playBlob(blob, j) {
    this._guard(j); if (!this.audio) return false;
    const audio = this.audio, url = this.env.URL.createObjectURL(blob);
    let settle, cleaned = false;
    const done = new Promise(resolve => { settle = resolve; });
    const clean = () => {
      if (cleaned) return; cleaned = true;
      audio.onplaying = audio.onended = audio.onerror = null; audio.pause();
      audio.removeAttribute?.('src'); audio.load?.(); this.env.URL.revokeObjectURL(url); settle(false);
    };
    j.cleanups.add(clean);
    try {
      audio.onplaying = () => this._first(j, 'audio-playing');
      audio.onended = () => settle(this._valid(j)); audio.onerror = () => settle(false); audio.src = url;
      try { await this._wait(audio.play(), j); } catch (e) { if (e === CANCELLED) throw e; return false; }
      return await this._wait(done, j, 60000);
    } catch (e) { if (e === CANCELLED) throw e; return false; }
    finally { clean(); j.cleanups.delete(clean); }
  }
  async _stream(text, j, { response, requestedAt = this.now(), onBuffered = () => {} } = {}) {
    let reader, count = 0, context, nextAt, rest = null; const endPromises = [], sentenceNodes = new Set();
    const cancel = () => { try { reader?.cancel()?.catch(() => {}); } catch {} };
    j.cleanups.add(cancel);
    try {
      context = this._context(); if (!context) return false;
      if (context.state === 'suspended') await this._wait(context.resume(), j);
      const r = response || await this._request('/api/tts/stream?t=' + encodeURIComponent(text), j); this._guard(j);
      reader = r.body.getReader(); nextAt = context.currentTime + 0.02;
      for (;;) {
        const chunk = await this._wait(reader.read(), j); this._guard(j); if (chunk.done) break;
        let bytes = chunk.value;
        if (rest != null) { const joined = new Uint8Array(bytes.length + 1); joined[0] = rest; joined.set(bytes, 1); bytes = joined; rest = null; }
        if (bytes.length % 2) { rest = bytes.at(-1); bytes = bytes.subarray(0, -1); }
        if (!bytes.length) continue;
        this._audioReady(j, requestedAt);
        const size = bytes.length / 2, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
        const buffer = context.createBuffer(1, size, 24000), data = buffer.getChannelData(0);
        for (let i = 0; i < size; i++) data[i] = view.getInt16(i * 2, true) / 32768;
        const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
        let resolveEnd;
        const ended = new Promise(resolve => { resolveEnd = resolve; }); endPromises.push(ended); sentenceNodes.add(source);
        const clean = () => { source.onended = null; try { source.stop(); } catch {} try { source.disconnect(); } catch {} sentenceNodes.delete(source); resolveEnd(); };
        j.cleanups.add(clean);
        source.onended = () => { try { source.disconnect(); } catch {} sentenceNodes.delete(source); j.cleanups.delete(clean); resolveEnd(); };
        nextAt = Math.max(nextAt, context.currentTime + 0.005);
        source.start(nextAt); count++;
        // WebAudio schedules output ahead of the hardware clock. Record the
        // scheduled first sample (not a claim about acoustic speaker latency).
        this._first(j, 'webaudio-scheduled', this.now() + Math.max(0, nextAt - context.currentTime) * 1000);
        nextAt += buffer.duration;
      }
      onBuffered();
      if (!count) return false;
      await this._wait(Promise.all(endPromises), j, Math.max(1000, (nextAt - context.currentTime) * 1000 + 1500));
      return true;
    } catch (e) {
      if (e === CANCELLED) throw e;
      // Never repeat an already audible partial sentence via browser TTS.
      if (count) { for (const node of sentenceNodes) { try { node.stop(); } catch {} } throw e; }
      return false;
    } finally { cancel(); j.cleanups.delete(cancel); }
  }
  async _browserSay(text, j) {
    this._guard(j); const synth = this.env.speechSynthesis, U = this.env.SpeechSynthesisUtterance;
    if (!synth || !U) return false;
    const u = new U(text); u.lang = 'zh-CN'; u.rate = 1;
    const voice = synth.getVoices().find(v => /zh|Chinese/i.test(v.lang)); if (voice) u.voice = voice;
    let settle, cleaned = false; const done = new Promise(resolve => { settle = resolve; });
    const clean = () => { if (cleaned) return; cleaned = true; u.onstart = u.onend = u.onerror = null; synth.cancel(); settle(false); };
    j.cleanups.add(clean);
    try {
      u.onstart = () => this._first(j, 'speech-start'); u.onend = () => settle(this._valid(j)); u.onerror = () => settle(false);
      synth.speak(u); return await this._wait(done, j, 30000);
    } catch (e) { if (e === CANCELLED) throw e; return false; }
    finally { clean(); j.cleanups.delete(clean); }
  }
  playAck({ responseId } = {}) { this.lastAck = pickAck(this.lastAck); return this.speak(this.lastAck, { kind: 'ack', responseId }); }
  async prefetchAcks() {
    if (!this.enabled) return;
    const j = this._newJob({ kind: 'warm' }); this.warmJobs.add(j);
    try {
      const cfg = await this._config(j); this._guard(j); if (!cfg.enabled) return;
      for (const text of ACKS) {
        if (this.ackBlobs.has(text)) continue;
        const blob = await this._blob(text, j); this._guard(j); if (blob) this.ackBlobs.set(text, blob);
      }
    } catch {} finally { j.ended = true; this._cleanup(j); this.warmJobs.delete(j); }
  }
}
