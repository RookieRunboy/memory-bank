import test from 'node:test'; import assert from 'node:assert/strict';
import FW from '../src/framework.json' with { type: 'json' };
import * as P from '../src/planner.js'; import { DEMO_PROFILE } from '../src/questions.js';
const p = DEMO_PROFILE, base = { profile: p, states: {}, entities: [] };
const bad = new Set([...FW.planning.needs_calm]);
test('候选 3 个、维度错开、不重复', () => {
  const c = P.candidates(FW, base); assert.equal(c.length, 3); assert.equal(new Set(c.map(x => x.nodeId)).size, 3);
  const T = c.map(x => P.nodeById(FW, x.nodeId).tags); assert.ok(new Set(T.map(t => t.domain)).size >= 2);
  assert.ok(c.some(x => x.kind === 'light'), '要有一个轻松触发物类');
  for (const x of c) { assert.ok(x.text && !/\{/.test(x.text)); }
});
test('有上次线索：一个顺藤，其余是轻松话题', () => {
  const states = { 'youth-meet': { depth: 2, sessions: ['s1'] } };
  const entities = [{ name: '李建国', type: 'person', nodes: ['youth-meet'], mentions: 3, sessions: ['s1'] }];
  const c = P.candidates(FW, { profile: p, states, entities, lastSessionId: 's1' });
  assert.equal(c[0].kind, 'follow'); assert.ok(c.slice(1).every(x => x.kind === 'light'), c.map(x => x.kind).join());
});
test('避开敏感 / 需平静节点', () => {
  const states = { 'child-food': { depth: 0, sensitive: true } };
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
  assert.equal(pc(c[1].text).index, 1, '完整卡片名称可直接选择');
  assert.equal(pc('聊过年吧').nodeId ?? c[pc('聊过年吧').index].nodeId, 'child-newyear');
  assert.equal(pc('换几个').action, 'more'); assert.equal(pc('有没有别的').action, 'more');
  assert.equal(pc('都行').index, 0);
  assert.equal(pc('继续聊这个', { after: true }).action, 'stay'); assert.equal(pc('今天先到这吧', { after: true }).action, 'end');
});
test('初次邀请后想不到讲什么时留在选题，不误判成默认第一个',()=>{
  const cards=P.candidates(FW,base);
  for(const text of ['不知道说什么','一时想不到存什么','没想好','想不起什么事','想不起来了','一时想不起来','不知道该说些什么','不知道讲什么好'])assert.equal(P.parseChoice(FW,text,cards,p).action,'help',text);
  assert.equal(P.parseChoice(FW,'第二个吧',cards,p).index,1);
  assert.notEqual(P.parseChoice(FW,'想不起哪一年搬家了',cards,p).action,'help');
});
test('含糊回答和自然讲述交给主持人，不擅自选第一个', () => { const c = P.candidates(FW, base);
  assert.equal(P.parseChoice(FW, '', c, p).action, 'help');
  for (const text of ['嗯……', '啊？', '今天天气好', '小时候爱', '东西']) {
    const r = P.parseChoice(FW, text, c, p);
    assert.equal(r.action, 'discuss', text); assert.equal(r.index, undefined); assert.equal(r.nodeId, undefined);
  }
});
test('次数、日期和人物次序不是选题序号', () => {
  const cards = ['youth-wedding', 'child-food', 'teen-song'].map(nodeId => ({ nodeId, text: P.nodeTitle(FW, nodeId, p) }));
  for (const text of [
    'Ok，这次聊聊这次的。我年轻时候第一次参加的黑客松的比赛。',
    '哎，我是问，我是说的是。聊第一次参加黑客松比赛的经历吧。',
    '聊我第二次创业的经历', '聊我第三次搬家的事', '我第一次结婚的时候很紧张',
    '我第一个孙子出生那天', '我1号到的，2号才开始比赛', '比赛在三号楼举行',
  ]) {
    const r = P.parseChoice(FW, text, cards, p);
    assert.equal(r.action, 'discuss', text); assert.equal(r.index, undefined); assert.equal(r.nodeId, undefined);
  }
});
test('序号只在明确的整句选择中生效', () => {
  const cards = P.candidates(FW, base);
  for (const [text, index] of [['第一个吧', 0], ['就聊第二个', 1], ['第3个吧', 2], ['我选2号', 1], ['头一个', 0], ['最后一个', 2], ['中间那个', 1]]) {
    assert.deepEqual(P.parseChoice(FW, text, cards, p), { action: 'pick', index, sure: true }, text);
  }
});
test('题库词出现在完整故事里时保留故事，不截成选题', () => {
  const cards = P.candidates(FW, base);
  for (const text of [
    '我参加黑客松的时候做了一个东西，后来拿奖了',
    '小时候爱吃的东西，我最记得奶奶给我做的那一碗面',
    '聊参加黑客松比赛的经历吧', '我想讲第一次参加编程比赛的事',
    '后来换了几个工作，这次想聊我开的那家店',
    '小时候我累了就躺在奶奶旁边', '我说过都行，但是现在想聊比赛',
  ]) {
    assert.equal(P.parseChoice(FW, text, cards, p, { after: true }).action, 'discuss', text);
  }
});
test('明确的选题操作仍可直接执行', () => {
  const cards = P.candidates(FW, base);
  for (const [text, action] of [['换几个吧', 'more'], ['换几个话题吧', 'more'], ['再换几个话题吧', 'more'], ['有没有别的', 'more'], ['我自己讲', 'free'], ['想聊什么都行', 'free'], ['随便聊聊', 'free'], ['继续聊这个', 'stay'], ['今天先到这吧', 'end']]) {
    assert.equal(P.parseChoice(FW, text, cards, p, { after: true }).action, action, text);
  }
  assert.equal(P.parseChoice(FW, '都行', cards, p).index, 0, '明确让小忆选才可使用第一个建议');
  assert.equal(P.parseChoice(FW, '聊过年吧', cards, p).nodeId, 'child-newyear');
});
test('念出候选、问候无残留变量', () => { const c = P.candidates(FW, base), t = P.choiceText(c);
  assert.match(t, /今天想聊哪个？第一个，.+；第二个，.+；第三个，.+。/); assert.match(P.choiceText(c, { after: true }), /接着聊这个.*今天先到这/);
  const plan = P.planSession(FW, base); assert.doesNotThrow(() => P.greetText(FW, plan, base, false)); });

test('换卡多轮：今日话题不固定「…，还有妈妈」；轻松触发物优先', () => {
  const states = {
    'youth-meet': { ...P.emptyState('youth-meet'), depth: 2, turns: 2, updatedAt: 1 },
    'youth-date': { ...P.emptyState('youth-date'), depth: 3, turns: 3, updatedAt: 2 },
  };
  const seenTopics = [], motherAsSecond = [];
  let ex = [];
  for (let i = 0; i < 4; i++) {
    const cards = P.candidates(FW, { profile: p, states, exclude: ex });
    assert.equal(cards.length, 3);
    // 轻松触发物应出现；coverage/fresh 不应霸占第二张
    const kinds = cards.map(x => x.kind);
    assert.ok(kinds.includes('light') || cards.filter(x => x.kind === 'light').length >= 1 || kinds.filter(k => k === 'light').length >= 0);
    assert.ok(cards.some(x => x.kind === 'light'), '每组应有轻松触发物: ' + kinds.join(','));
    if (cards[1]?.nodeId === 'child-mother') motherAsSecond.push(i);
    for (const c of cards) {
      const plan = P.planSession(FW, { profile: p, states, request: { nodeId: c.nodeId } });
      // 老人自选可见：只看当前；vars 不拼「还有」
      const single = { ...plan, nodes: [plan.nodes[0]], ask: plan.ask };
      const v = P.planVars(FW, single, { profile: p, states });
      seenTopics.push(v.今天话题);
      assert.ok(!/，还有/.test(v.今天话题), v.今天话题);
      assert.equal(v.今天话题, P.nodeTitle(FW, c.nodeId, p));
    }
    ex.push(...cards.map(x => x.nodeId));
  }
  assert.ok(new Set(seenTopics).size >= 3, '换卡后今日话题应随所选变化: ' + seenTopics.join(' | '));
  assert.ok(motherAsSecond.length <= 1, '第二候选不应几乎每次都是妈妈: rounds ' + motherAsSecond.join(','));
  // 卡片 note 不出现“还没聊过”这类补空白文案
  for (let i = 0, e = []; i < 3; i++) {
    const cards = P.candidates(FW, { profile: p, states, exclude: e });
    for (const c of cards) assert.ok(!/还没聊过|补一补/.test(c.note || ''), c.note);
    e.push(...cards.map(x => x.nodeId));
  }
});
