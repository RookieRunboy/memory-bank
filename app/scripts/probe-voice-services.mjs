// Live, synthetic-only latency probe. Uses an isolated database, never the
// developer's saved interviews. Technical timings only; no transcript logging.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { splitSentences, firstShort } from '../src/split.js';
import { speakable } from '../src/planner.js';
import { readWav } from '../server/interview-session.mjs';
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const audioFile = process.argv[2];
if (!audioFile) throw new Error('Usage: node scripts/probe-voice-services.mjs SYNTHETIC.wav [samples=3] [output.json]');
const samples = Math.min(3, Math.max(1, +process.argv[3] || 3));
const output = process.argv[4] || path.join(os.tmpdir(), 'memory-bank-service-metrics.json');
const audio = fs.readFileSync(audioFile), wav = readWav(audio);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-service-probe-'));
const child = spawn(process.execPath, ['server/index.mjs'], { cwd: appDir,
  env: { ...process.env, DATA_DIR: dataDir, PORT: '0', HOST: '127.0.0.1', GEMINI_TTS_WARM: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
const report = { measuredAt: new Date().toISOString(), environment: `${process.platform}/${process.arch}, ${process.version}`, input: 'synthetic Chinese WAV', sampleRate: wav.sampleRate, endpointMs: 2200, audioDevice: 'not measured', cache: 'empty isolated TTS cache', samples: [] };
let origin;
const request = async (url, body) => {
  const r = await fetch(origin + '/api' + url, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body), headers: body instanceof FormData ? {} : { 'content-type': 'application/json' }, signal: AbortSignal.timeout(90000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json();
};
try {
  origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server startup timeout')), 15000);
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('server exited')); });
    child.stdout.on('data', b => { const m = String(b).match(/memory-bank on 127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(timer); resolve('http://127.0.0.1:' + m[1]); } });
    child.stderr.on('data', () => {});
  });
  const elder = await request('/elders', { profile: { name: '合成测试', gender: '女', callName: '测试女士', birthYear: '1948', hometown: '扬州', people: '' } });
  const interview = await request('/interviews', { elderId: elder.id });
  let current = await request(`/interviews/${interview.id}/choose`, { action: 'pick', index: 0, clientTurnId: 'probe-choice' });
  for (let i = 0; i < samples; i++) {
    const fd = new FormData(); fd.append('audio', new Blob([audio], { type: 'audio/wav' }), 'synthetic.wav');
    fd.append('clientTurnId', 'probe-turn-' + i); fd.append('durMs', wav.durationMs);
    fd.append('question', current.next?.say || current.say || ''); fd.append('questionId', current.responseId || ''); fd.append('ask', JSON.stringify(current.next?.ask || current.ask));
    const began = performance.now(); let turn;
    try { turn = await request(`/interviews/${interview.id}/turn`, fd); }
    catch (error) { const row = { sample: i + 1, backendFailure: /^HTTP \d+$/.test(error.message) ? error.message : 'network-error', backendRoundTripMs: Math.round(performance.now() - began), endToFirstNetworkMs: null }; report.samples.push(row); console.log(JSON.stringify(row)); continue; }
    const backendRoundTripMs = Math.round(performance.now() - began);
    const row = { sample: i + 1, ignored: !!turn.ignored, backendRoundTripMs, backendTiming: turn.timing || null, hostSource: turn.next?.source, asrSource: turn.transcript?.source, transcriptChars: (turn.transcript?.clean || '').length };
    const sentence = firstShort(splitSentences(speakable(turn.next?.say || '')))[0];
    if (sentence) {
      const ttsAt = performance.now(), ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 11000);
      try {
        const r = await fetch(origin + '/api/tts/stream?t=' + encodeURIComponent(sentence), { signal: ctl.signal });
        row.ttsHttpStatus = r.status; row.ttsCached = r.headers.get('x-tts-cached') === '1';
        if (!r.ok) row.ttsFailure = 'service-timeout-or-error';
        else { const reader = r.body.getReader(), first = await reader.read(); if (!first.done && first.value?.length) {
          row.ttsFirstNetworkMs = Math.round(performance.now() - ttsAt); row.endToFirstNetworkMs = report.endpointMs + backendRoundTripMs + row.ttsFirstNetworkMs;
        } else row.ttsFailure = 'empty-stream'; await reader.cancel(); }
      } catch { row.ttsFailure = 'network-timeout-or-error'; }
      finally { row.ttsElapsedMs = Math.round(performance.now() - ttsAt); ctl.abort(); clearTimeout(timer); }
    }
    report.samples.push(row); console.log(JSON.stringify(row)); current = turn;
  }
} finally {
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  child.kill('SIGTERM'); await Promise.race([once(child, 'exit').catch(() => {}), new Promise(r => setTimeout(r, 1000))]);
  console.log(JSON.stringify({ output, sampleCount: report.samples.length, dataDir, note: 'TTS first network bytes; acoustic output and microphone endpoint not measured' }));
}
