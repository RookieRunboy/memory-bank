import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationHistory } from '../server/interview-context.mjs';
import FW from '../src/framework.json' with { type: 'json' };
import { DEMO_PROFILE } from '../src/questions.js';

test('legacy history restores actual narrated choices but excludes menu commands and preserves recorded questions', () => {
  const cards = ['youth-wedding', 'elder-hometown-food', 'teen-song'];
  const first = 'Ok，这次聊聊这次的。我年轻时候第一次参加的黑客松的比赛。';
  const choices = ['第二个吧', '都行', '不知道说什么', first].map((heard, i) => ({ id: 'c' + i, at: i, heard, action: i === 2 ? 'help' : 'pick', cards }));
  const transcript = [{ id: 'c3', at: 3, raw: first, clean: first, question: '这次打算存点什么？', questionId: 'opening' }];
  const turn = { id: 't1', at: 4, q: '结婚那天？', clean: '我说的是黑客松。' };
  const result = conversationHistory(FW, DEMO_PROFILE, { opening: { choices }, turns: [turn] }, transcript);
  assert.deepEqual(result.map(t => t.id), ['c3', 't1']);
  assert.equal(result[0].q, transcript[0].question); assert.equal(result[0].questionId, 'opening');
  assert.equal(result[0].raw, first); assert.equal(result[1], turn);
});
