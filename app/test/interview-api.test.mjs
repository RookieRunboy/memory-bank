import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { readWav } from '../server/interview-session.mjs';

function audio(rate = 16000, voiced = false) {
  const b = Buffer.alloc(44 + rate * 2); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(b.length - 44, 40); if (voiced) b.writeInt16LE(123, 44); return b;
}
const form = (fields, bytes = audio()) => { const f = new FormData(); for (const [key, value] of Object.entries(fields)) f.append(key, String(value)); f.append('audio', new Blob([bytes], { type: 'audio/wav' }), 'capture.wav'); return f; };

test('HTTP retries, concurrent cards, capture snapshot, final turn/finish, restart and export', { timeout: 30000 }, async t => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-voice-api-'));
  const preload = path.join(data, 'offline.mjs');
  fs.writeFileSync(preload, `globalThis.fetch = async (_url, options) => { await new Promise(r => setTimeout(r, 25)); const body = JSON.parse(options.body); const inline = body.contents?.flatMap(c => c.parts).find(p => p.inlineData)?.inlineData; if (inline) { const speech = Buffer.from(inline.data, 'base64').readInt16LE(44) !== 0; return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(speech ? { speech: true, raw: '嗯，我想聊第二个。', clean: '我想聊第二个。' } : { speech: false }) }] } }] })); } throw Error('offline synthetic fixture'); };`);
  let child, base;
  async function boot() {
    child = spawn(process.execPath, ['--import', preload, 'server/index.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, DATA_DIR: data, PORT: '0', HOST: '127.0.0.1', GEMINI_API_KEY: 'fixture', LLM_PROVIDER: 'gemini', GEMINI_TTS_WARM: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', b => output += b);
    child.stderr.on('data', () => {});
    for (let i = 0; i < 200; i++) { const m = output.match(/memory-bank on 127.0.0.1:(\d+)/); if (m && +m[1]) { base = `http://127.0.0.1:${m[1]}/api`; return; } if (child.exitCode != null) throw Error('server exited'); await delay(20); }
    throw Error('server not ready');
  }
  t.after(async () => { if (child?.exitCode == null) { child.kill(); await once(child, 'exit'); } fs.rmSync(data, { recursive: true, force: true }); });
  const request = async (url, body, method = 'POST') => { const r = await fetch(base + url, { method, headers: body instanceof FormData ? {} : { 'Content-Type': 'application/json' }, ...(method !== 'GET' && { body: body instanceof FormData ? body : JSON.stringify(body) }) }); return { status: r.status, body: await r.json() }; };
  await boot();
  // A request for a little help keeps the choice open, including after reload.
  const invitation = (await request('/interviews', { elderId: 'demo-wang' })).body;
  const invitationUrl = `/interviews/${invitation.id}`;
  assert.equal((await request(invitationUrl, null, 'GET')).body.say, invitation.say);
  const help = (await request(invitationUrl + '/choose', { clientTurnId: 'need-help', manual: '一时想不到存什么', question: invitation.say })).body;
  assert.equal(help.phase, 'choose'); assert.equal(help.say, '一件小事，或一个刚想起的人，都行。');
  assert.deepEqual(help.ask, invitation.ask);
  assert.equal((await request(invitationUrl, null, 'GET')).body.say, help.say, 'reload must preserve the current nudge');
  const helpChoice = (await request(invitationUrl + '/choose', { clientTurnId: 'help-pick', action: 'pick', index: 1 })).body;
  assert.equal(helpChoice.phase, 'chat');
  assert.equal((await request(invitationUrl, null, 'GET')).body.say, helpChoice.say, 'reload must preserve the selected topic question');
  // Real multipart audio, confirmed no speech, voice selection, pause/resume
  // archives (including a sample-rate change), and late delivery events.
  const second = (await request('/interviews', { elderId: 'demo-wang' })).body, voiceUrl = `/interviews/${second.id}`;
  assert.equal(second.say,'王女士，这次打算往记忆银行里边存点什么？');assert.equal(second.cards.length,3);
  assert.equal((await request(voiceUrl + '/choose', form({ clientTurnId: 'quiet' }))).body.ignored, true);
  assert.equal((await request(voiceUrl, null, 'GET')).body.phase, 'choose');
  const picked = (await request(voiceUrl + '/choose', form({ clientTurnId: 'spoken-choice', utteranceId: 'spoken-choice-utterance', question: second.say }, audio(16000, true)))).body;
  assert.equal(picked.phase, 'chat'); assert.equal(picked.choice.index, 1);
  assert.equal(picked.transcript.raw, '嗯，我想聊第二个。', 'live chat receives the original choice rather than the cleaned paraphrase');
  const choiceSnapshot = (await request(voiceUrl, null, 'GET')).body;
  assert.equal(choiceSnapshot.transcript.length, 1);
  assert.equal(choiceSnapshot.transcript[0].raw, picked.transcript.raw, 'recovery includes spoken choices as well as normal answers');
  assert.equal(choiceSnapshot.transcript[0].utteranceId, 'spoken-choice-utterance', 'restored choice shares the original pending bubble identity');
  assert.equal((await request(voiceUrl + '/turn', form({ clientTurnId: 'quiet-answer', question: picked.say }))).body.ignored, true);
  const spoken = await request(voiceUrl + '/turn', form({ clientTurnId: 'with-audio', manual: '小时候屋里有个煤炉。', question: picked.say, ask: JSON.stringify(picked.ask) })); assert.equal(spoken.status, 200);
  const supplement = { clientTurnId: 'racing-voice', manual: '窗边还有我父亲做的小板凳。', question: picked.say, ask: JSON.stringify(picked.ask), questionId: picked.responseId, interrupted: true };
  const raced = await request(voiceUrl + '/choose', supplement);
  assert.ok(raced.body.next, 'speech captured before a card selection is accepted as a supplement');
  assert.deepEqual(await request(voiceUrl + '/turn', supplement), raced, 'retry key spans choose/turn routes');
  await request(voiceUrl + '/events', { eventId: 'interruption', type: 'playback-interrupted', responseId: picked.responseId, at: 10 });
  await request(voiceUrl + '/events', { eventId: 'not-displayed', type: 'playback-suppressed', responseId: 'late-reply', displayed: false, at: 11 });
  await request(voiceUrl + '/events', { eventId: 'displayed', type: 'playback-suppressed', responseId: 'visible-reply', displayed: true, at: 12 });
  await request(voiceUrl + '/events', { eventId: 'audio-only', type: 'playback-suppressed', responseId: 'muted-reply', displayed: 'false', at: 13 });
  const delivery = (await request(voiceUrl, null, 'GET')).body.events;
  assert.equal(delivery.find(event => event.responseId === 'late-reply').displayed, false);
  assert.equal(delivery.find(event => event.responseId === 'visible-reply').displayed, true);
  assert.equal(Object.hasOwn(delivery.find(event => event.responseId === 'muted-reply'), 'displayed'), false, 'only explicit boolean display state is accepted');
  const part = form({ clientTurnId: 'full0', sequence: 0, startedAt: 100, endedAt: 1100, boundary: 'pause' });
  const full0 = await request(voiceUrl + '/full', part); assert.equal(full0.status, 200);
  assert.deepEqual(await request(voiceUrl + '/full', part), full0);
  const full1 = await request(voiceUrl + '/full', form({ clientTurnId: 'full1', sequence: 1, startedAt: 4000, endedAt: 5000, boundary: 'finish' }, audio(24000)));
  assert.equal(full1.status, 200); assert.equal(full1.body.fullSegments.length, 2);
  const whole = Buffer.from(await (await fetch(base + '/audio/' + full1.body.fullAudio)).arrayBuffer());
  assert.equal(readWav(whole).durationMs, 2000);
  const ended = await request(voiceUrl + '/finish', { clientTurnId: 'end-voice' });
  const voiceStory = (await request('/stories/' + ended.body.storyId, null, 'GET')).body;
  assert.equal(voiceStory.transcript.length, 3); assert.equal(voiceStory.transcript[0].raw, '嗯，我想聊第二个。');
  assert.match(voiceStory.transcript[1].audio, /\.wav$/); assert.equal(voiceStory.fullSegments[0].boundary, 'pause');
  assert.equal((await request(voiceUrl + '/events', { eventId: 'closing', type: 'playback-completed', responseId: 'closing', at: 20 })).status, 200);
  const { body: opening } = await request('/interviews', { elderId: 'demo-wang' });
  const url = `/interviews/${opening.id}`;
  assert.equal(opening.responseId, `${opening.id}:opening`);
  const choices = await Promise.all([request(url + '/choose', { clientTurnId: 'pick', action: 'pick', index: 0 }), request(url + '/choose', { clientTurnId: 'pick', action: 'pick', index: 0 })]);
  assert.deepEqual(choices[0], choices[1]);
  assert.equal((await request(url + '/choose', { clientTurnId: 'other-card', action: 'pick', index: 1 })).status, 409);
  const empty = await request(url + '/turn', { clientTurnId: 'silence', manual: '   ' });
  assert.equal(empty.body.ignored, true);
  const chosen = choices[0].body;
  const first = { clientTurnId: 'long-a', manual: '那年我们搬进了有煤炉的小屋。', question: chosen.say, ask: JSON.stringify(chosen.ask), questionId: chosen.responseId, continuation: true };
  const saved = await request(url + '/turn', first); assert.equal(saved.body.deferred, true);
  assert.equal((await request(url + '/turn', { ...first, manual: 'changed payload' })).status, 409, 'same key cannot overwrite accepted text');
  const tail = { clientTurnId: 'long-b', manual: '我还记得窗边摆着一张旧木桌。', question: chosen.say, ask: JSON.stringify(chosen.ask), questionId: chosen.responseId };
  const pending = request(url + '/turn', tail); await delay(10);
  const finish = request(url + '/finish', { clientTurnId: 'finish' });
  const [turn, completed] = await Promise.all([pending, finish]);
  assert.equal(turn.status, 200); assert.ok(completed.body.storyId);
  assert.deepEqual(await request(url + '/turn', tail), turn, 'retry after finish returns accepted turn');
  assert.equal((await request(url + '/turn', { ...tail, clientTurnId: 'too-late' })).status, 409);
  assert.deepEqual(await request(url + '/finish', { clientTurnId: 'finish-again' }), completed);
  const snapshot = (await request(url, null, 'GET')).body;
  assert.equal(snapshot.turns.length, 2); assert.equal(snapshot.turns[0].q, chosen.say);
  assert.deepEqual(snapshot.transcript.map(row => row.raw), [first.manual, tail.manual]);
  const story = (await request('/stories/' + completed.body.storyId, null, 'GET')).body;
  assert.equal(story.transcript.length, 2); assert.match(story.body, /煤炉/); assert.match(story.body, /旧木桌/);
  child.kill(); await once(child, 'exit'); await boot();
  assert.deepEqual(await request(url + '/turn', tail), turn, 'idempotency survives process restart');
  const exported = await fetch(base + '/elders/demo-wang/export.zip'); assert.equal(exported.status, 200); assert.ok((await exported.arrayBuffer()).byteLength > 1000);

  // Aborting after the server accepts a turn stops local waiting, never its save.
  const disconnected = (await request('/interviews', { elderId: 'demo-wang' })).body;
  const disconnectUrl = `/interviews/${disconnected.id}`;
  const selection = (await request(disconnectUrl + '/choose', { action: 'pick', index: 0, clientTurnId: 'pick' })).body;
  const lost = { clientTurnId: 'lost-response', manual: '我和姐姐每天一起走路去上学。', question: selection.say };
  const controller = new AbortController();
  const aborted = fetch(base + disconnectUrl + '/turn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lost), signal: controller.signal }).catch(error => error.name);
  await delay(10); controller.abort(); await aborted;
  const recovered = await request(disconnectUrl + '/turn', lost); assert.equal(recovered.status, 200);
  assert.equal((await request(disconnectUrl, null, 'GET')).body.turns.length, 1);

  const long = (await request('/interviews', { elderId: 'demo-wang' })).body, longUrl = `/interviews/${long.id}`;
  await request(longUrl + '/choose', { clientTurnId: 'long-choice-part', utteranceId: 'choice-utterance', manual: '我想聊第二个。', continuation: true, question: long.say });
  const choiceTerminal = { clientTurnId: 'choice-terminal', utteranceId: 'choice-utterance', finalizeContinuation: true, question: long.say };
  const longChoice = await request(longUrl + '/choose', choiceTerminal);
  assert.equal(longChoice.body.phase, 'chat'); assert.equal(longChoice.body.choice.index, 1);
  assert.deepEqual(await request(longUrl + '/choose', choiceTerminal), longChoice);
  await request(longUrl + '/turn', { clientTurnId: 'long-answer-part', utteranceId: 'answer-utterance', manual: '我父亲那时候每天早晨生煤炉。', continuation: true, question: longChoice.body.say });
  const terminal = { clientTurnId: 'answer-terminal', utteranceId: 'answer-utterance', finalizeContinuation: true, question: longChoice.body.say };
  const finalized = await request(longUrl + '/turn', terminal);
  assert.equal(finalized.body.finalized, true); assert.ok(finalized.body.next.say); assert.equal(finalized.body.transcript, undefined);
  assert.deepEqual(await request(longUrl + '/turn', terminal), finalized);
  assert.equal((await request(longUrl, null, 'GET')).body.turns.length, 1);
  const longEnd = await request(longUrl + '/finish', { clientTurnId: 'long-end' });
  const longStory = (await request('/stories/' + longEnd.body.storyId, null, 'GET')).body;
  assert.equal(longStory.transcript.length, 2, 'terminal markers never duplicate immutable raw/clean');
  assert.match(longStory.body, /煤炉/);
});
