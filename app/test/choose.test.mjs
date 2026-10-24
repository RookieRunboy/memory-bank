import test from 'node:test'; import assert from 'node:assert/strict';
import FW from '../src/framework.json' with { type: 'json' };
import * as P from '../src/planner.js'; import { DEMO_PROFILE } from '../src/questions.js';
const p = DEMO_PROFILE, base = { profile: p, states: {}, entities: [] };
const bad = new Set([...FW.planning.needs_calm]);
test('候选 3 个、维度错开、不重复', () => {
  const c = P.candidates(FW, base); assert.equal(c.length, 3); assert.equal(new Set(c.map(x => x.nodeId)).size, 3);
  const T = c.map(x => P.nodeById(FW, x.nodeId).tags); assert.ok(new Set(T.map(t => t.domain)).size >= 2 || new Set(T.map(t => t.time)).size >= 2);
  assert.ok(c.some(x => x.kind === 'light'), '要有一个轻松触发物类');
  for (const x of c) { assert.ok(x.text && !/\{/.test(x.text)); }
});
test('有上次线索：一个顺藤、一个轻松、一个没聊过', () => {
  const states = { 'youth-meet': { status: 'partial', depth: 2, sessions: ['s1'] } };
  const entities = [{ name: '李建国', type: 'person', nodes: ['youth-meet'], mentions: 3, sessions: ['s1'] }];
  const c = P.candidates(FW, { profile: p, states, entities, lastSessionId: 's1' });
  assert.deepEqual(c.map(x => x.kind).slice(0, 2), ['follow', 'light']); assert.equal(c[2].kind, 'fresh');
});
test('避开敏感 / 需平静节点', () => {
  const states = { 'child-food': { status: 'not_started', depth: 0, sensitive: true } };
  for (let i = 0, ex = []; i < 5; i++) { const c = P.candidates(FW, { ...base, states, exclude: ex });
    for (const x of c) { assert.ok(!bad.has(x.nodeId), x.nodeId); assert.notEqual(x.nodeId, 'child-food'); } ex.push(...c.map(x => x.nodeId)); }
});
test('家人指定的放第一个', () => { const c = P.candidates(FW, { ...base, request: { nodeId: 'youth-firstjob' } }); assert.equal(c[0].nodeId, 'youth-firstjob'); assert.equal(c[0].kind, 'family'); });
test('换几个：下一组不重复', () => { const a = P.candidates(FW, base), b = P.candidates(FW, { ...base, exclude: a.map(x => x.nodeId) });
  assert.equal(b.length, 3); for (const x of b) assert.ok(!a.some(y => y.nodeId === x.nodeId)); });
test('语音选择解析', () => {
  const c = P.candidates(FW, base), pc = (t, o) => P.parseChoice(FW, t, c, p, o);
  assert.deepEqual([pc('就聊第二个').action, pc('就聊第二个').index], ['pick', 1]);
  assert.equal(pc('第3个吧').index, 2); assert.equal(pc('最后一个').index, 2); assert.equal(pc('头一个').index, 0);
  assert.equal(pc(c[1].text.slice(0, 4)).index, 1, '关键词匹配卡片');
  assert.equal(pc('聊过年吧').nodeId ?? c[pc('聊过年吧').index].nodeId, 'child-newyear');
  assert.equal(pc('换几个').action, 'more'); assert.equal(pc('有没有别的').action, 'more');
  assert.equal(pc('都行').index, 0);
  assert.equal(pc('继续聊这个', { after: true }).action, 'stay'); assert.equal(pc('今天先到这吧', { after: true }).action, 'end');
});
test('含糊或不说：默认第一个', () => { const c = P.candidates(FW, base);
  for (const t of ['', '嗯……', '啊？', '今天天气好']) { const r = P.parseChoice(FW, t, c, p); assert.equal(r.action, 'pick'); assert.equal(r.index, 0); } });
test('念出候选、问候无残留变量', () => { const c = P.candidates(FW, base), t = P.choiceText(c);
  assert.match(t, /今天想聊哪个？第一个，.+；第二个，.+；第三个，.+。/); assert.match(P.choiceText(c, { after: true }), /接着聊这个.*今天先到这/);
  const plan = P.planSession(FW, base); assert.doesNotThrow(() => P.greetText(FW, plan, base, false)); });
