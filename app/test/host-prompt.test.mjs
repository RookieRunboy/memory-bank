import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import * as P from '../src/planner.js'; import { DEMO_PROFILE } from '../src/questions.js';
const FW = JSON.parse(fs.readFileSync(new URL('../src/framework.json', import.meta.url)));
const md = fs.readFileSync(new URL('../../docs/interview.md', import.meta.url), 'utf8');
const styleMd = fs.readFileSync(new URL('../../docs/host-style.md', import.meta.url), 'utf8');
const style = styleMd.match(/```\n([\s\S]*?)```/)?.[1];
const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/host-cases.json', import.meta.url)));

test('风格层可从 host-style.md 读出，含六招、谈遗忘和越界红线', () => {
  assert.ok(style, '没有找到代码块');
  for (const k of ['接住细节', '时代引子', '留白', '适时引导', '不让话掉在地上', '概括就请讲一件具体的事', '听不清或对不上时', '先降难度，再放弃', '当老人谈起遗忘', '不讲你自己的经历', '不替老人说感受']) assert.ok(style.includes(k), k);
});
test('风格层不含花括号变量，拼到主持人提示词后无残留变量', () => {
  assert.deepEqual(P.leftoverVars(style), []);
  const host = md.match(/```\n([\s\S]*?)```/)[1] + '\n' + style;
  for (const p of [DEMO_PROFILE, {}, { name: '张三' }]) {
    const plan = P.planSession(FW, { profile: p }), v = P.planVars(FW, plan, { profile: p });
    assert.deepEqual(P.leftoverVars(P.fillAll(host.replace(/\{重要人物\}/g, p.people || ''), p, v)), []); }
});
test('评测用例：16 条，类型齐全，每条有期望', () => {
  assert.equal(cases.length, 16); assert.equal(new Set(cases.map(c => c.id)).size, 16);
  for (const k of ['谈遗忘', '谈已故亲人', '很短', '卡壳', '跑题', '概括', '连续讲述', '澄清', '降难度']) assert.ok(cases.some(c => c.kind === k), k);
  for (const c of cases) assert.ok(c.elder && c.expect, c.id);
});
test('降难度阶梯：连续三次简短才算聊够，前两次不离开节点', () => {
  let states = {}; const r = { nodeId: 'child-home', depth: 0, short: true, emotion: '卡壳' };
  const leaves = [];
  for (let i = 0; i < 3; i++) { const u = P.applyAnswer(FW, states, r, 's1'); states = u.states; leaves.push(u.leave); }
  assert.deepEqual(leaves, [null, null, 'short_replies']);
  const u = P.applyAnswer(FW, states, { ...r, short: false, depth: 1, note: '有院子' }, 's1');
  assert.equal(P.st(u.states, 'child-home').shortRun, 0, '说长了次数清零');
});
