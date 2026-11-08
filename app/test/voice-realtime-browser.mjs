// Real HTTP chunks and WebSockets, synthetic microphone/PCM, no provider or
// personal recordings. Run: node test/voice-realtime-browser.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'screenshots/realtime-voice'); fs.mkdirSync(output, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, timeout = 15000) { const end = Date.now() + timeout; while (!fn()) { if (Date.now() > end) throw Error('timeout: ' + label); await sleep(20); } }
const profile = { name: '演示王女士', callName: '王女士', gender: '女', birthYear: '1948', hometown: '演示扬州' };
const lines = ['我想聊小时候的家。', '院子里有一棵枣树。', '我还没说完，枣树是父亲种的。', '声音关了，我也可以继续聊。', '这段识别断开了，但录音仍然在。', '先停一下，我想一想。', '待会儿我们接着聊。'];
const replies = ['您小时候的家是什么样的？您慢慢说。', '那棵枣树是什么样的？这句迟到的补充不应该显示。', '父亲种下它时，您在旁边吗？', '好，您接着说。', '录音还在，您慢慢说。', '好，我们歇一会儿。', '好，下次接着聊。'];
const state = { requests: [], replays: [], tts: [], sessions: [], events: [], full: [], failNextASR: false, errors: [] };
const snapshot = { id: 'realtime-synthetic', responseId: 'opening', say: '王女士，这次打算往记忆银行里边存点什么？', phase: 'choose', ask: { nodeId: 'child-home', depth: 1 }, cards: [{ nodeId: 'child-home', text: '小时候的家' }], turns: [], transcript: [], fullSegments: [] };
const pcm = Buffer.alloc(24000 * 2 * 2);
for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 24000 * Math.PI * 2 * 440) * 1000), i * 2);
const fields = bytes => Object.fromEntries([...bytes.toString().matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)/g)].map(m => [m[1], m[2]]));
const api = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://fixture');
    const json = value => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (url.pathname === '/api/health') return json({ gemini: { hasKey: true, ok: true } });
    if (url.pathname === '/api/elders/synthetic-elder') return json({ id: 'synthetic-elder', profile, archive: {}, interviews: [], stories: [] });
    if (url.pathname === '/api/asr/config') return json({ enabled: true, sampleRate: 16000 });
    if (url.pathname === '/api/tts/config') return json({ enabled: true, stream: true });
    if (url.pathname === '/api/tts/stream') {
      state.tts.push({ text: url.searchParams.get('t'), at: Date.now() });
      res.writeHead(200, { 'content-type': 'audio/L16;rate=24000', 'cache-control': 'no-store' }); res.flushHeaders();
      await sleep(30); if (!res.destroyed) res.write(pcm.subarray(0, 4800));
      await sleep(40); if (!res.destroyed) res.end(pcm.subarray(4800)); return;
    }
    if (url.pathname === '/api/interviews' && req.method === 'POST') return json(snapshot);
    if (url.pathname === '/api/interviews/' + snapshot.id && req.method === 'GET') return json(snapshot);
    const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = Buffer.concat(chunks);
    if (url.pathname.endsWith('/events')) { state.events.push(JSON.parse(body)); return json({ accepted: true }); }
    if (url.pathname.endsWith('/full')) { state.full.push(fields(body)); return json({ accepted: true }); }
    if (url.pathname.endsWith('/choose') || url.pathname.endsWith('/turn')) {
      const input = fields(body), prior = state.requests.find(x => x.input.clientTurnId === input.clientTurnId);
      if (prior) {
        state.replays.push(input.clientTurnId);
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); res.flushHeaders();
        await until(() => prior.done, 'cached accepted response');
        if (!res.destroyed) res.end('data: ' + JSON.stringify({ type: 'result', result: prior.result, replayed: true }) + '\n\n'); return;
      }
      const number = state.requests.length + 1, responseId = 'reply-' + number;
      const entry = { number, input, responseId, route: url.pathname, bytes: body.length, acceptsSSE: req.headers.accept?.includes('text/event-stream'), at: Date.now(), done: false }; state.requests.push(entry);
      const raw = input.manual || lines[number - 1] || lines.at(-1), say = number === 8 ? '这是刷新前已经看到的一句。刷新后的迟到尾巴不应复活。' : replies[number - 1] || replies.at(-1);
      const transcript = { raw, clean: raw }, next = { phase: number === 2 ? 'choose' : 'chat', ask: { nodeId: 'child-home', depth: number + 1 }, say };
      const result = url.pathname.endsWith('/choose') ? { responseId, transcript, heard: raw, ...next } : { responseId, transcript, next, timing: { asr: 0, agent: 1500, total: 1500 } };
      const publish = value => { if (!res.destroyed) res.write('data: ' + JSON.stringify(value) + '\n\n'); };
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' }); res.flushHeaders();
      await sleep(40); publish({ type: 'transcript', transcript, responseId });
      const first = say.match(/^.*?[。！？]/)?.[0] || say, tail = say.slice(first.length);
      const draft1 = first.slice(0, 5), draft2 = first.slice(0, 9);
      await sleep(100); publish({ type: 'reply-draft', responseId, text: draft1, delta: draft1, ask: next.ask, phase: next.phase }); entry.firstDraftAt = Date.now();
      await sleep(250); publish({ type: 'reply-draft', responseId, text: draft2, delta: draft2.slice(draft1.length), ask: next.ask, phase: next.phase });
      await sleep(250); publish({ type: 'reply', responseId, text: first, delta: first, ask: next.ask, phase: next.phase }); entry.firstReplyAt = Date.now();
      await sleep(number === 2 ? 2200 : 1000);
      if (tail) { publish({ type: 'reply-draft', responseId, text: say, delta: tail, ask: next.ask, phase: next.phase }); publish({ type: 'reply', responseId, text: say, delta: tail, ask: next.ask, phase: next.phase }); }
      await sleep(400); Object.assign(snapshot, next, { responseId });
      const saved = { ...input, id: 'turn-' + number, raw, clean: raw, question: input.question, q: input.question };
      snapshot.turns.push(saved); snapshot.transcript.push(saved);
      entry.result = result; publish({ type: 'result', result }); entry.done = true; entry.doneAt = Date.now(); if (!res.destroyed) res.end(); return;
    }
    return json({});
  } catch (error) { state.errors.push(error.message); if (!res.headersSent) res.writeHead(500); if (!res.destroyed) res.end(); }
});
const sockets = new WebSocketServer({ server: api, path: '/api/asr/stream' });
sockets.on('connection', ws => {
  let session;
  const send = value => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); };
  ws.on('message', (bytes, binary) => {
    if (binary) {
      if (!session) return ws.close(1008, 'start required');
      session.bytes += bytes.length; let energy = 0;
      for (let i = 0; i + 1 < bytes.length; i += 2) energy += (bytes.readInt16LE(i) / 32768) ** 2;
      if (Math.sqrt(energy / Math.max(1, bytes.length / 2)) > .003) session.voicedBytes += bytes.length;
      if (!session.first && session.voicedBytes >= 16000 * 2 * .18) {
        session.first = true; session.firstAt = Date.now();
        if (session.fail) { send({ type: 'error', code: 'upstream-closed', utteranceId: session.utteranceId }); ws.close(1011, 'synthetic failure'); return; }
        send({ type: 'transcript', text: session.number === 1 ? '我想聊小时候。' : session.text.slice(0, 6), utteranceId: session.utteranceId, final: false });
      }
      if (!session.second && session.voicedBytes >= 16000 * 2 * .65) {
        session.second = true;
        // A ready handshake may flush several buffered audio frames together.
        // Keep the correction observable as a separate provider event, instead
        // of requiring Playwright to catch two frames in the same tick.
        setTimeout(() => send({ type: 'transcript', text: session.text, utteranceId: session.utteranceId, final: false }), Math.max(0, 350 - (Date.now() - session.firstAt)));
      }
      return;
    }
    const message = JSON.parse(bytes);
    if (message.type === 'start') {
      const number = state.sessions.length + 1;
      session = { number, utteranceId: message.utteranceId, sampleRate: message.sampleRate, text: lines[number - 1] || lines.at(-1), bytes: 0, voicedBytes: 0, fail: state.failNextASR, closed: false };
      state.failNextASR = false; state.sessions.push(session); send({ type: 'ready', sessionId: 'asr-' + number, utteranceId: session.utteranceId });
    } else if (message.type === 'finish' && session) {
      session.finished = true; send({ type: 'transcript', text: session.text, utteranceId: session.utteranceId, final: true });
      send({ type: 'done', text: session.text, sessionId: 'asr-' + session.number, utteranceId: session.utteranceId }); ws.close(1000);
    } else if (message.type === 'cancel') ws.close(1000);
  });
  ws.on('close', () => { if (session) session.closed = true; });
});
api.listen(0, '127.0.0.1'); await once(api, 'listening');
const target = `http://127.0.0.1:${api.address().port}`;
const vite = await createServer({ root, server: { port: 0, host: '127.0.0.1', hmr: false, proxy: { '/api': { target, ws: true } } }, logLevel: 'error' });
await vite.listen(); const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const browser = await chromium.launch({ ...(fs.existsSync(executablePath) ? { executablePath } : {}), args: ['--no-proxy-server', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
await context.addInitScript(({ profile }) => {
  localStorage.setItem('mb_elder', 'synthetic-elder'); localStorage.setItem('mb_profile', JSON.stringify(profile));
  window.__synthetic = { count: 0, streams: [], starts: [], ends: [], stops: [] };
  const originalStop = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.stop = function(...args) { window.__synthetic.stops.push(performance.now()); return originalStop.apply(this, args); };
  navigator.mediaDevices.getUserMedia = async () => {
    const audio = new AudioContext(), destination = audio.createMediaStreamDestination(), gain = audio.createGain();
    await audio.resume(); gain.gain.value = 0; gain.connect(destination);
    for (const [hz, volume] of [[180, 1], [540, .6], [1260, .35]]) { const oscillator = audio.createOscillator(), part = audio.createGain(); oscillator.frequency.value = hz; part.gain.value = volume; oscillator.connect(part); part.connect(gain); oscillator.start(); }
    window.__synthetic.gain = gain; window.__synthetic.count++; window.__synthetic.streams.push(destination.stream); return destination.stream;
  };
  window.__pulse = async (ms, level = .025) => { window.__synthetic.starts.push(performance.now()); window.__synthetic.gain.gain.value = level; await new Promise(r => setTimeout(r, ms)); window.__synthetic.gain.gain.value = 0; window.__synthetic.ends.push(performance.now()); };
}, { profile });
const page = await context.newPage(), pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
const pulse = async (ms = 1600) => page.evaluate(ms => window.__pulse(ms), ms);
const startPulse = async ms => page.evaluate(ms => { window.__pulseTask = window.__pulse(ms); }, ms);
const waitResponse = async number => { await until(() => state.requests[number - 1]?.done, 'response ' + number); await page.waitForFunction(() => !document.querySelector('#sendManual')?.disabled); };
try {
  await page.goto(base, { waitUntil: 'domcontentloaded' }); await page.locator('#start').click();
  await page.waitForFunction(() => document.querySelector('#mic')?.getAttribute('aria-pressed') === 'true');
  await page.locator('#voiceWave path').waitFor({ state: 'attached' });
  const quietWave = await page.locator('#voiceWave path').getAttribute('d');
  await page.evaluate(() => {
    window.__previewTexts = [];
    new MutationObserver(() => {
      const text = document.querySelector('.chat-message.user:last-of-type .message-text')?.textContent;
      if (text && window.__previewTexts.at(-1)?.text !== text) window.__previewTexts.push({ text, at: performance.now(), speechEnded: window.__synthetic.ends.length > 0 });
    }).observe(document.querySelector('#messages'), { subtree: true, childList: true, characterData: true });
  });
  await startPulse(1800);
  await page.waitForFunction(() => window.__previewTexts.some(x => x.text === '我想聊小时候。'));
  assert.equal(await page.evaluate(() => window.__previewTexts.find(x => x.text === '我想聊小时候。').speechEnded), false, 'real interim text must arrive before the user stops speaking');
  const liveId = await page.locator('.chat-message.user').last().getAttribute('data-message-id');
  const liveWave = await page.locator('#voiceWave path').getAttribute('d'); assert.notEqual(liveWave, quietWave, 'voice waveform must react to PCM');
  assert.ok(await page.locator('.message-wave path').count(), 'active user bubble must expose a waveform');
  await page.getByText(lines[0], { exact: true }).waitFor();
  assert.equal(await page.locator('.chat-message.user').count(), 1, 'ASR correction must update the same bubble');
  assert.equal(await page.locator('.chat-message.user').last().getAttribute('data-message-id'), liveId);
  await page.screenshot({ path: path.join(output, '01-live-asr-mobile.png'), fullPage: true });
  await page.evaluate(() => window.__pulseTask);
  await page.waitForFunction(() => document.querySelector('[data-message-id="assistant:reply-1"] .message-text')?.textContent === '您小时候的');
  assert.equal(state.requests[0].firstReplyAt, undefined, 'draft tokens must be visible before a complete stable sentence arrives');
  assert.ok(!state.tts.some(x => x.text.includes('您小时候的家是什么样')), 'partial draft text must not start an incomplete TTS sentence');
  await page.screenshot({ path: path.join(output, '00-live-reply-tokens-mobile.png'), fullPage: true });
  await page.waitForFunction(() => (window.__voiceMetrics || []).some(x => x.event === 'formal-first-audio' && x.responseId === 'reply-1'));
  assert.equal(state.requests[0].done, false, 'AI first audio must start before final HTTP result');
  await page.getByText('您小时候的家是什么样的？', { exact: true }).waitFor();
  assert.equal(state.requests[0].done, false, 'AI text must be visible before final HTTP result');
  await page.screenshot({ path: path.join(output, '02-streaming-reply-mobile.png'), fullPage: true });
  await waitResponse(1); assert.equal(await page.locator(`[data-message-id="${liveId}"] .message-text`).textContent(), lines[0]);

  await pulse();
  await page.waitForFunction(() => (window.__voiceMetrics || []).some(x => x.event === 'formal-first-audio' && x.responseId === 'reply-2'));
  const reply2 = page.locator('[data-message-id="assistant:reply-2"] .message-text');
  const beforeBarge = await reply2.textContent(), stops = await page.evaluate(() => window.__synthetic.stops.length);
  await startPulse(1700);
  await until(() => state.sessions.length >= 3, 'third live ASR session');
  await page.waitForFunction(n => window.__synthetic.stops.length > n, stops);
  await until(() => state.requests[1].done, 'stale reply completion');
  assert.equal(await reply2.textContent(), beforeBarge, 'late model deltas must not extend an interrupted reply');
  assert.ok(!state.tts.some(x => x.text.includes('这句迟到的补充')), 'late streamed sentence must never reach TTS');
  await page.evaluate(() => window.__pulseTask); await waitResponse(3);
  assert.equal(JSON.parse(state.requests[2].input.ask).depth, 3, 'barge-in must keep the metadata of the newly heard streamed question');
  assert.ok(state.requests[2].route.endsWith('/choose'), 'a streamed topic invitation must route its barge-in answer to choose');
  assert.equal(await page.locator('.chat-message.user').count(), 3);
  await page.screenshot({ path: path.join(output, '03-barge-in-mobile.png'), fullPage: true });

  await page.locator('#snd').click(); const ttsBeforeMute = state.tts.length;
  await pulse(); await waitResponse(4);
  assert.equal(await page.locator('#mic').getAttribute('aria-pressed'), 'true');
  assert.equal(state.tts.length, ttsBeforeMute, 'muting output must keep ASR and text streaming without new TTS');
  assert.equal(await page.locator('.chat-message.user').last().locator('.message-text').textContent(), lines[3]);

  state.failNextASR = true; await startPulse(1200);
  await page.waitForFunction(() => /实时|转写|识别/.test(document.querySelector('#live')?.textContent || '') && /暂|断|失败|保存|保留|恢复/.test(document.querySelector('#live')?.textContent || ''));
  await page.screenshot({ path: path.join(output, '04-asr-fallback-mobile.png'), fullPage: true });
  await page.evaluate(() => window.__pulseTask); await waitResponse(5);
  assert.ok(state.requests[4].bytes > 4000, 'ASR outage must retain and submit original audio');
  assert.equal(await page.locator('.chat-message.user').last().locator('.message-text').textContent(), lines[4], 'batch final transcript must repair the same bubble');

  await startPulse(1000); await until(() => state.sessions.length >= 6, 'pause ASR session'); await sleep(350);
  await page.locator('#mic').click();
  await page.waitForFunction(() => window.__synthetic.streams.every(s => s.getTracks().every(t => t.readyState === 'ended')));
  await until(() => state.sessions.every(s => s.closed), 'pause closes all ASR sockets');
  await page.evaluate(() => window.__pulseTask); await waitResponse(6);
  await page.locator('#mic').click(); await page.waitForFunction(() => document.querySelector('#mic').getAttribute('aria-pressed') === 'true');
  await startPulse(1300); await until(() => state.sessions.length >= 7, 'leave ASR session'); await sleep(400);
  await page.getByRole('link', { name: '返回', exact: true }).click(); await page.waitForURL('**/#/me');
  await page.waitForFunction(() => window.__synthetic.streams.every(s => s.getTracks().every(t => t.readyState === 'ended')));
  await until(() => state.sessions.every(s => s.closed), 'leave closes all ASR sockets');
  assert.equal(await page.evaluate(() => window.__synthetic.count), 2, 'all rounds share one mic until explicit pause/resume');
  assert.ok(state.requests.every(r => r.acceptsSSE), 'every accepted turn explicitly negotiates a real SSE stream');
  await until(() => state.requests[6]?.done, 'final leave request commits');
  await page.goto(base + '/#/interview', { waitUntil: 'domcontentloaded' }); await page.locator('#mic').waitFor();
  await page.locator('.manual-entry summary').click(); await page.locator('#manual').fill('我还想补充一句话。'); await page.locator('#sendManual').click();
  const reloadPrefix = '这是刷新前已经看到的一句。';
  await page.waitForFunction(text => document.querySelector('[data-message-id="assistant:reply-8"] .message-text')?.textContent === text, reloadPrefix);
  const cachedPreview = await page.evaluate(() => JSON.parse(localStorage.getItem('mb_reply_preview_realtime-synthetic')));
  assert.equal(cachedPreview.id, 'reply-8'); assert.equal(cachedPreview.text, reloadPrefix);
  assert.equal(state.requests[7].done, false, 'reload must happen before the accepted stream reaches its result');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-message-id="assistant:reply-8"] .message-text').waitFor();
  await until(() => state.replays.length > 0 && state.requests[7].done, 'same request replay after mid-stream reload');
  await page.waitForFunction(() => !document.querySelector('#sendManual')?.disabled);
  assert.equal(await page.locator('[data-message-id="assistant:reply-8"] .message-text').textContent(), reloadPrefix, 'cached final result must preserve the last visible prefix after reload');
  const ttsBeforeActualReloadResume = state.tts.length; await page.locator('#mic').click();
  await until(() => state.tts.length > ttsBeforeActualReloadResume, 'actual reload resumes the visible current reply');
  assert.ok(state.tts.slice(ttsBeforeActualReloadResume).every(x => x.text === reloadPrefix), 'actual reload must replay the visible current prefix, not an older reply or unseen suffix');
  await page.screenshot({ path: path.join(output, '06-mid-stream-reload-mobile.png'), fullPage: true });
  await page.locator('#mic').click();
  const prefix = '这是屏幕显示的前半句。', hiddenTail = '不可见的尾巴不能读出来。';
  Object.assign(snapshot, { responseId: 'resume-partial', phase: 'chat', say: prefix + hiddenTail, events: [{ type: 'playback-suppressed', responseId: 'resume-partial', displayed: true, question: prefix }] });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-message-id="assistant:resume-partial"] .message-text').waitFor();
  assert.equal(await page.locator('[data-message-id="assistant:resume-partial"] .message-text').textContent(), prefix);
  const ttsBeforeResume = state.tts.length;
  await page.locator('#mic').click(); await until(() => state.tts.length > ttsBeforeResume, 'resumed partial audio');
  await page.waitForFunction(() => (window.__voiceMetrics || []).some(x => x.event === 'formal-first-audio' && x.responseId === 'resume-partial'));
  const ttsBeforeReplay = state.tts.length; await page.locator('#replay').click();
  await until(() => state.tts.length > ttsBeforeReplay, 'replayed partial audio');
  assert.ok(state.tts.slice(ttsBeforeResume).every(x => x.text === prefix), 'resume/replay must never speak the hidden late suffix');
  await page.screenshot({ path: path.join(output, '05-resumed-partial-mobile.png'), fullPage: true });
  await page.locator('#mic').click();
  assert.deepEqual(pageErrors, []); assert.deepEqual(state.errors, []);
  const report = { pass: true, testedAt: new Date().toISOString(), environment: 'macOS headless Chromium, real HTTP chunked SSE and WebSocket servers, synthetic PCM microphone, simulated ASR/host/TTS; no real provider/elder recording', checks: { interimBeforeSpeechEnds: true, draftTextBeforeStableSentence: true, correctionsReuseBubble: true, firstAudioBeforeResult: true, lateReplySuppressed: true, mutedASRContinues: true, asrOutageKeepsAudio: true, pauseAndLeaveCloseSockets: true, waveformFollowsPCM: true, streamedQuestionMetadataAligned: true, streamedPhaseAligned: true, resumedPartialOnly: true, midStreamReloadPreservesVisiblePrefix: true }, pageErrors, serverErrors: state.errors, turns: state.requests.map(({input,result,...r})=>r), cachedRetries: state.replays.length, sessions: state.sessions, ttsRequests: state.tts.length };
  fs.writeFileSync(path.join(output, 'synthetic-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: true, turns: state.requests.length, sessions: state.sessions.length, checks: report.checks, report: path.join(output, 'synthetic-results.json') }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(()=>{});
  console.error(JSON.stringify({ error: error.message, previews: await page.evaluate(() => window.__previewTexts).catch(()=>null), pageErrors, serverErrors: state.errors, requests: state.requests.length, sessions: state.sessions }, null, 2)); throw error;
} finally {
  await browser.close(); sockets.clients.forEach(ws => ws.terminate()); await new Promise(resolve => sockets.close(resolve));
  api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); await vite.close();
}
