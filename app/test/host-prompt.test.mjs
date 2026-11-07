import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import * as P from '../src/planner.js'; import { DEMO_PROFILE } from '../src/questions.js';
import { HOST_PROMPT, nextTurn } from '../server/ai.mjs';
const FW = JSON.parse(fs.readFileSync(new URL('../src/framework.json', import.meta.url)));
const md = fs.readFileSync(new URL('../../docs/interview.md', import.meta.url), 'utf8');
const styleMd = fs.readFileSync(new URL('../../docs/host-style.md', import.meta.url), 'utf8');
const style = styleMd.match(/```\n([\s\S]*?)```/)?.[1];
const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/host-cases.json', import.meta.url)));

test('实际访谈调用带上当前题组、低负担问法和使用前提', async t => {
  const environment = { OPENAI_API_KEY: 'unit-test-key', OPENAI_BASE_URL: 'https://test.invalid/v1', LLM_PROVIDER: 'openai' };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const nodeId = 'life-decision';
  const node = P.nodeById(FW, nodeId);
  const plan = P.planSession(FW, { profile: DEMO_PROFILE, request: { nodeId } });
  let requestText = '';
  const reply = {
    answer: { nodeId, depth: 2, note: '决定搬家', entities: [] },
    ask: { nodeId, depth: 2 }, emotion: '平静', action: '追问细节',
    say: '那次搬家先打包了什么？', done: false,
  };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body);
    requestText = body.messages?.map(m => m.content).join('\n') || body.contents[0].parts.map(p => p.text || '').join('\n');
    return Response.json(body.messages
      ? { choices: [{ message: { content: JSON.stringify(reply) } }] }
      : { candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] });
  });
  await nextTurn(DEMO_PROFILE, { plan, states: {}, entities: [], archive: {} },
    [{ q: '那次您是怎么拿定主意的？', clean: '我先跟家里商量了几次，后来决定搬家。' }], 'test-guide');
  assert.ok(requestText.includes(node.entry_condition));
  assert.ok(requestText.includes(node.gentle_question));
  for (const layer of node.layers) assert.ok(requestText.includes(layer.question));
});

test('实际系统提示词读入两份文档，保持精简', () => {
  assert.ok(style, '没有找到代码块');
  assert.equal(HOST_PROMPT, md.match(/```\n([\s\S]*?)```/)[1] + '\n' + style);
  assert.ok(HOST_PROMPT.length <= 2200, `系统提示词过长：${HOST_PROMPT.length} 字符`);
});
test('首次和再次问候都只有一句，结束语简短且不再提问', () => {
  const p = DEMO_PROFILE, plan = P.planSession(FW, { profile: p });
  const ctx = { profile: p, archive: { lastTopic: '骑车去瘦西湖，买桂花糕'.repeat(20) } };
  for (const isReturn of [false, true]) {
    const greeting = P.greetText(FW, plan, ctx, isReturn);
    assert.ok(greeting.includes(p.callName));
    assert.ok(greeting.length <= 25, greeting);
    assert.equal((greeting.match(/[。！？!?]/g) || []).length, 1, greeting);
    assert.ok(!/[？?]/.test(greeting));
  }
  const closing = P.closingText(FW, plan, ctx);
  assert.ok(closing.length <= 30, closing);
  assert.ok(!/[？?]/.test(closing), closing);
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
