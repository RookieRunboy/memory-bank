import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { DEMO_PROFILE } from '../src/questions.js';

// Vite loads the production browser module's JSON import; storage is the only
// stub, so these tests do not open a microphone or write a personal story.
let vite, VoiceInterview;
before(async () => {
  vite = await createServer({ root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), configFile: false, server: { middlewareMode: true }, logLevel: 'error' });
  ({ VoiceInterview } = await vite.ssrLoadModule('/src/voice-interview.js'));
});
after(async () => { await vite?.close(); });
function fixture(state = {}) {
  return {
    s: { phase: 'choose', p: DEMO_PROFILE, n: 0, cards: [{ nodeId: 'youth-wedding', text: '结婚那天' }], shown: ['youth-wedding'], ...state },
    answers: [], saved: [],
    async saveOffline() { this.saved = this.answers.map(answer => ({ ...answer })); },
  };
}

test('offline topic narration keeps the actual story instead of choosing the first card', async () => {
  const target = fixture(), raw = 'Ok，这次聊聊这次的。我年轻时候第一次参加的黑客松的比赛。';
  const reply = await VoiceInterview.prototype.offlineTurn.call(target, { manual: raw, question: '想聊什么？' });
  assert.equal(reply.free, true);
  assert.equal(reply.phase, 'chat');
  assert.equal(reply.heard, raw);
  assert.equal(target.saved[0].text, raw);
  assert.match(reply.say, /离线/);
  assert.doesNotMatch(reply.say, /结婚|婚礼/);
});

test('offline free narration never resumes an old preset question sequence', async () => {
  const target = fixture({ phase: 'chat', free: true, qs: [{ text: '结婚那天，您先想到哪个场面？', nodeId: 'youth-wedding' }] });
  const raw = '我们三个人做了一个机器人。';
  const reply = await VoiceInterview.prototype.offlineTurn.call(target, { browserText: raw, question: '您可以接着讲这段经历。' });
  assert.equal(reply.transcript.raw, raw);
  assert.equal(target.saved[0].text, raw);
  assert.equal(reply.next.free, true);
  assert.doesNotMatch(reply.next.say, /结婚|婚礼/);
  assert.match(reply.next.say, /保存在本机/);
});

test('offline free button records no invented user answer', async () => {
  const target = fixture();
  const reply = await VoiceInterview.prototype.offlineTurn.call(target, { action: 'free' });
  assert.equal(reply.free, true);
  assert.equal(reply.phase, 'chat');
  assert.deepEqual(target.answers, []);
  assert.match(reply.say, /离线/);
  assert.doesNotMatch(reply.say, /结婚|婚礼/);
});

test('offline explicit card selection still opens that selected topic', async () => {
  const target = fixture();
  const reply = await VoiceInterview.prototype.offlineTurn.call(target, { action: 'pick', index: 0 });
  assert.equal(reply.phase, 'chat');
  assert.equal(reply.ask.nodeId, 'youth-wedding');
  assert.match(reply.say, /结婚/);
});
