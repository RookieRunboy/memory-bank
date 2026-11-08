import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

test('self-selected opening reaches the host, persists across reload/retry, and keeps long opening speech', { timeout: 30000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-topic-api-'));
  const preload = path.join(dir, 'provider.mjs'), prompts = path.join(dir, 'prompts.jsonl');
  fs.writeFileSync(preload, `import fs from 'node:fs';
  globalThis.fetch=async (_url,options)=>{
    const body=JSON.parse(options.body),prompt=body.messages?.map(m=>m.content).join('\\n')||'';
    fs.appendFileSync(${JSON.stringify(prompts)},JSON.stringify(prompt)+'\\n');
    const reply={ask:{nodeId:'life-technology',depth:2},done:false,callName:null,say:'您当时是怎么想到参加那场比赛的？',answer:{nodeId:'life-technology',depth:1,note:'第一次参加黑客松比赛',entities:[]},emotion:'平静',leave:null,action:'追问细节'};
    return Response.json({choices:[{message:{content:JSON.stringify(reply)}}]});
  };`);
  const child = spawn(process.execPath, ['--import', preload, 'server/index.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, DATA_DIR: dir, PORT: '0', HOST: '127.0.0.1', OPENAI_API_KEY: 'fixture', LLM_PROVIDER: 'openai', GEMINI_TTS_WARM: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode == null) { child.kill(); await once(child, 'exit'); } fs.rmSync(dir, { recursive: true, force: true }); });
  let output = '', base;
  child.stdout.on('data', x => output += x); child.stderr.on('data', () => {});
  for (let i = 0; i < 400; i++) { const m = output.match(/memory-bank on 127.0.0.1:(\d+)/); if (m) { base = `http://127.0.0.1:${m[1]}/api`; break; } await delay(20); }
  assert.ok(base, 'isolated server starts');
  const post = async (url, body) => { const r = await fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); assert.equal(r.status, 200, await (r.status !== 200 ? r.text() : Promise.resolve(''))); return r.json(); };
  const get = async url => (await fetch(base + url)).json();
  const readPrompts = () => fs.existsSync(prompts) ? fs.readFileSync(prompts, 'utf8').trim().split('\n').map(JSON.parse) : [];
  const opening = await post('/interviews', { elderId: 'demo-wang' }), url = '/interviews/' + opening.id;
  const first = 'Ok，这次聊聊这次的。我年轻时候第一次参加的黑客松的比赛。';
  const input = { clientTurnId: 'opening-topic', utteranceId: 'first-utterance', manual: first, question: opening.say, questionId: opening.responseId, ask: opening.ask };
  const reply = await post(url + '/choose', input);
  assert.equal(reply.next?.phase, 'chat', 'a narrated topic must enter the host, not a card template');
  assert.ok(readPrompts().at(-1)?.includes(first), 'the first actual words must reach the model');
  assert.match(reply.next.say, /比赛/); assert.doesNotMatch(reply.next.say, /结婚|第一个/);
  const count = readPrompts().length;
  assert.deepEqual(await post(url + '/choose', input), reply, 'retry returns the same reply without another host call');
  assert.equal(readPrompts().length, count);
  let snapshot = await get(url);
  assert.equal(snapshot.turns.length, 1); assert.equal(snapshot.turns[0].raw, first);
  assert.equal(snapshot.transcript.filter(x => x.clientTurnId === input.clientTurnId).length, 1);
  assert.equal(snapshot.free, true);
  assert.equal((await get('/elders/demo-wang')).interviews.find(x => x.id === opening.id).stage, '自由聊聊', 'the unselected default wedding must not label the saved conversation');
  const correction = '哎，我是问，我是说的是。聊第一次参加黑客松比赛的经历吧。';
  await post(url + '/turn', { clientTurnId: 'correction', manual: correction, question: snapshot.say, questionId: snapshot.responseId, ask: snapshot.ask });
  assert.ok(readPrompts().at(-1).includes(first)); assert.ok(readPrompts().at(-1).includes(correction));
  snapshot = await get(url); assert.equal(snapshot.phase, 'chat'); assert.equal(snapshot.free, true);

  // Opening audio can be split into immutable transcript chunks. Both an empty
  // final marker and a nonempty tail must reach the host exactly once.
  for (const terminal of ['marker', 'tail']) {
    const start = await post('/interviews', { elderId: 'demo-wang' }), u = '/interviews/' + start.id;
    const common = { utteranceId: terminal, question: start.say, questionId: start.responseId, ask: start.ask };
    const part = await post(u + '/choose', { ...common, clientTurnId: terminal + '-part', manual: '第一次参加黑客松比赛。', continuation: true });
    assert.equal(part.deferred, true);
    const end = terminal === 'marker' ? { finalizeContinuation: true } : { manual: '当时我们一起写代码。' };
    const result = await post(u + '/choose', { ...common, clientTurnId: terminal + '-end', ...end });
    assert.equal(result.next?.phase, 'chat'); assert.ok(readPrompts().at(-1).includes('第一次参加黑客松比赛。'));
    if (terminal === 'tail') assert.ok(readPrompts().at(-1).includes('当时我们一起写代码。'));
    const restored = await get(u);
    assert.equal(restored.transcript.length, terminal === 'marker' ? 1 : 2);
    assert.equal(restored.turns.length, terminal === 'marker' ? 1 : 2);
    assert.equal(restored.turns.at(-1).continuation, false);
  }
});
