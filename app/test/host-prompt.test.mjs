import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import * as P from '../src/planner.js'; import { DEMO_PROFILE } from '../src/questions.js';
const FW = JSON.parse(fs.readFileSync(new URL('../src/framework.json', import.meta.url)));
const md = fs.readFileSync(new URL('../../docs/interview.md', import.meta.url), 'utf8');
const styleMd = fs.readFileSync(new URL('../../docs/host-style.md', import.meta.url), 'utf8');
const style = styleMd.match(/```\n([\s\S]*?)```/)?.[1];
const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/host-cases.json', import.meta.url)));

test('风格层可从 host-style.md 读出，含五招、谈遗忘和越界红线', () => {
  assert.ok(style, '没有找到代码块');
  for (const k of ['接住细节', '时代引子', '留白', '适时引导', '不让话掉在地上', '当老人谈起遗忘', '不讲你自己的经历', '不替老人说感受']) assert.ok(style.includes(k), k);
});
test('风格层不含花括号变量，拼到主持人提示词后无残留变量', () => {
  assert.deepEqual(P.leftoverVars(style), []);
  const host = md.match(/```\n([\s\S]*?)```/)[1] + '\n' + style;
  for (const p of [DEMO_PROFILE, {}, { name: '张三' }]) {
    const plan = P.planSession(FW, { profile: p }), v = P.planVars(FW, plan, { profile: p });
    assert.deepEqual(P.leftoverVars(P.fillAll(host.replace(/\{重要人物\}/g, p.people || ''), p, v)), []); }
});
test('评测用例：10 条，类型齐全，每条有期望', () => {
  assert.equal(cases.length, 10); assert.equal(new Set(cases.map(c => c.id)).size, 10);
  for (const k of ['谈遗忘', '谈已故亲人', '很短', '卡壳', '跑题']) assert.ok(cases.some(c => c.kind === k), k);
  for (const c of cases) assert.ok(c.elder && c.expect, c.id);
});
