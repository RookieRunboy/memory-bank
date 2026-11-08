import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceActivityDetector, VOICE_DEFAULTS, encodeWav } from '../src/voice-vad.js';
import { VoiceCapture } from '../src/voice-capture.js';

const rate = 16000, frameMs = 20;
const silence = () => new Float32Array(rate * frameMs / 1000);
// Synthetic voiced harmonic: deterministic demonstration fixture, not human speech.
const voice = (at, gain = .035) => Float32Array.from({ length: rate * frameMs / 1000 }, (_, i) => {
  const t = (at / 1000) + i / rate;
  return gain * (Math.sin(t * Math.PI * 2 * 180) + .6 * Math.sin(t * Math.PI * 2 * 540) + .35 * Math.sin(t * Math.PI * 2 * 1260));
});
function harness(config = {}) {
  const starts = [], segments = [];
  let at = 0;
  const vad = new VoiceActivityDetector({ sampleRate: rate, config, onSpeechStart: e => starts.push(e), onSegment: e => segments.push(e) });
  return { vad, starts, segments, get at() { return at; }, feed(ms, kind = 'silence', options = {}) {
    for (let n = 0; n < ms; n += frameMs) {
      const pcm = kind === 'voice' ? voice(at, options.gain) : typeof kind === 'function' ? kind(at) : silence();
      vad.push(pcm, at, options); at += frameMs;
    }
  } };
}

test('自动分轮：保留首字前缓存和尾音，找词停顿不分轮', () => {
  const h = harness(); h.feed(600); h.feed(800, 'voice'); h.feed(1700); h.feed(500, 'voice');
  assert.equal(h.starts.length, 1); assert.equal(h.segments.length, 0);
  h.feed(VOICE_DEFAULTS.endpointMs + 40);
  assert.equal(h.segments.length, 1);
  const s = h.segments[0];
  assert.equal(s.continuation, false); assert.ok(s.startedAt <= 600 - 200);
  assert.ok(s.endedAt >= 3600); assert.ok(s.durMs < 3900);
  assert.equal(s.endpointMs, VOICE_DEFAULTS.endpointMs);
  assert.equal(s.pcm.length, Math.round(s.durMs * rate / 1000));
});

test('持续静音、单次敲击及宽带噪声不提交', () => {
  const h = harness(); h.feed(10000); h.feed(20, at => voice(at, .8)); h.feed(4000);
  let seed = 7;
  h.feed(6000, () => Float32Array.from({ length: 320 }, () => { seed = (seed * 16807) % 2147483647; return ((seed / 2147483647) - .5) * .04; }));
  h.feed(4000); assert.equal(h.starts.length, 0); assert.equal(h.segments.length, 0);
});

test('播放中轻声插话仍确认，首字保留且本地确认不超过 300 ms', () => {
  const h = harness(); h.feed(600);
  h.feed(500, 'voice', { playing: true, echoCancellation: true, gain: .007 });
  assert.equal(h.starts.length, 1);
  assert.ok(h.starts[0].confirmedAt - h.starts[0].speechAt <= 300);
  h.feed(2400); assert.equal(h.segments.length, 1);
  assert.ok(h.segments[0].startedAt < 600);
});

test('短人声不提交；暂停提交有效尾段；恢复无跨暂停缓存', () => {
  const h = harness(); h.feed(160, 'voice'); h.feed(2400); assert.equal(h.segments.length, 0);
  h.feed(600, 'voice'); h.vad.flush({ boundary: 'pause', at: h.at });
  assert.equal(h.segments.length, 1); assert.equal(h.segments[0].boundary, 'pause');
  assert.equal(h.vad.speaking, false); assert.equal(h.vad.bufferedMs, 0);
  h.feed(600); h.feed(500, 'voice'); h.feed(2400); assert.equal(h.segments.length, 2);
});

test('长叙述缓冲有界，分块连续且最后一块结束该轮', () => {
  const h = harness({ maxSegmentMs: 1000 }); h.feed(3400, 'voice');
  assert.equal(h.segments.length, 3); assert.ok(h.segments.every(s => s.continuation));
  assert.ok(h.vad.bufferedMs <= 1000);
  h.feed(2400); assert.equal(h.segments.at(-1).continuation, false);
  const samples = h.segments.reduce((n, s) => n + s.pcm.length, 0);
  assert.equal(samples, (3400 + VOICE_DEFAULTS.tailMs) * rate / 1000);
});

test('长段恰好切在结尾：静音只发送 finalizeContinuation，不新增静音转写', () => {
  const h = harness({maxSegmentMs:1000}); h.feed(1000,'voice'); assert.equal(h.segments.length,1);
  h.feed(2400); assert.equal(h.segments.length,2);
  assert.equal(h.segments[0].continuation,true);
  assert.equal(h.segments[1].finalizeContinuation,true); assert.equal(h.segments[1].continuation,false);
  assert.equal(h.segments[1].pcm.length,0); assert.equal(h.segments[1].durMs,0);
});

test('长段切块后立即暂停，无采样的终止标记仍能结束已归档讲述', () => {
  const h = harness({maxSegmentMs:1000}); h.feed(1000,'voice'); h.vad.flush({boundary:'pause',at:h.at});
  assert.equal(h.segments.length,2); assert.equal(h.segments[1].finalizeContinuation,true);
  assert.equal(h.segments[1].boundary,'pause'); assert.equal(h.segments[1].pcm.length,0);
});

test('每个 WAV 独立含 RIFF/fmt/data，采样率和长度一致', () => {
  const wav = encodeWav(Float32Array.of(-1, -.5, 0, .5, 1), rate), dv = new DataView(wav.buffer);
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), 'RIFF');
  assert.equal(new TextDecoder().decode(wav.slice(8, 12)), 'WAVE');
  assert.equal(new TextDecoder().decode(wav.slice(36, 40)), 'data');
  assert.equal(dv.getUint32(24, true), rate); assert.equal(dv.getUint32(40, true), 10);
  assert.equal(dv.getInt16(44, true), -32768); assert.equal(dv.getInt16(52, true), 32767);
});

function fakeEnvironment() {
  const streams = [], nodes = [], contexts = [];
  let now = 0;
  const mediaDevices = { async getUserMedia(constraints) {
    const track = { stopped: false, readyState: 'live', onended: null, stop() { this.stopped = true; this.readyState = 'ended'; }, getSettings: () => ({ echoCancellation: true }) };
    const stream = { constraints, track, getTracks: () => [track], getAudioTracks: () => [track] }; streams.push(stream); return stream;
  } };
  class AudioContext {
    constructor() { this.sampleRate = rate; this.state = 'running'; this.destination = {}; this.audioWorklet = { addModule: async () => {} }; contexts.push(this); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    async resume() {} async close() { this.state = 'closed'; }
  }
  class AudioWorkletNode {
    constructor() { this.port = { onmessage: null, postMessage(message) { if (message === 'flush') queueMicrotask(() => this.onmessage?.({ data: { flushed: true } })); }, close() {} }; nodes.push(this); }
    connect() {} disconnect() {}
  }
  return { streams, nodes, contexts, env: { mediaDevices, AudioContext, AudioWorkletNode, now: () => now }, feed(ms, kind) {
    for (let n = 0; n < ms; n += 20) { nodes.at(-1).port.onmessage?.({ data: { pcm: kind === 'voice' ? voice(now) : silence() } }); now += 20; }
  } };
}

test('会话共用一条流：整场分块、暂停立即停轨、恢复重新取流，dispose 幂等', async () => {
  const f = fakeEnvironment(), full = [], segments = [], errors = [];
  const cap = new VoiceCapture({ env: f.env, config: { maxFullMs: 1000 }, onSegment: s => segments.push(s), onFullSegment: s => full.push(s), onError: e => errors.push(e) });
  await cap.start(); await cap.start(); assert.equal(f.streams.length, 1);
  assert.equal(f.streams[0].constraints.audio.echoCancellation, true);
  f.feed(1200, 'voice'); const pausing = cap.pause();
  assert.equal(f.streams[0].track.stopped, true); await pausing;
  assert.equal(full.length, 2); assert.equal(full[1].boundary, 'pause');
  assert.equal(segments.length, 1); assert.equal(segments[0].blob.type, 'audio/wav');
  await cap.start(); f.feed(600, 'voice'); await cap.dispose(); await cap.dispose();
  assert.equal(f.streams.length, 2); assert.equal(full.length, 3);
  assert.deepEqual(full.map(s => s.sequence), [0, 1, 2]);
  assert.ok(f.streams.every(s => s.track.stopped)); assert.ok(f.contexts.every(c => c.state === 'closed')); assert.equal(errors.length, 0);
});

test('授权迟到时已离页：关闭新得到的音轨，不能复活采集', async () => {
  const f = fakeEnvironment(); let resolve;
  const original = f.env.mediaDevices.getUserMedia;
  f.env.mediaDevices.getUserMedia = () => new Promise(r => { resolve = async () => r(await original({ audio: {} })); });
  const cap = new VoiceCapture({ env: f.env }); const pending = cap.start(); await cap.dispose(); await resolve(); await pending;
  assert.equal(cap.active, false); assert.equal(f.streams[0].track.stopped, true);
});

test('设备断开会刷尾段、释放资源并报告，不能自行恢复', async () => {
  const f = fakeEnvironment(), errors = [], segments = [];
  const cap = new VoiceCapture({ env: f.env, onError: e => errors.push(e), onSegment: s => segments.push(s) });
  await cap.start(); f.feed(600, 'voice'); f.streams[0].track.onended();
  await cap.pausing;
  assert.equal(cap.active, false); assert.equal(segments.length, 1); assert.equal(errors.length, 1);
});

test('暂停在停止音轨后仍接住工作线程队列中的尾帧，恢复等待清理完成', async () => {
  const f = fakeEnvironment(), segments = [], full = [];
  const cap = new VoiceCapture({ env: f.env, onSegment: s => segments.push(s), onFullSegment: s => full.push(s) });
  await cap.start(); f.feed(600, 'voice');
  f.nodes[0].port.postMessage = function(message) { if (message === 'flush') queueMicrotask(() => {
    this.onmessage?.({ data: { pcm: voice(600).slice(0, 160) } }); this.onmessage?.({ data: { flushed: true } });
  }); };
  const pause = cap.pause(); assert.equal(f.streams[0].track.stopped, true);
  const resume = cap.start(); await pause; await resume;
  assert.equal(full[0].durMs, 610); assert.equal(segments[0].durMs, 610);
  assert.equal(f.streams.length, 2); assert.equal(cap.active, true); await cap.dispose();
});

test('被过滤的短人声也发出 listening 状态，解除访谈的讲话锁', async () => {
  const f = fakeEnvironment(), states = [], segments = [];
  const cap = new VoiceCapture({ env: f.env, onState: s => states.push(s), onSegment: s => segments.push(s) });
  await cap.start(); f.feed(180, 'voice'); f.feed(2400);
  assert.equal(segments.length, 0); assert.equal(cap.speaking, false);
  assert.equal(states.filter(s => s === 'listening').length, 2);
  await cap.dispose();
});

test('短人声中暂停：清理后状态回调能观察到 speaking=false', async () => {
  const f = fakeEnvironment(), observed = [];
  const cap = new VoiceCapture({ env: f.env, onState: state => observed.push({state, speaking: cap.speaking}) });
  await cap.start(); f.feed(180, 'voice'); assert.equal(cap.speaking, true); await cap.pause();
  assert.deepEqual(observed.at(-1), {state:'paused', speaking:false}); await cap.dispose();
});

test('音量反馈跟随同一条 PCM 的真实强弱，静音归零且不改变录音', async () => {
  const f = fakeEnvironment(), levels = [], full = [];
  const cap = new VoiceCapture({ env: f.env, onLevel: level => levels.push(level), onFullSegment: s => full.push(s) });
  await cap.start(); f.feed(200);
  assert.ok(levels.length > 0); assert.ok(levels.every(level => level === 0));
  for (let at = 200; at < 600; at += 20) cap.accept(voice(at, .007));
  const quiet = levels.at(-1);
  for (let at = 600; at < 1000; at += 20) cap.accept(voice(at, .07));
  const loud = levels.at(-1);
  assert.ok(quiet > 0 && loud > quiet, 'louder samples must produce a larger level');
  assert.ok(levels.every(level => Number.isFinite(level) && level >= 0 && level <= 1));
  f.feed(1000); assert.equal(levels.at(-1), 0);
  await cap.pause();
  assert.equal(f.streams.length, 1, 'metering must reuse the capture stream');
  assert.equal(full.length, 1); assert.equal(full[0].durMs, 2000);
  const wav = new DataView(await full[0].blob.arrayBuffer());
  assert.equal(wav.getUint32(40, true), rate * 2 * 2, 'metering must retain every archival sample');
});

test('暂停立即清零音量，刷尾帧期间不回弹；恢复、设备断开与销毁也保持边界', async () => {
  const f = fakeEnvironment(), levels = [];
  const cap = new VoiceCapture({ env: f.env, onLevel: level => levels.push(level) });
  await cap.start(); f.feed(600, 'voice'); assert.ok(levels.at(-1) > 0);
  f.nodes[0].port.postMessage = function(message) { if (message === 'flush') queueMicrotask(() => {
    this.onmessage?.({ data: { pcm: voice(600) } }); this.onmessage?.({ data: { flushed: true } });
  }); };
  const beforePause = levels.length, pending = cap.pause();
  assert.equal(levels.at(-1), 0, 'clearing must be synchronous with stopping the tracks');
  await pending; assert.ok(levels.slice(beforePause).every(level => level === 0));
  await cap.start(); f.feed(100); assert.equal(levels.at(-1), 0);
  f.feed(600, 'voice'); assert.ok(levels.at(-1) > 0);
  f.streams.at(-1).track.onended(); assert.equal(levels.at(-1), 0); await cap.pausing;
  await cap.start(); f.feed(600, 'voice'); assert.ok(levels.at(-1) > 0);
  const disposed = cap.dispose(); assert.equal(levels.at(-1), 0); await disposed;
});

test('实时 ASR 复用收音：静音不推送，确认前缓存完整且首帧不重复', async () => {
  const f=fakeEnvironment(), audio=[], starts=[], segments=[], order=[];
  const cap=new VoiceCapture({env:f.env,onSpeechStart:info=>{starts.push(info);order.push('start');},
    onSpeechAudio:(pcm,sampleRate)=>{audio.push(new Float32Array(pcm));assert.equal(sampleRate,rate);order.push('audio');},onSegment:s=>segments.push(s)});
  await cap.start();f.feed(600);assert.equal(audio.length,0);
  f.feed(800,'voice');f.feed(2200);
  assert.equal(starts.length,1);assert.equal(segments.length,1);assert.deepEqual(order.slice(0,2),['start','audio']);
  const samples=audio.reduce((n,x)=>n+x.length,0), joined=new Float32Array(samples);let offset=0;for(const x of audio){joined.set(x,offset);offset+=x.length;}
  // The final endpoint frame is silence; the stream contains every frame from
  // the archival pre-roll through the preceding frame, exactly once.
  const firstAt=segments[0].startedAt;
  assert.equal(samples,Math.round((3600-frameMs-firstAt)*rate/1000));
  assert.equal(firstAt,200,'the 400ms before speech must be retained');
  const archived=new Uint8Array(await segments[0].blob.arrayBuffer());
  const streamedPrefix=encodeWav(joined.subarray(0,(archived.length-44)/2),rate);
  assert.deepEqual(streamedPrefix,archived,'streaming must preserve the same original prefix and tail samples');
  const count=audio.length;f.feed(2000);assert.equal(audio.length,count,'idle silence must not reach ASR');
  assert.equal(f.streams.length,1);await cap.dispose();
});

test('实时 ASR 在长语音分块和任意 PCM 分包下连续，暂停尾帧只发送一次', async () => {
  const f=fakeEnvironment(),audio=[],segments=[];
  const cap=new VoiceCapture({env:f.env,config:{maxSegmentMs:1000},onSpeechAudio:pcm=>audio.push(new Float32Array(pcm)),onSegment:s=>segments.push(s)});
  await cap.start();
  const source=Float32Array.from({length:rate*2+137},(_,i)=>.035*(Math.sin(i/rate*Math.PI*2*180)+.6*Math.sin(i/rate*Math.PI*2*540)+.35*Math.sin(i/rate*Math.PI*2*1260)));
  let seed=9;
  for(let i=0;i<source.length;){seed=(seed*16807)%2147483647;const count=1+seed%821;cap.accept(source.subarray(i,i+count));i+=count;}
  await cap.pause();
  const joined=new Float32Array(audio.reduce((n,x)=>n+x.length,0));let at=0;for(const x of audio){joined.set(x,at);at+=x.length;}
  assert.deepEqual(joined,source,'pre-roll, continuation boundaries and drained partial frames must not drop or repeat samples');
  assert.ok(segments.some(s=>s.continuation));assert.equal(segments.at(-1).continuation,false);
  const sent=audio.length;await cap.dispose();assert.equal(audio.length,sent);
});
