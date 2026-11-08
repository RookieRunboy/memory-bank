import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import * as P from '../src/planner.js'; import { DEMO_PROFILE } from '../src/questions.js';
import { HOST_PROMPT, nextTurn, opening, chooseTopic } from '../server/ai.mjs';
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
test('首次和再次用约定的存记忆开场，结束语不再提问', () => {
  const p = DEMO_PROFILE, plan = P.planSession(FW, { profile: p });
  const ctx = { profile: p, archive: { lastTopic: '骑车去瘦西湖，买桂花糕'.repeat(20) } };
  for (const isReturn of [false, true]) {
    const greeting = P.greetText(FW, plan, ctx, isReturn);
    assert.ok(greeting.includes(p.callName));
    assert.equal(greeting, `${p.callName}，这次打算往记忆银行里边存点什么？`);
    assert.equal((greeting.match(/[。！？!?]/g) || []).length, 1, greeting);
    assert.ok(/[？?]$/.test(greeting));
  }
  const closing = P.closingText(FW, plan, ctx);
  assert.ok(closing.length <= 30, closing);
  assert.ok(!/[？?]/.test(closing), closing);
});
test('固定开场无需模型调用；想不到存什么时只给轻提示，不擅自选题', async t => {
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('must not call model');});
  const p={...DEMO_PROFILE,callName:'徐先生'},plan=P.planSession(FW,{profile:p}),ctx={plan,states:{},entities:[],archive:{}};
  const o=await opening(p,ctx,true);
  assert.equal(o.say,'徐先生，这次打算往记忆银行里边存点什么？');assert.equal(o.source,'template');
  assert.deepEqual(o.ask,plan.ask);
  const cards=P.candidates(FW,{profile:p});
  assert.equal((await chooseTopic(p,cards,'一时想不到存什么')).action,'help');
  assert.equal(calls,0);
  assert.equal(P.OPENING_NUDGE,'一件小事，或一个刚想起的人，都行。');
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

test('自选话题优先于默认题库，纠正话题不触发无关候选', async t => {
  const old = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, LLM_PROVIDER: process.env.LLM_PROVIDER };
  Object.assign(process.env, { OPENAI_API_KEY: 'topic-test', LLM_PROVIDER: 'openai' });
  t.after(() => { for (const [k, v] of Object.entries(old)) v === undefined ? delete process.env[k] : process.env[k] = v; });
  const plan = P.planSession(FW, { profile: DEMO_PROFILE, request: { nodeId: 'youth-wedding' } });
  const statement = '哎，我是说的是。聊第一次参加黑客松比赛的经历吧。';
  let prompt = '';
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body); prompt = body.messages.map(m => m.content).join('\n');
    return Response.json({ choices: [{ message: { content: JSON.stringify({ ask: { nodeId: 'switch', depth: 1 }, answer: { nodeId: 'youth-wedding', depth: 0, entities: [] }, say: '好，那咱们换个话题。', done: false, action: '换话题' }) } }] });
  });
  const r = await nextTurn(DEMO_PROFILE, { plan, states: {}, entities: [], archive: {} }, [{ q: '结婚那天，您先想到哪个场面？', clean: statement }], 'correction');
  assert.equal(r.switch, false, 'explicitly named subject is not a request for candidate topics');
  assert.doesNotMatch(r.say, /换个话题|结婚|煤炉|家具/);
  assert.ok(prompt.includes(statement));
  assert.match(prompt, /纠正.*直接跟进|直接跟进.*纠正/);
});

test('自由讲述不把默认婚礼题组塞进请求，模型失败也不跳去下一题', async t => {
  const old = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, LLM_PROVIDER: process.env.LLM_PROVIDER };
  Object.assign(process.env, { OPENAI_API_KEY: 'topic-test', LLM_PROVIDER: 'openai' });
  t.after(() => { for (const [k, v] of Object.entries(old)) v === undefined ? delete process.env[k] : process.env[k] = v; });
  const plan = { ...P.planSession(FW, { profile: DEMO_PROFILE, request: { nodeId: 'youth-wedding' } }), free: true };
  let prompt = '';
  t.mock.method(globalThis, 'fetch', async (_url, options) => { prompt = JSON.parse(options.body).messages.map(m => m.content).join('\n'); throw Error('fixture provider unavailable'); });
  const r = await nextTurn(DEMO_PROFILE, { plan, states: {}, entities: [], archive: {} }, [{ q: '想聊点什么？', clean: '我想聊第一次参加黑客松比赛。' }], 'free-failure');
  assert.equal(r.switch, false); assert.equal(r.plan.free, true);
  assert.deepEqual(r.states, {}, 'provider outage must not file hackathon under the stale wedding node');
  assert.equal(r.analysis.nodeId, null);
  assert.deepEqual(r.plan.ask, plan.ask);
  assert.doesNotMatch(r.say, /结婚|婚礼|家具|煤炉|换个话题/);
  assert.match(r.say, /没接上|稍等|连接/);
  assert.doesNotMatch(prompt, /结婚那天，您先想到哪个场面/);
});

test('题库外的故事不被强行记到默认婚礼节点', async t => {
  const old = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, LLM_PROVIDER: process.env.LLM_PROVIDER };
  Object.assign(process.env, { OPENAI_API_KEY: 'topic-test', LLM_PROVIDER: 'openai' });
  t.after(() => { for (const [k, v] of Object.entries(old)) v === undefined ? delete process.env[k] : process.env[k] = v; });
  const plan = { ...P.planSession(FW, { profile: DEMO_PROFILE, request: { nodeId: 'youth-wedding' } }), free: true };
  t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{ message: { content: JSON.stringify({ ask: { nodeId: 'youth-wedding', depth: 1 }, answer: { nodeId: null, depth: 1, note: '第一次参加黑客松', entities: [] }, say: '那次比赛，您做了什么项目？', done: false }) } }] }));
  const r = await nextTurn(DEMO_PROFILE, { plan, states: {}, entities: [], archive: {} }, [{ q: '想聊什么？', clean: '第一次参加黑客松比赛。' }], 'unclassified');
  assert.equal(r.analysis.nodeId, null); assert.deepEqual(r.states, {});
  assert.equal(r.analysis.note, '第一次参加黑客松');
});

test('自由讲述模型失败时不把队友的他推断成旧话题里的配偶，明确名字仍保留', async t => {
  const old = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, LLM_PROVIDER: process.env.LLM_PROVIDER };
  Object.assign(process.env, { OPENAI_API_KEY: 'topic-test', LLM_PROVIDER: 'openai' });
  t.after(() => { for (const [k, v] of Object.entries(old)) v === undefined ? delete process.env[k] : process.env[k] = v; });
  t.mock.method(globalThis, 'fetch', async () => { throw Error('fixture provider unavailable'); });
  const plan = { ...P.planSession(FW, { profile: DEMO_PROFILE, request: { nodeId: 'youth-wedding' } }), free: true };
  const run = clean => nextTurn(DEMO_PROFILE, { plan, states: {}, entities: [], archive: {} }, [{ q: '队友怎么分工？', clean }], 'free-pronoun');
  const pronoun = await run('他负责写前端，我负责写后端。');
  assert.deepEqual(pronoun.analysis.entities, []); assert.deepEqual(pronoun.entities, []);
  const named = await run('后来李建国也来看了比赛。');
  assert.ok(named.analysis.entities.some(e => e.name === '李建国'));
  assert.ok(named.entities.some(e => e.name === '李建国'));
  assert.equal(named.analysis.nodeId, null);
});
