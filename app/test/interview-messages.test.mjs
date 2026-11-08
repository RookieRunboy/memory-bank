import test from 'node:test';
import assert from 'node:assert/strict';
import { InterviewMessages, userId } from '../src/interview-messages.js';

const visible = model => model.items.map(({ role, text }) => [role, text]);

test('恢复双方历史：选择原话也保留，补充不重复同一个问题', () => {
  const model = new InterviewMessages({
    id: 'interview', responseId: 'reply-2', say: '后来呢？',
    transcript: [
      { id: 'choice', questionId: 'opening', question: '想聊什么？', raw: '我想聊小时候。', clean: '小时候' },
      { id: 'first', questionId: 'reply-1', question: '家里什么样？', raw: '一个平房。', clean: '家里是平房。' },
      { id: 'supplement', questionId: 'reply-1', question: '家里什么样？', raw: '还有个院子。' },
    ],
  });
  assert.deepEqual(visible(model), [
    ['assistant', '想聊什么？'], ['user', '我想聊小时候。'],
    ['assistant', '家里什么样？'], ['user', '一个平房。'], ['user', '还有个院子。'],
    ['assistant', '后来呢？'],
  ]);
});

test('不同消息 ID 的同样原话保留；同 ID 更新不新增气泡', () => {
  const model = new InterviewMessages();
  model.assistant('q1', '后来呢？');
  model.user(userId({ clientTurnId: 'a' }), '后来');
  model.user(userId({ clientTurnId: 'a' }), '后来搬家了。', 'final');
  model.assistant('q2', '后来呢？');
  assert.deepEqual(visible(model), [['assistant', '后来呢？'], ['user', '后来搬家了。'], ['assistant', '后来呢？']]);
  const revision = model.revision;
  model.assistant('q2', '后来呢？');
  assert.equal(model.revision, revision, 'unchanged messages do not cause repaint');
});

test('回复原始转写替换临时文字，重复结果不重复原话', () => {
  const model = new InterviewMessages();
  const input = { utteranceId: 'speech', clientTurnId: 'part1' };
  model.user(userId(input), '我老家在江南', 'listening');
  const result = { transcript: { raw: '我可没说，我老家在江南。', clean: '老家不在江南。' } };
  model.resolve(input, result); model.resolve(input, result);
  assert.deepEqual(model.items, [{ id: 'user:speech', role: 'user', text: '我可没说，我老家在江南。', status: 'final' }]);
});

test('长段按 utteranceId 合并，终止标记不添加第二份文字', () => {
  const model = new InterviewMessages();
  const first = { utteranceId: 'long', clientTurnId: 'part1', continuation: true };
  const second = { utteranceId: 'long', clientTurnId: 'part2', continuation: true };
  model.resolve(first, { deferred: true, transcript: { raw: '第一段。' } });
  model.resolve(second, { deferred: true, transcript: { raw: '第二段。' } });
  model.resolve(first, { deferred: true, transcript: { raw: '第一段。' } });
  assert.equal(model.items[0].status, 'pending');
  model.resolve({ utteranceId: 'long', clientTurnId: 'end', finalizeContinuation: true }, { finalized: true, heard: '第一段。\n第二段。' });
  assert.deepEqual(visible(model), [['user', '第一段。\n第二段。']]);
  assert.equal(model.items[0].status, 'final');
});

test('离线选题返回累计 heard，不再重复已显示的分段', () => {
  const model = new InterviewMessages();
  model.resolve({ utteranceId: 'long', clientTurnId: 'part1', continuation: true }, { deferred: true, transcript: { raw: '小时候。' } });
  model.resolve({ utteranceId: 'long', clientTurnId: 'part2' }, { heard: '小时候。\n住过的地方。' });
  assert.equal(model.items[0].text, '小时候。\n住过的地方。');
});

test('旧记录兼容：跳过未提问占位，同一问题的连续分段合并', () => {
  const model = new InterviewMessages({
    turns: [
      { id: 't0', q: '（小忆尚未提问，老人主动讲述）', questionId: 'iv:unheard', raw: '我先说一段。' },
      { id: 't1', q: '接着说。', utteranceId: 'long', raw: '第一段。', continuation: true },
      { id: 't2', q: '接着说。', utteranceId: 'long', raw: '第二段。', continuation: false },
    ],
  });
  assert.deepEqual(visible(model), [['user', '我先说一段。'], ['assistant', '接着说。'], ['user', '第一段。\n第二段。']]);
  assert.equal(model.items.at(-1).status, 'final');
});

test('已恢复的长段可接收重试和最终标记，不复制历史分段', () => {
  const model = new InterviewMessages({
    transcript: [{ id: 't1', utteranceId: 'long', clientTurnId: 'part1', raw: '第一段。', deferred: true }],
    turns: [{ id: 't1', continuation: false, finalizedBy: 'end' }],
  });
  assert.equal(model.items[0].status, 'final');
  model.resolve({ utteranceId: 'long', clientTurnId: 'part1', continuation: true }, { deferred: true, transcript: { raw: '第一段。' } });
  assert.equal(model.items[0].text, '第一段。');
  assert.equal(model.items[0].status, 'final', 'late part retry cannot revert a completed utterance');
});

test('已存语音选题恢复后重放 outbox，临时更新和结果仍是同一条消息', () => {
  const input = { utteranceId: 'choice-voice', clientTurnId: 'choice-request' };
  const model = new InterviewMessages({ transcript: [{ ...input, id: 'choice-archive', raw: '嗯，我想聊第二个。' }] });
  model.user(userId(input), model.items[0].text, 'pending');
  model.resolve(input, { transcript: { raw: '嗯，我想聊第二个。' } });
  assert.deepEqual(model.items, [{ id: 'user:choice-voice', role: 'user', text: '嗯，我想聊第二个。', status: 'final' }]);
});

test('无识别结果明确显示语音占位，不把临时内容当成定稿', () => {
  const model = new InterviewMessages();
  const input = { clientTurnId: 'recording' };
  model.user(userId(input), '可能错误的临时识别', 'listening');
  model.resolve(input, { ignored: true });
  assert.equal(model.items[0].text, '这段语音暂未识别出文字。');
  assert.equal(model.items[0].status, 'final');
  assert.equal(model.remove(userId(input)), true);
  assert.deepEqual(model.items, []);
});

test('手动输入与选题按钮用用户实际输入或选择的文字', () => {
  const model = new InterviewMessages();
  model.resolve({ clientTurnId: 'manual', manual: '我想聊学校。' }, {});
  model.resolve({ clientTurnId: 'card', action: 'pick', displayText: '小时候的家' }, { heard: null });
  assert.deepEqual(visible(model), [['user', '我想聊学校。'], ['user', '小时候的家']]);
});

test('恢复文字不因语音静音或离页取消的播放事件而丢失', () => {
  const model = new InterviewMessages({ id: 'iv', say: '当前的问题', responseId: 'current', events: [{ type: 'playback-suppressed', responseId: 'current' }] });
  assert.deepEqual(visible(model), [['assistant', '当前的问题']]);
});

test('恢复时隐藏明确未显示的迟到回复，不影响其他回复', () => {
  const hidden = new InterviewMessages({ id: 'iv', say: '过期的问题', responseId: 'current', events: [
    { type: 'playback-suppressed', responseId: 'current', displayed: false },
    { type: 'playback-suppressed', responseId: 'current' },
  ] });
  assert.deepEqual(hidden.items, []);
  const visibleReply = new InterviewMessages({ id: 'iv', say: '当前的问题', responseId: 'current', events: [
    { type: 'playback-suppressed', responseId: 'other', displayed: false },
    { type: 'playback-suppressed', responseId: 'current', displayed: true },
  ] });
  assert.deepEqual(visible(visibleReply), [['assistant', '当前的问题']]);
});
