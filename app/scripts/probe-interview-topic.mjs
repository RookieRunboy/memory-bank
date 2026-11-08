// Fixed synthetic conversation through the real configured host, isolated DB.
// Run from app/: node scripts/probe-interview-topic.mjs [report.json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { sseData } from '../server/streaming-json.mjs';

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-topic-live-'));
const output = path.resolve(process.argv[2] || 'screenshots/realtime-voice/topic-service-results.json');
const report = { measuredAt: new Date().toISOString(), isolation: { temporaryDatabase: true, existingUserDataChanged: false }, rounds: [] };
const child = spawn(process.execPath, ['server/index.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, DATA_DIR: data, PORT: '0', HOST: '127.0.0.1', GEMINI_TTS_WARM: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '', base;
child.stdout.on('data', x => log = (log + x).slice(-4096)); child.stderr.on('data', () => {});
try {
  for (let i = 0; i < 500; i++) { const m = log.match(/memory-bank on 127.0.0.1:(\d+)/); if (m) { base = `http://127.0.0.1:${m[1]}/api`; break; } await delay(20); }
  if (!base) throw Error('startup-timeout');
  const post = async (url, body, stream = false) => {
    const response = await fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', ...(stream && { Accept: 'text/event-stream' }) }, body: JSON.stringify(body), signal: AbortSignal.timeout(65000) });
    if (!response.ok) throw Error('http-' + response.status);
    if (!stream) return response.json();
    const events = []; for await (const text of sseData(response.body)) events.push(JSON.parse(text));
    const result = events.findLast(e => e.type === 'result')?.result;
    if (!result) throw Error('missing-result');
    return { result, drafts: events.filter(e => e.type === 'reply-draft').length, replies: events.filter(e => e.type === 'reply').length };
  };
  async function round(opening, endpoint, manual, label) {
    const start = performance.now();
    const { result, drafts, replies } = await post(`/interviews/${opening.id}/${endpoint}`, { clientTurnId: label, manual, question: opening.say, questionId: opening.responseId, ask: opening.ask }, true);
    const next = result.next || result;
    const row = { label, manual, say: next.say, phase: next.phase, source: next.source, nodeId: next.analysis?.nodeId, drafts, replies, durationMs: Math.round(performance.now() - start), interrupted: !!result.replyInterrupted };
    report.rounds.push(row); console.log(JSON.stringify(row));
    return { ...opening, ...next, responseId: result.responseId };
  }
  let current = await post('/interviews', { elderId: 'demo-wang' });
  current = await round(current, 'choose', 'Ok，这次聊聊这次的。我年轻时候第一次参加的黑客松的比赛。', 'opening');
  current = await round(current, 'turn', '哎，我是问，我是说的是。聊第一次参加黑客松比赛的经历吧。', 'correction');
  await round(current, 'turn', '当时我们四个人，一夜没睡，一起做了个帮助盲人识别物品的小程序。', 'followup');
  const wrong = await post('/interviews', { elderId: 'demo-wang', request: { nodeId: 'youth-wedding' } });
  const card = await post(`/interviews/${wrong.id}/choose`, { clientTurnId: 'old-card', action: 'pick', index: wrong.cards.findIndex(c => c.nodeId === 'youth-wedding') });
  await round({ ...wrong, ...card }, 'turn', '不是结婚，我说的是第一次参加黑客松比赛的经历。', 'recover-from-wedding');
  report.transportPass = report.rounds.every(r => r.phase === 'chat' && r.source === 'openai-stream' && !r.interrupted && r.replies > 0);
  report.menuAbsent = report.rounds.every(r => !/第一个，|接下来想聊哪个|那咱们就聊结婚/.test(r.say));
} catch (error) { report.failure = /^[a-z0-9-]+$/.test(error.message) ? error.message : 'probe-error'; }
finally {
  if (child.exitCode == null) { child.kill(); await once(child, 'exit'); }
  fs.rmSync(data, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, transportPass: report.transportPass, menuAbsent: report.menuAbsent, failure: report.failure }));
  if (!report.transportPass || !report.menuAbsent || report.failure) process.exitCode = 1;
}
