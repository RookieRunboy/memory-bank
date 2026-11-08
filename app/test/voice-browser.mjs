// Standalone synthetic browser exercise. No real microphone, provider, or elder
// data is used. Run from app/: node test/voice-browser.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { encodeWav } from '../src/voice-vad.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'screenshots/interview-chat'); fs.mkdirSync(output, { recursive: true });
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const vite = await createServer({ root, server: { port: 5174, host: '127.0.0.1', hmr: false }, logLevel: 'error' });
await vite.listen();
const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
const browser = await chromium.launch({ ...(fs.existsSync(executablePath) ? { executablePath } : {}), args: ['--no-proxy-server', '--autoplay-policy=no-user-gesture-required'] });
const profile = { name: '演示王女士', callName: '王女士', gender: '女', birthYear: '1948', hometown: '演示扬州' };
const transcripts = ['我想聊小时候的家。', '小时候我们一家住在一间平房里。', '屋里有个煤炉，冬天母亲总是早早起来生火。', '我每天早上帮她拿柴火。', '对了，柴火就堆在门外头。', '父亲还做过一把小板凳给我。', '这张板凳后来一直放在厨房里。'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pcm = Buffer.alloc(24000 * 2 * 2); for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 24000 * 440 * Math.PI * 2) * 1000), i * 2);
const clip = Buffer.from(encodeWav(Float32Array.from({ length: 16000 }, (_, i) => .03 * Math.sin(i * .07)), 16000));
const errors = [], results = [];
const selected = process.env.VOICE_BROWSER_SCENARIOS?.split(',');
const run = name => !selected || selected.includes(name);

async function fixture(name, mobile = false, denied = false) {
  const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1200, height: 900 } });
  await ctx.addInitScript(({ profile, denied }) => {
    localStorage.setItem('mb_elder', 'synthetic-elder'); localStorage.setItem('mb_profile', JSON.stringify(profile));
    window.__synthetic = { count: 0, streams: [], contexts: [], starts: [], ends: [], stops: [] };
    const originalStop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop = function(...args) { window.__synthetic.stops.push(performance.now()); return originalStop.apply(this, args); };
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (denied) throw new DOMException('Synthetic permission denial', 'NotAllowedError');
      const audio = new AudioContext(), destination = audio.createMediaStreamDestination(), gain = audio.createGain();
      await audio.resume(); gain.gain.value = 0; gain.connect(destination);
      for (const [hz, amplitude] of [[180, 1], [540, .6], [1260, .35]]) { const oscillator = audio.createOscillator(), part = audio.createGain(); oscillator.frequency.value = hz; part.gain.value = amplitude; oscillator.connect(part); part.connect(gain); oscillator.start(); }
      Object.assign(window.__synthetic, { gain, constraints, destination, audio }); window.__synthetic.count++;
      window.__synthetic.streams.push(destination.stream); window.__synthetic.contexts.push(audio); return destination.stream;
    };
    window.__pulse = async (ms, level = .025) => { window.__synthetic.starts.push(performance.now()); window.__synthetic.gain.gain.value = level; await new Promise(r => setTimeout(r, ms)); window.__synthetic.gain.gain.value = 0; window.__synthetic.ends.push(performance.now()); };
    window.__noise = async ms => { const {audio, destination} = window.__synthetic, buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * ms / 1000), audio.sampleRate), channel = buffer.getChannelData(0); let seed = 9;
      for (let i = 0; i < channel.length; i++) { seed = (seed * 16807) % 2147483647; channel[i] = (seed / 2147483647 - .5) * .04; }
      const noise = audio.createBufferSource(); noise.buffer = buffer; noise.connect(destination); noise.start(); await new Promise(r => noise.onended = r); noise.disconnect(); };
  }, { profile, denied });
  const state = { name, chooses: [], turns: [], turnAttempts: [], events: [], full: [], fullAttempts: [], finishes: 0, tts: 0, delay: 0,
    turnResults: new Map(), turnPending: new Map(), fullResults: new Set(), failTurnAfterAccept: 0, failFull: 0, failRecoveryGet: 0, creates: 0 };
  state.snapshot = { id: 'synthetic-' + name, responseId: 'opening', say: '王女士，这次打算往记忆银行里边存点什么？', phase: 'choose', ask: { nodeId: 'child-home', depth: 1 }, cards: [{ nodeId: 'child-home', text: '小时候的家' }, { nodeId: 'child-festival', text: '过年的事' }], turns: [], fullSegments: [] };
  await ctx.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (!url.href.startsWith(base)) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const json = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    const fields = () => { const body = req.postDataBuffer()?.toString() || ''; return Object.fromEntries([...body.matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)/g)].map(m => [m[1], m[2]])); };
    if (url.pathname === '/api/health') return json({ gemini: { hasKey: true, ok: true } });
    if (url.pathname === '/api/elders/synthetic-elder') return json({ id: 'synthetic-elder', profile, archive: {}, interviews: [], stories: [] });
    if (url.pathname === '/api/tts/config') return json({ enabled: true, stream: true });
    if (url.pathname.startsWith('/api/tts/stream')) { state.tts++; await sleep(40); return route.fulfill({ contentType: 'audio/L16;rate=24000', body: pcm }); }
    if (url.pathname.startsWith('/api/audio/')) return route.fulfill({ contentType: 'audio/wav', body: clip });
    if (url.pathname === '/api/interviews') { state.creates++; return json(state.snapshot); }
    if (url.pathname === '/api/interviews/' + state.snapshot.id && req.method() === 'GET') {
      if(state.failRecoveryGet>0){state.failRecoveryGet--;return route.fulfill({status:503,contentType:'application/json',body:'{}'});}return json(state.snapshot);
    }
    if (url.pathname.endsWith('/events')) { state.events.push(JSON.parse(req.postData())); return json({ accepted: true }); }
    if (url.pathname.endsWith('/full')) {
      const record = fields(); state.fullAttempts.push(record);
      if (state.failFull > 0) { state.failFull--; return route.abort('connectionfailed'); }
      if (!state.fullResults.has(record.clientTurnId)) { state.fullResults.add(record.clientTurnId); state.full.push(record); state.snapshot.fullSegments.push({ ...record, sequence: Number(record.sequence) }); }
      return json({ accepted: true });
    }
    if (url.pathname.endsWith('/choose')) { state.chooses.push(fields());
      const response = { responseId: 'choice-reply', heard: state.chooses.at(-1).action ? null : state.chooses.at(-1).manual || transcripts[0], phase: 'chat', ask: { nodeId: 'child-home', depth: 1 }, say: '您还记得小时候家里是什么样的吗？' };
      Object.assign(state.snapshot, response); return json(response);
    }
    if (url.pathname.endsWith('/turn')) {
      const record = fields(); state.turnAttempts.push(record);
      if (state.turnResults.has(record.clientTurnId)) return json(state.turnResults.get(record.clientTurnId));
      if (state.turnPending.has(record.clientTurnId)) return json(await state.turnPending.get(record.clientTurnId));
      let settle; state.turnPending.set(record.clientTurnId,new Promise(resolve=>{settle=resolve;}));
      state.turns.push(record); const number = state.turns.length;
      const delay = state.delay, transcript = state.nextTranscript || { raw: record.manual || transcripts[number] || transcripts.at(-1), clean: record.manual || transcripts[number] || transcripts.at(-1) }, say = state.nextSay || '那天您还记得谁在家里吗？';
      state.delay = 0; state.nextTranscript = null; state.nextSay = null; await sleep(delay || 80);
      const response = { responseId: 'reply-' + number, transcript, timing: { total: delay || 80, agent: delay || 80, asr: 0 }, next: { phase: 'chat', ask: { nodeId: 'child-home', depth: 2 }, say, done: false } };
      state.turnResults.set(record.clientTurnId, response); Object.assign(state.snapshot, response.next, {responseId: response.responseId}); state.snapshot.turns.push({...record, ...response.transcript});
      settle(response); state.turnPending.delete(record.clientTurnId);
      if (state.failTurnAfterAccept > 0) { state.failTurnAfterAccept--; return route.abort('connectionfailed'); }
      return json(response);
    }
    if (url.pathname.endsWith('/finish')) { state.finishes++; return json({ storyId: 'synthetic-story' }); }
    if (url.pathname === '/api/stories/synthetic-story') return json({ id: 'synthetic-story', created: Date.now(), elder: profile, title: '母亲生起的煤炉', body: transcripts.slice(1).join(''), paras: [{ text: transcripts[1], refs: ['turn-1'] }], fullAudio: 'full.wav', transcript: state.turns.map((x, i) => ({ id: 'turn-' + (i + 1), question: x.question, raw: transcripts[i + 1], clean: transcripts[i + 1], audio: `turn-${i}.wav` })) });
    return json({});
  });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(name + ': ' + e.message));
  await page.goto(base, { waitUntil: 'domcontentloaded' }); await page.locator('#start').click();
  if (denied) await page.waitForFunction(() => document.querySelector('#live')?.textContent.includes('没能打开麦克风'));
  else await page.waitForFunction(() => document.querySelector('#mic')?.getAttribute('aria-pressed') === 'true');
  return { ctx, page, state };
}
async function until(fn, label, timeout = 10000) { const end = Date.now() + timeout; while (!fn()) { if (Date.now() > end) throw new Error('timeout: ' + label); await sleep(30); } }
async function pulse(page, ms = 700, level = .025) { await page.evaluate(([ms, level]) => window.__pulse(ms, level), [ms, level]); }
async function hasAudio(page) { await page.waitForFunction(() => (window.__voiceMetrics || []).filter(x => x.event === 'formal-first-audio').length > 0); }

try {
  if (run('voice')) {
  const f = await fixture('voice'); const { page, state } = f;
  await hasAudio(page); await page.screenshot({ path: path.join(output, '01-listening-desktop.png'), fullPage: true });
  // Opening interruption + speech topic selection, with the microphone clicked
  // once by the existing home entry. No per-turn clicks follow.
  await pulse(page); await until(() => state.chooses.length === 1, 'voice topic selection');
  await page.waitForFunction(() => !document.querySelector('.cards'));
  assert.equal(await page.evaluate(() => window.__synthetic.count), 1);
  await pulse(page); await until(() => state.turns.length === 1, 'normal answer'); await sleep(150);
  // 1.4 s word-search pause must remain inside the same turn.
  await pulse(page, 450); await sleep(1400); assert.equal(state.turns.length, 1); await pulse(page, 600);
  await until(() => state.turns.length === 2, 'word-search answer'); await sleep(150);
  // Continue while an accepted turn is still generating. Its stale reply must
  // be suppressed, and the supplement must retain the actually heard question.
  state.delay = 1700; await pulse(page); await until(() => state.turns.length === 3, 'delayed answer');
  await pulse(page, 650); await until(() => state.turns.length === 4, 'busy supplement'); await sleep(150);
  assert.equal(state.turns[2].questionId, state.turns[3].questionId);
  await pulse(page, 600, .007); await until(() => state.turns.length === 5, 'quiet synthetic barge'); await sleep(200);
  await page.screenshot({ path: path.join(output, '02-five-turns-desktop.png'), fullPage: true });
  assert.equal(await page.evaluate(() => window.__synthetic.count), 1, 'rendering must retain the same microphone stream');
  assert.ok(state.events.some(x => x.type === 'playback-interrupted'), 'opening/formal playback must be interruptible');
  assert.ok(state.events.some(x => x.type === 'playback-suppressed' && x.responseId === 'reply-3'), 'old in-flight reply must not play');
  await sleep(2400); await page.evaluate(() => window.__noise(700)); await sleep(2400);
  assert.equal(state.turns.length, 5, 'silence and deterministic broadband noise must not submit a turn');
  // Pause/resume explicitly creates a new stream and retains full audio boundary.
  await page.locator('#mic').click(); await page.waitForFunction(() => window.__synthetic.streams.every(s => s.getTracks().every(t => t.readyState === 'ended')));
  await until(() => state.full.some(x => x.boundary === 'pause'), 'pause archive');
  await page.locator('#mic').click(); await page.waitForFunction(() => window.__synthetic.count === 2 && document.querySelector('#mic').getAttribute('aria-pressed') === 'true');
  // End immediately after speaking, before endpoint timer; valid tail is saved.
  await pulse(page, 600); await page.locator('#end').evaluate(button => { button.click(); button.click(); });
  await page.waitForURL('**/#/story/synthetic-story'); assert.equal(state.finishes, 1); assert.equal(state.turns.length, 6);
  assert.equal(await page.evaluate(() => window.__synthetic.streams.every(s => s.getTracks().every(t => t.readyState === 'ended'))), true);
  await page.locator('.play').click(); await page.screenshot({ path: path.join(output, '03-story-desktop.png'), fullPage: true });
  const metrics = await page.evaluate(() => ({ metrics: window.__voiceMetrics, source: { starts: window.__synthetic.starts, ends: window.__synthetic.ends, stops: window.__synthetic.stops }, audioCount: document.querySelectorAll('audio').length }));
  const firstStart = metrics.source.starts[0], stop = metrics.source.stops.find(t => t >= firstStart);
  const formalInputTimings=metrics.metrics.filter(x=>x.event==='formal-first-audio'&&x.kind==='formal'&&x.endToFirstMs!=null).map(x=>({responseId:x.responseId,actualInputEndToScheduledAudioMs:x.at+(x.playbackLeadMs||0)-metrics.source.ends.findLast(t=>t<=x.at)}));
  results.push({ scenario: 'five-plus-tail', turns: state.turns.length, choose: state.chooses.length, micOpens: 2, finishCalls: state.finishes, fullSegments: state.full.length, bargeToStopMs: stop - firstStart, formalInputTimings, ...metrics });
  await f.ctx.close();
  }

  if (run('card')) {
  const c = await fixture('card', true);
  assert.equal(await c.page.locator('.chat-message.assistant .message-text').textContent(), '王女士，这次打算往记忆银行里边存点什么？');
  await c.page.screenshot({ path: path.join(output, '00-bank-opening-mobile.png'), fullPage: true });
  await c.page.locator('.tcard').first().click(); await until(() => c.state.chooses.length === 1, 'card choice');
  assert.equal(c.state.chooses[0].action, 'pick'); await c.page.screenshot({ path: path.join(output, '04-card-mobile.png'), fullPage: true });
  await pulse(c.page, 650); await c.page.getByRole('link', { name: '返回', exact: true }).click(); await c.page.waitForURL('**/#/me');
  await until(() => c.state.turns.length === 1, 'leave flush');
  assert.equal(await c.page.evaluate(() => window.__synthetic.streams.every(s => s.getTracks().every(t => t.readyState === 'ended'))), true);
  results.push({ scenario: 'card-and-leave', choose: c.state.chooses.length, savedTailTurns: c.state.turns.length, fullSegments: c.state.full.length }); await c.ctx.close();
  }
  if (run('denied')) {
  const d = await fixture('denied', true, true);
  assert.equal(await d.page.evaluate(() => window.__synthetic.count), 0);
  await d.page.locator('.manual-entry summary').click(); await d.page.locator('#manual').fill('我想聊小时候的家'); await d.page.locator('#sendManual').click();
  await until(() => d.state.chooses.length === 1, 'manual after permission denial');
  await d.page.screenshot({ path: path.join(output, '05-denied-manual-mobile.png'), fullPage: true });
  results.push({ scenario: 'permission-denied', micOpens: 0, manualChoices: d.state.chooses.length }); await d.ctx.close();
  }
  if (run('recovery')) {
    const r = await fixture('recovery', true), {page, state} = r;
    await page.locator('.tcard').first().click(); await page.waitForFunction(() => !document.querySelector('.cards'));
    await page.locator('#snd').click();
    assert.equal(await page.locator('#snd').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#mic').getAttribute('aria-pressed'), 'true', 'speaker mute must keep microphone active');
    state.failTurnAfterAccept = 1; await pulse(page, 650);
    await page.locator('#retry').waitFor({state:'visible'});
    const retained = await page.evaluate(async id => (await (await import('/src/voice-outbox.js')).listPending(id)).filter(x=>x.kind==='turn').map(x=>({clientTurnId:x.clientTurnId,question:x.question,questionId:x.questionId,ask:x.ask,phase:x.phase,bytes:x.blob?.size,mime:x.blob?.type})), state.snapshot.id);
    assert.equal(retained.length, 1); assert.ok(retained[0].bytes > 1000); assert.equal(retained[0].mime, 'audio/wav'); assert.equal(retained[0].phase, 'chat'); assert.ok(retained[0].questionId && retained[0].ask);
    const retryId = retained[0].clientTurnId;
    const pendingMessageId = await page.locator('.chat-message.user').last().getAttribute('data-message-id');
    await page.screenshot({path:path.join(output, '06-network-retained-mobile.png'),fullPage:true});
    await page.locator('#retry').click(); await until(()=>state.turnAttempts.length === 2, 'same-id turn retry'); await page.locator('#retry').waitFor({state:'hidden'});
    assert.equal(state.turns.length, 1, 'a response lost after server acceptance must not duplicate the archive');
    assert.ok(state.turnAttempts.every(x=>x.clientTurnId === retryId));
    assert.equal(await page.locator(`[data-message-id="${pendingMessageId}"]`).count(), 1, 'retry must update the existing user bubble');
    assert.equal(await page.locator('#snd').getAttribute('aria-pressed'), 'false', 'mute preference must survive turn rendering');

    // A failed full segment is present only in IndexedDB, so the next sequence
    // must account for pending uploads as well as the server's snapshot.
    state.failFull = 1; await page.locator('#mic').click(); await page.locator('#retry').waitFor({state:'visible'});
    const pendingFull = await page.evaluate(async id => (await (await import('/src/voice-outbox.js')).listPending(id)).filter(x=>x.kind==='full').map(x=>({clientTurnId:x.clientTurnId,sequence:x.sequence,bytes:x.blob?.size})), state.snapshot.id);
    assert.equal(pendingFull.length, 1); assert.equal(pendingFull[0].sequence, 0); assert.equal(state.full.length, 0);
    state.failRecoveryGet=1;await page.reload({waitUntil:'domcontentloaded'});await page.locator('#recoverRetry').waitFor();
    assert.equal(state.creates,1,'temporary recovery failure must not create a replacement interview');
    assert.equal(await page.evaluate(()=>localStorage.getItem('mb_active_interview_synthetic-elder')),state.snapshot.id);
    await page.locator('#recoverRetry').click();await page.locator('#mic').waitFor();
    await until(()=>state.full.length === 1, 'pending full replay after reload');
    assert.equal(state.fullAttempts[0].clientTurnId, state.fullAttempts[1].clientTurnId); assert.equal(await page.locator('#mic').getAttribute('aria-pressed'), 'false');
    await page.locator('#mic').click(); await page.waitForFunction(()=>document.querySelector('#mic').getAttribute('aria-pressed')==='true');
    await pulse(page,650); await page.locator('#mic').click(); await until(()=>state.full.length === 2, 'new full sequence after pending recovery');
    assert.deepEqual(state.full.map(x=>Number(x.sequence)), [0,1]);
    await page.reload({waitUntil:'domcontentloaded'}); await page.locator('#mic').waitFor();
    await page.locator('#mic').click(); await page.waitForFunction(()=>document.querySelector('#mic').getAttribute('aria-pressed')==='true');
    state.delay=1700; await pulse(page,650); await page.locator('#end').evaluate(button=>{button.click();button.click();});
    await until(()=>state.turns.length === 3, 'last tail accepted'); await sleep(300);
    assert.equal(state.finishes,0,'finish must wait until the accepted delayed last turn is saved');
    await page.waitForURL('**/#/story/synthetic-story'); assert.equal(state.finishes,1);
    assert.equal(state.turns.length,3,'pending retry during reload must not create duplicate accepted turns');
    assert.deepEqual(state.full.map(x=>Number(x.sequence)),[0,1,2]);
    assert.equal(await page.evaluate(()=>window.__synthetic.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))),true);
    results.push({scenario:'retry-reload-finish',turns:state.turns.length,turnAttempts:state.turnAttempts.length,uniqueTurnIds:new Set(state.turnAttempts.map(x=>x.clientTurnId)).size,retainedAudioBytes:retained[0].bytes,preservedQuestionSnapshot:true,fullSequences:state.full.map(x=>Number(x.sequence)),fullAttempts:state.fullAttempts.length,finishCalls:state.finishes,muteKeptMic:true});
    await r.ctx.close();
  }
  if (run('chat')) {
    const c = await fixture('chat'), { page, state } = c;
    await hasAudio(page);
    await page.waitForFunction(() => document.querySelector('#voiceOrb').style.getPropertyValue('--voice-level') !== '');
    const level = await page.evaluate(async () => {
      const value = () => Number(document.querySelector('#voiceOrb').style.getPropertyValue('--voice-level'));
      const silent = value(); window.__synthetic.gain.gain.value = .03;
      await new Promise(r => setTimeout(r, 600)); const speaking = value();
      window.__synthetic.gain.gain.value = 0;
      await new Promise(r => setTimeout(r, 850)); return { silent, speaking, after: value() };
    });
    assert.equal(level.silent, 0); assert.ok(level.speaking > .1); assert.equal(level.after, 0);
    await until(() => state.chooses.length === 1, 'meter probe also selects the topic by voice');
    await page.waitForFunction(() => !document.querySelector('.cards'));
    await page.locator('.manual-entry summary').click();
    state.delay = 800;
    state.nextTranscript = { raw: '我可没说，我可没说我的家乡是在江南啊。', clean: '我老家不在江南。' };
    state.nextSay = '那是我记岔了。您老家是哪一带的？';
    const spoken = state.nextTranscript.raw, draft = '还没发出去的下一句话';
    await page.locator('#manual').fill(spoken); await page.locator('#sendManual').click();
    const submittedId = await page.locator('.chat-message.user').last().getAttribute('data-message-id');
    assert.equal(await page.locator('.chat-message.user').last().textContent(), spoken, 'manual text appears before the backend responds');
    assert.equal(await page.locator('.chat-message.user').last().getAttribute('data-status'), 'pending');
    await page.locator('#manual').fill(draft); await page.locator('#manual').focus();
    await page.waitForFunction(id => document.querySelector(`[data-message-id="${id}"]`)?.dataset.status === 'final', submittedId);
    assert.equal(await page.locator(`[data-message-id="${submittedId}"]`).textContent(), spoken, 'raw transcript must win over cleaned text');
    assert.equal(await page.locator('#manual').inputValue(), draft);
    assert.equal(await page.locator('#manual').evaluate(el => document.activeElement === el), true, 'incoming replies must retain editor focus');
    assert.equal(await page.locator('.manual-entry').getAttribute('open'), '');
    const assistant = await page.locator('.chat-message.assistant').first().boundingBox(), user = await page.locator(`[data-message-id="${submittedId}"]`).boundingBox();
    assert.ok(user.x > assistant.x + 20, 'user bubbles must align to the right of assistant bubbles');
    const initialMessages = await page.locator('.chat-message').count();
    await page.locator('.manual-entry summary').click();
    await page.locator('#latest').evaluate(el => el.click());
    await page.screenshot({ path: path.join(output, '10-correction-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#latest').evaluate(el => el.click());
    await page.screenshot({ path: path.join(output, '11-correction-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.locator('.manual-entry summary').click();
    const memories = [
      ['我老家在河北。小时候，我们一家住在老街，门口有一棵大树。傍晚吃过饭，家人常坐在树下聊天，我还记得那些声音。', '那棵树下，您常和谁坐在一起？'],
      ['我奶奶经常在那里纳鞋底，我就在旁边给她递线。她做一双鞋要花好多天，我也慢慢学会了怎么穿针。', '奶奶有没有教过您什么小窍门？'],
      ['她说线头要捻细一点。我小时候总穿不过去，急得不行，她就把手里的活放下，过来帮我。', '那双鞋，您还记得是什么样的吗？'],
      ['是黑布面的，鞋底厚厚的。我每天穿着它走路去上学，下雨天怕弄湿，就把鞋藏在书包里，光脚跑回家。', '回到家以后，奶奶说了什么？'],
      ['她看见我的泥脚就笑，一边拿来热水，一边说鞋湿了能晒，别把自己冻着。后来离开老家，我还带着她做的鞋。', '您后来把那双鞋放在哪里了？'],
    ];
    for (const [memory, reply] of memories) {
      state.nextSay = reply;
      await page.locator('#manual').fill(memory);
      await page.locator('#sendManual').click();
      await page.waitForFunction(() => !document.querySelector('#sendManual').disabled);
    }
    assert.equal(await page.locator('.chat-message').count(), initialMessages + 10, 'new turns must append without replacing history');
    assert.equal(await page.locator('.chat-message.assistant').first().textContent(), '王女士，这次打算往记忆银行里边存点什么？');
    assert.equal(await page.locator(`[data-message-id="${submittedId}"]`).count(), 1);
    const ids = await page.locator('.chat-message').evaluateAll(nodes => nodes.map(n => n.dataset.messageId));
    assert.equal(new Set(ids).size, ids.length, 'every message id must have exactly one DOM node');
    state.delay = 800;
    state.nextSay = '您慢慢说，我在听。';
    await page.locator('#manual').fill('还有一件事，我想慢慢说。'); await page.locator('#sendManual').click();
    await page.locator('#conversation').evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
    const scrollBefore = await page.locator('#conversation').evaluate(el => el.scrollTop);
    await page.waitForFunction(() => !document.querySelector('#sendManual').disabled);
    assert.equal(await page.locator('#conversation').evaluate(el => el.scrollTop), scrollBefore, 'incoming replies must not steal the history reading position');
    await page.locator('#latest').waitFor({ state: 'visible' }); await page.locator('#latest').click();
    assert.ok(await page.locator('#conversation').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 2));
    await page.locator('.manual-entry summary').click();
    await page.screenshot({ path: path.join(output, '07-chat-desktop.png'), fullPage: true });
    const layouts = [];
    for (const layout of [{width:390,height:844,scale:1}, {width:320,height:568,scale:1}, {width:320,height:568,scale:1.4}]) {
      await page.setViewportSize({ width: layout.width, height: layout.height });
      await page.evaluate(scale => document.documentElement.style.setProperty('--fs', scale), layout.scale);
      await page.locator('#latest').evaluate(el => el.click());
      const measure = async () => page.evaluate(() => {
        const viewport = document.documentElement.clientWidth, chat = document.querySelector('#conversation'), dock = document.querySelector('.voice-dock');
        return { viewport, document: document.documentElement.scrollWidth, chat: chat.scrollWidth, chatWidth: chat.clientWidth, chatHeight: chat.clientHeight, dock: dock.scrollWidth, dockWidth: dock.clientWidth };
      });
      const closed = await measure();
      assert.ok(closed.document <= closed.viewport + 1 && closed.chat <= closed.chatWidth + 1 && closed.dock <= closed.dockWidth + 1, 'chat must not overflow horizontally');
      assert.ok(closed.chatHeight > 80, 'the conversation must remain usable above the controls');
      await page.screenshot({ path: path.join(output, `08-chat-${layout.width}-${layout.scale}.png`), fullPage: true });
      await page.locator('.manual-entry summary').click(); const open = await measure();
      assert.ok(open.document <= open.viewport + 1 && open.chat <= open.chatWidth + 1 && open.dock <= open.dockWidth + 1, 'expanded typing must not overflow horizontally');
      assert.ok(open.chatHeight > 60, 'expanded typing must leave room for messages');
      await page.screenshot({ path: path.join(output, `09-typing-${layout.width}-${layout.scale}.png`), fullPage: true });
      await page.locator('.manual-entry summary').click(); layouts.push({ ...layout, closed, open });
    }
    await page.locator('#mic').click();
    assert.equal(await page.locator('#voiceOrb').evaluate(el => Number(el.style.getPropertyValue('--voice-level'))), 0);
    results.push({ scenario: 'chat-layout-and-history', messages: ids.length + 2, rawTranscriptPreserved: true, draftAndFocusPreserved: true, scrollPreserved: true, sameIdDeduplicated: true, level, layouts });
    await c.ctx.close();
  }
  assert.deepEqual(errors, []);
  const report = { environment: 'macOS Chromium headless, AudioWorklet 48 kHz, synthesized harmonic microphone and PCM TTS, mocked Chinese API transcript fixtures; no acoustic echo/human speech validation', demoContent: '截图内容均为模拟对话，不是真实老人资料；10/11截图使用用户给出的江南纠正示例，其余聊天内容为测试编写的演示往事。', testedAt: new Date().toISOString(), errors, results };
  const reportPath=path.join(output,selected?'synthetic-results-'+selected.join('-')+'.json':'synthetic-results.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: true, errors, scenarios: results.map(({metrics,source,...summary})=>summary), report: reportPath }, null, 2));
} finally { await browser.close(); await vite.close(); }
