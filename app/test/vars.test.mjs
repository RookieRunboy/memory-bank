import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import * as P from '../src/planner.js'; import { DEMO_PROFILE } from '../src/questions.js';
const FW = JSON.parse(fs.readFileSync(new URL('../src/framework.json', import.meta.url)));
const md = fs.readFileSync(new URL('../../docs/interview.md', import.meta.url), 'utf8');
const [HOST, STORY] = [...md.matchAll(/```\n([\s\S]*?)```/g)].map(m => m[1]);
const profiles = [DEMO_PROFILE, {}, { name: '张三' }];
const plans = p => [P.planSession(FW, { profile: p }), P.planSession(FW, { profile: p, request: { nodeId: 'youth-meet' } }), P.planSession(FW, { profile: p, request: { trigger: 'song' } })];

test('所有节点问题、触发开场语替换后无残留变量', () => { for (const p of profiles) for (const n of FW.nodes) {
  for (const d of [1, 2, 3, 4]) assert.deepEqual(P.leftoverVars(P.questionFor(FW, n.id, d, p)), [], `${n.id}:${d}`);
  for (const t of Object.keys(n.trigger_openers || {})) assert.deepEqual(P.leftoverVars(P.questionFor(FW, n.id, 1, p, t)), [], `${n.id}:${t}`);
  assert.deepEqual(P.leftoverVars(P.nodeTitle(FW, n.id, p)), []); } });
test('开场/结束语、主持人提示词替换后无残留变量', () => { for (const p of profiles) for (const plan of plans(p)) {
  const ctx = { profile: p }, v = P.planVars(FW, plan, ctx);
  for (const r of [false, true]) assert.deepEqual(P.leftoverVars(P.openingText(FW, plan, ctx, r)), []);
  assert.deepEqual(P.leftoverVars(P.closingText(FW, plan, ctx)), []);
  assert.deepEqual(P.leftoverVars(P.fillAll(STORY.replace('{转录文本}', '小忆：您好\n老人：好'), p, v)), []);
  assert.deepEqual(P.leftoverVars(P.fillAll(HOST.replace(/\{重要人物\}/g, p.people || ''), p, v)), []); } });
test('assertNoVars 遇到未替换变量会报错；speakable 去掉残留', () => {
  assert.throws(() => P.assertNoVars('您好，{称呼}'), /未替换的变量/); assert.equal(P.assertNoVars('您好'), '您好');
  assert.equal(P.leftoverVars(P.speakable('说说{当前话题}吧')).length, 0); });
test('选题：家人指定优先；敏感/需平静/缺前提的节点不选', () => {
  assert.equal(P.planSession(FW, { profile: DEMO_PROFILE, request: { nodeId: 'youth-meet' } }).nodes[0].nodeId, 'youth-meet');
  // 标记 sensitive 的节点不自动选；没填爱人/子女时跳过对应节点；needs_calm 不自动选
  const sens = { 'child-mother': { ...P.emptyState('child-mother'), depth: 1, sensitive: true, updatedAt: 1 } };
  let states = { ...sens };
  for (let i = 0; i < 25; i++) { const pl = P.planSession(FW, { profile: { name: '张三' }, states });
    for (const x of pl.nodes) { const n = P.nodeById(FW, x.nodeId); if (x.reason === 'revisit') continue;
      assert.notEqual(x.nodeId, 'child-mother'); assert.ok(!['spouse', 'children'].includes(n.tags.relation), x.nodeId); assert.ok(!n.needs_calm && !FW.planning.needs_calm.includes(n.id), x.nodeId);
      states[x.nodeId] = { ...P.emptyState(x.nodeId), enough: true, depth: 4, turns: 3, updatedAt: i }; } } });
test('顺藤摸瓜：上次提到的人会被接着聊', () => {
  const ents = [{ id: 'e1', type: 'person', name: '李建国', relation: 'spouse', sourceNodes: ['youth-meet'], lastSessionId: 's1', notes: [] }];
  const states = { 'youth-meet': { ...P.emptyState('youth-meet'), depth: 2, turns: 2, updatedAt: 1 } };
  const plan = P.planSession(FW, { profile: DEMO_PROFILE, states, entities: ents, lastSessionId: 's1', prevNodeId: 'youth-meet' });
  assert.equal(plan.nodes[0].reason, 'follow_entity'); assert.match(P.planVars(FW, plan, { profile: DEMO_PROFILE, states, entities: ents }).顺藤线索, /李建国/); });
test('跑题归档到对应节点', () => {
  const r = P.applyAnswer(FW, {}, { nodeId: 'youth-date', depth: 2, note: '看电影', short: false, emotion: '开心' }, 's1');
  assert.equal(r.states['youth-date'].depth, 2); });

test('今日话题只写当前选中，不预告第二个「还有…」', () => {
  const states = { 'youth-meet': { ...P.emptyState('youth-meet'), depth: 2, turns: 2, updatedAt: 1 } };
  const plan = P.planSession(FW, { profile: DEMO_PROFILE, states });
  assert.ok(plan.nodes.length >= 2, 'plan 内部仍可备两个节点');
  const v = P.planVars(FW, plan, { profile: DEMO_PROFILE, states });
  assert.equal(v.今天话题, P.nodeTitle(FW, plan.ask.nodeId, DEMO_PROFILE));
  assert.ok(!/，还有/.test(v.今天话题), v.今天话题);
  assert.equal(v.今天话题, v.当前话题);
});
test('没有线索可跟时只用轻松话题，不为补空白去推老人没提过的阶段', () => {
  const light = new Set(FW.planning.fallback_safe_nodes);
  const x = P.selectNode(FW, { profile: { name: '张三' }, states: {}, entities: [] });
  assert.equal(x.reason, 'light'); assert.ok(light.has(x.nodeId), x.nodeId);
  assert.equal(P.reasonText(FW, x, [], DEMO_PROFILE), '轻松话题');
  assert.equal(P.coverage, undefined, '不再统计覆盖度');
  assert.ok(!('time' in FW.dimensions), '年龄段不再是预设维度');
  assert.ok(FW.nodes.every(n => !('time' in n.tags)));
});
test('结束语不预告下次话题', () => {
  const plan = P.planSession(FW, { profile: DEMO_PROFILE });
  const t = P.closingText(FW, plan, { profile: DEMO_PROFILE });
  assert.ok(!('nextNodePreview' in plan)); assert.match(t, /下次想聊什么/); assert.ok(!/下次咱们聊聊/.test(t));
});
test('状态只记讲到哪：没有 status，旧数据 done 按聊够处理', () => {
  const r = P.applyAnswer(FW, {}, { nodeId: 'youth-date', depth: 2, note: '看电影', short: false, emotion: '开心' }, 's1');
  assert.ok(!('status' in r.states['youth-date'])); assert.equal(r.states['youth-date'].enough, false);
  assert.equal(P.st({ a: { enough: true, depth: 4, notes: [] } }, 'a').enough, true);
  const d = P.applyAnswer(FW, {}, { nodeId: 'youth-date', depth: 4, note: 'x', short: false, emotion: '开心' }, 's1');
  assert.equal(d.states['youth-date'].enough, true);
});
