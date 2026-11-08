import test from 'node:test';
import assert from 'node:assert/strict';
import { VoicePlayback } from '../src/voice-playback.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(r => setImmediate(r));
function harness({ stream = false, enabled = true, fetchAudio, synthesis = false } = {}) {
  const audios = [], urls = new Set(), nodes = [], events = [], complete = [], states = [], requests = [], utterances = [];
  class Audio {
    constructor() { audios.push(this); this.paused = true; this.src = ''; }
    play() { this.paused = false; this.onplaying?.(); return Promise.resolve(); }
    pause() { this.paused = true; }
    load() {}
    removeAttribute() { this.src = ''; }
  }
  class Context {
    constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; }
    resume() { return Promise.resolve(); }
    createBuffer(ch, length, rate) { return { duration: length / rate, getChannelData: () => new Float32Array(length) }; }
    createBufferSource() { const n = { stopped: false, connect() {}, disconnect() {}, start(t) { this.at = t; }, stop() { this.stopped = true; this.onended?.(); } }; nodes.push(n); return n; }
    close() { return Promise.resolve(); }
  }
  let configResolve;
  const env = { Audio, AudioContext: Context, URL: { createObjectURL() { const u = 'blob:' + Math.random(); urls.add(u); return u; }, revokeObjectURL(u) { urls.delete(u); } }, setTimeout, clearTimeout, performance,
    ...(synthesis ? { SpeechSynthesisUtterance: class { constructor(t) { this.text = t; } }, speechSynthesis: { getVoices: () => [], speak(u) { utterances.push(u); u.onstart?.(); }, cancel() { utterances.forEach(u => u.onend?.()); } } } : {}) };
  const fetchImpl = (url, options = {}) => { requests.push({ url, ...options }); if (url.endsWith('/config')) return Promise.resolve({ ok: true, json: async () => ({ enabled, stream }) }); return fetchAudio?.(url, options) || Promise.resolve({ ok: true, blob: async () => new Blob(['audio']) }); };
  const p = new VoicePlayback({ env, fetchImpl, timeoutMs: 150, onFirstAudio: e => events.push(e), onComplete: e => complete.push(e), onState: s => states.push(s) });
  return { p, audios, urls, nodes, events, complete, states, requests, utterances };
}

test('voice entry enables playback; default mute suppresses network and completion is explicit', async () => {
  const h = harness(); const result = await h.p.speak('您好。', { responseId: 'muted' });
  assert.equal(result.completed, false); assert.equal(result.reason, 'muted'); assert.equal(h.requests.length, 0);
  h.p.setEnabled(true); const pending = h.p.speak('您好。', { responseId: 'r1' }); await tick();
  assert.equal(h.p.active, true); assert.equal(h.events.length, 1); assert.equal(h.events[0].responseId, 'r1');
  assert.ok(h.events[0].ttsFirstByteMs >= 0); assert.ok(h.events[0].playbackLeadMs >= 0);
  assert.ok(Math.abs(h.events[0].firstAudioMs - h.events[0].networkWaitMs - h.events[0].playbackLeadMs) < 0.001);
  h.audios.at(-1).onended(); assert.equal((await pending).completed, true); assert.equal(h.urls.size, 0); assert.equal(h.p.active, false);
});

test('stop resolves waiting download, aborts request and ignores a late response', async () => {
  const late = deferred(), h = harness({ fetchAudio: () => late.promise }); h.p.setEnabled(true);
  const pending = h.p.speak('那天发生了什么？', { responseId: 'old' }); await tick();
  h.p.stop('barge-in'); const r = await pending; assert.equal(r.completed, false); assert.equal(r.reason, 'barge-in');
  assert.equal(h.requests.at(-1).signal.aborted, true);
  late.resolve({ ok: true, blob: async () => new Blob(['late']) }); await tick();
  assert.equal(h.events.length, 0); assert.equal(h.urls.size, 0); assert.equal(h.complete.length, 1);
});

test('stop stops whole-sentence Audio and frees object URL; late ended cannot complete twice', async () => {
  const h = harness(); h.p.setEnabled(true); const pending = h.p.speak('您慢慢说。'); await tick();
  const audio = h.audios.at(-1), oldEnded = audio.onended; assert.equal(h.urls.size, 1);
  h.p.stop('barge-in'); assert.equal((await pending).completed, false); assert.equal(audio.paused, true); assert.equal(h.urls.size, 0);
  oldEnded?.(); assert.equal(h.complete.length, 1); assert.equal(h.p.pending, false);
});

test('queued streaming PCM nodes and stalled reader are cancelled locally', async () => {
  const stalled = deferred(); let reads = 0, cancelled = false;
  const reader = { read: () => ++reads === 1 ? Promise.resolve({ value: new Uint8Array(4800), done: false }) : stalled.promise, cancel() { cancelled = true; return Promise.resolve(); } };
  const h = harness({ stream: true, fetchAudio: async () => ({ ok: true, body: { getReader: () => reader } }) }); h.p.setEnabled(true);
  const pending = h.p.speak('那天谁先开口？'); await tick(); assert.equal(h.nodes.length, 1);
  h.p.stop('barge-in'); assert.equal((await pending).completed, false); assert.equal(h.nodes[0].stopped, true); assert.equal(cancelled, true);
  stalled.resolve({ value: new Uint8Array(4800), done: false }); await tick(); assert.equal(h.nodes.length, 1); assert.equal(h.complete.length, 1);
});

test('browser speech fallback cancels utterance and releases pending completion', async () => {
  const h = harness({ enabled: false, synthesis: true }); h.p.setEnabled(true);
  const pending = h.p.speak('请接着讲。'); await tick(); assert.equal(h.utterances.length, 1); assert.equal(h.p.active, true);
  h.p.stop('mute'); assert.equal((await pending).completed, false); assert.equal(h.p.active, false); assert.equal(h.complete.length, 1);
});

test('late short response is suppressed after stop and never steals the microphone', async () => {
  const late = deferred(), h = harness({ fetchAudio: () => late.promise }); h.p.setEnabled(true);
  const pending = h.p.playAck(); await tick(); h.p.stop('barge-in'); assert.equal((await pending).completed, false);
  late.resolve({ ok: true, blob: async () => new Blob(['ack']) }); await tick(); assert.equal(h.events.length, 0); assert.equal(h.urls.size, 0);
});

test('replay uses same cancellation scope and explicit force respects subsequent mute', async () => {
  const h = harness(); const old = h.p.speak('重播。', { force: true, kind: 'replay' }); await tick();
  assert.equal(h.p.active, true); h.p.setEnabled(false); assert.equal((await old).completed, false); assert.equal(h.p.active, false);
});

test('a noncooperative config request times out without hanging cancellation or starting stale playback', async () => {
  const late = deferred(), h = harness({ synthesis: true }); h.p.fetchImpl = () => late.promise; h.p.setEnabled(true);
  const p = h.p.speak('您好。'); await tick(); h.p.stop('leave'); assert.equal((await p).reason, 'leave');
  late.resolve({ ok: true, json: async () => ({ enabled: true, stream: false }) }); await tick(); assert.equal(h.events.length, 0);
});

test('replacing a playing reply cannot let its late cleanup stop the new reply', async () => {
  const h = harness(); h.p.setEnabled(true); const a = h.p.speak('旧问题。', { responseId: 'old' }); await tick();
  const ended = h.audios.at(-1).onended;
  const b = h.p.speak('新问题。', { responseId: 'new' }); await tick();
  assert.equal((await a).reason, 'superseded'); ended(); await tick();
  assert.equal(h.p.active, true); assert.equal(h.audios.at(-1).paused, false); assert.equal(h.urls.size, 1);
  h.audios.at(-1).onended(); assert.equal((await b).completed, true); assert.equal(h.complete.length, 2);
});

test('whole-response and browser paths settle on errors; forced playback does not enable future auto replies', async () => {
  const h = harness({ enabled: false, synthesis: true }); const forced = h.p.speak('重播。', { force: true }); await tick();
  h.utterances[0].onerror(); assert.equal((await forced).completed, false); assert.equal(h.p.enabled, false);
  assert.equal((await h.p.speak('下一句。')).reason, 'muted'); assert.equal(h.utterances.length, 1);
});

test('stream splits odd byte boundaries safely and completes only after queued nodes end', async () => {
  let n = 0; const pieces = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])];
  const h = harness({ stream: true, fetchAudio: async () => ({ ok: true, body: { getReader: () => ({ read: async () => n < pieces.length ? { done: false, value: pieces[n++] } : { done: true }, cancel: async () => {} }) } }) });
  h.p.setEnabled(true); const result = h.p.speak('您好。'); await tick();
  assert.equal(h.nodes.length, 2); assert.equal(h.nodes[0].buffer.duration + h.nodes[1].buffer.duration, 3 / 24000);
  assert.equal(h.complete.length, 0); h.nodes.forEach(node => node.onended()); assert.equal((await result).completed, true);
  assert.equal(h.events.length, 1); assert.equal(h.p.active, false);
});

test('next sentence downloads during current Audio playback and stays cancellable', async () => {
  const h = harness(); h.p.setEnabled(true); const result = h.p.speak('小时候住在哪里？院子里有什么？'); await tick();
  assert.equal(h.requests.filter(r => r.url.includes('/tts?t=')).length, 2);
  assert.equal(h.events.length, 1); h.p.stop('barge-in'); assert.equal((await result).completed, false);
  assert.equal(h.urls.size, 0);
});

test('next stream prefetch begins after current stream is buffered, before its audio ends', async () => {
  const h = harness({ stream: true, fetchAudio: async () => { let sent = false; return { ok: true, body: { getReader: () => ({ read: async () => sent ? { done: true } : (sent = true, { done: false, value: new Uint8Array(4800) }), cancel: async () => {} }) } }; } });
  h.p.setEnabled(true); const result = h.p.speak('小时候住在哪里？院子里有什么？'); await tick();
  assert.equal(h.requests.filter(r => r.url.includes('/tts/stream?')).length, 2);
  assert.equal(h.nodes.length, 1, 'prefetched sentence must not overlap the one still playing');
  h.p.stop('barge-in'); assert.equal((await result).completed, false); assert.equal(h.nodes[0].stopped, true);
});

test('stop clears old prefetch before callbacks can create a new one', async t => {
  const h = harness(); t.after(() => h.p.stop()); h.p.setEnabled(true);
  const old = h.p.speak('已经说出的旧句。', { responseId: 'old' }); await tick();
  let warming; h.p.onComplete = e => { if (e.responseId === 'old') warming = h.p.prefetchAcks(); };
  h.p.stop('barge-in'); await old; await warming;
  assert.ok(h.p.ackBlobs.size > 0, 'a callback-created prefetch belongs to the new scope');
});

test('onState cancellation cannot dispatch a stale first-audio callback', async t => {
  const h = harness(); t.after(() => h.p.stop()); h.p.setEnabled(true);
  h.p.onState = active => { if (active) h.p.stop('barge-in'); };
  const result = await h.p.speak('小忆的回复。'); assert.equal(result.completed, false); assert.equal(h.events.length, 0);
});

test('a new speak from cancellation callback wins over the older outer replacement', async t => {
  const h = harness(); t.after(() => h.p.stop()); h.p.setEnabled(true);
  const old = h.p.speak('第一句话。', { responseId: 'first' }); await tick();
  let newest; h.p.onComplete = e => { if (e.responseId === 'first') newest = h.p.speak('最新一句话。', { responseId: 'newest' }); };
  const outer = h.p.speak('中间一句话。', { responseId: 'middle' }); await tick();
  assert.equal(h.p.job.responseId, 'newest');
  h.p.stop('test-end'); await Promise.all([old, outer, newest]);
  assert.equal(h.urls.size, 0);
});

test('incremental reply starts its first sentence before finish and later deltas keep that audio alive', async () => {
  const h = harness(); h.p.setEnabled(true);
  const stream = h.p.beginStream({ responseId: 'live' });
  assert.equal(stream.append('小时候'), true); await tick();
  assert.equal(h.requests.filter(r => r.url.includes('/tts?t=')).length, 0);
  stream.append('住在哪里？'); await tick();
  assert.equal(h.events.length, 1); assert.equal(h.events[0].text, '小时候住在哪里？');
  assert.equal(h.complete.length, 0, 'first audio must arrive before the text stream finishes');
  const oldEnded = h.audios[0].onended;
  stream.append('院子里有什么？'); await tick();
  assert.equal(h.audios[0].onended, oldEnded, 'append must not restart the current audio');
  assert.equal(h.requests.filter(r => r.url.includes('/tts?t=')).length, 2, 'one next sentence may download during playback');
  oldEnded(); await tick();
  const done = stream.finish(); h.audios[0].onended();
  const result = await done;
  assert.equal(result.completed, true); assert.equal(result.text, '小时候住在哪里？院子里有什么？');
  assert.equal(h.complete.length, 1); assert.equal(h.events.length, 1);
});

test('finish flushes a partial tail once and repeated finish cannot repeat speech', async () => {
  const h = harness(); h.p.setEnabled(true); const stream = h.p.beginStream({ responseId: 'tail' });
  stream.append('您慢慢说'); await tick(); assert.equal(h.events.length, 0);
  const first = stream.finish(), again = stream.finish(); await tick();
  assert.equal(first, again); assert.equal(h.events.length, 1); h.audios[0].onended();
  assert.equal((await first).completed, true); assert.equal(stream.append('。'), false);
  assert.equal(h.requests.filter(r => r.url.includes('/tts?t=')).length, 1);
});

test('barge-in cancels an incremental request and rejects all late deltas and finish', async () => {
  const late = deferred(), h = harness({ fetchAudio: () => late.promise }); h.p.setEnabled(true);
  const stream = h.p.beginStream({ responseId: 'old-stream' }); stream.append('旧问题。'); await tick();
  h.p.stop('barge-in'); const result = await stream.done;
  assert.equal(result.reason, 'barge-in'); assert.equal(h.requests.at(-1).signal.aborted, true);
  assert.equal(stream.append('迟到的第二句。'), false);
  late.resolve({ ok: true, blob: async () => new Blob(['late']) }); await stream.finish(); await tick();
  assert.equal(h.events.length, 0); assert.equal(h.complete.length, 1);
});

test('incremental stream waiting for more text is cancellable and cannot cancel a replacement job', async () => {
  const h = harness(); h.p.setEnabled(true); const old = h.p.beginStream({ responseId: 'waiting' });
  old.append('尚未说完'); await tick(); h.p.stop('leave'); assert.equal((await old.done).reason, 'leave');
  const next = h.p.speak('新的问题。', { responseId: 'replacement' }); await tick(); old.cancel('late-cancel');
  assert.equal(h.p.active, true); assert.equal(h.p.job.responseId, 'replacement');
  h.audios[0].onended(); await next;
});

test('initially muted stream collects complete text without any TTS request, later mute cancels audible stream', async () => {
  const h = harness(); const muted = h.p.beginStream({ responseId: 'muted-stream' });
  muted.append('第一句。'); muted.append('第二句。');
  const result = await muted.finish(); assert.equal(result.reason, 'muted'); assert.equal(result.text, '第一句。第二句。'); assert.equal(h.requests.length, 0);
  h.p.setEnabled(true); const active = h.p.beginStream({ responseId: 'active-stream' }); active.append('正在说话。'); await tick();
  h.p.setEnabled(false); assert.equal((await active.done).reason, 'muted'); assert.equal(h.audios[0].paused, true); assert.equal(active.append('不能再播。'), false);
});

test('incremental PCM failure after audible data cannot replay or advance to the next sentence', async () => {
  let count = 0;
  const h = harness({ stream: true, synthesis: true, fetchAudio: async () => ({ ok: true, body: { getReader: () => ({ read: async () => {
    if (!count++) return { done: false, value: new Uint8Array(4800) }; throw Error('connection lost');
  }, cancel: async () => {} }) } }) }); h.p.setEnabled(true);
  const live = h.p.beginStream({ responseId: 'partial-failure' }); live.append('已经说了一部分。接下来的问题。'); live.finish();
  const result = await live.done;
  assert.equal(result.reason, 'playback-error'); assert.equal(h.events.length, 1); assert.equal(h.nodes[0].stopped, true);
  assert.equal(h.utterances.length, 0, 'must not repeat an audible partial sentence using browser fallback');
  assert.equal(h.requests.filter(r => r.url.includes('/tts/stream?')).length, 1);
});

test('incremental PCM queues later sentences until current audio ends and releases an idle stream on stop', async () => {
  const h = harness({ stream: true, fetchAudio: async () => {
    let sent = false;
    return { ok: true, body: { getReader: () => ({ read: async () => sent ? { done: true } : (sent = true, { done: false, value: new Uint8Array(4800) }), cancel: async () => {} }) } };
  } }); h.p.setEnabled(true);
  const live = h.p.beginStream({ responseId: 'incremental-pcm' }); live.append('第一句。'); await tick();
  assert.equal(h.nodes.length, 1); assert.equal(h.complete.length, 0);
  live.append('第二句。'); await tick();
  assert.equal(h.requests.filter(r => r.url.includes('/tts/stream?')).length, 2);
  assert.equal(h.nodes.length, 1, 'prefetched next sentence must not overlap current audio');
  h.nodes[0].onended(); await tick(); assert.equal(h.nodes.length, 2);
  h.nodes[1].onended(); await tick(); assert.equal(h.complete.length, 0, 'input is still open');
  h.p.stop('barge-in'); assert.equal((await live.done).reason, 'barge-in');
  assert.equal(live.append('第三句。'), false);
});

test('cancellation from the initial stream state callback does not start a stale provider request', async () => {
  const h = harness(); h.p.setEnabled(true);
  h.p.onState = () => { if (h.p.job) h.p.stop('cancel-during-start'); };
  const live = h.p.beginStream({ responseId: 'never-started' });
  assert.equal((await live.done).reason, 'cancel-during-start'); assert.equal(live.append('不应播放。'), false);
  assert.equal(h.requests.length, 0);
});

test('a punctuation-only incremental reply finishes empty without claiming successful speech', async () => {
  const h = harness(); h.p.setEnabled(true); const live = h.p.beginStream(); live.append('，……。');
  const result = await live.finish(); assert.equal(result.reason, 'empty'); assert.equal(result.completed, false);
  assert.equal(h.events.length, 0); assert.equal(h.requests.filter(r => !r.url.endsWith('/config')).length, 0);
});
