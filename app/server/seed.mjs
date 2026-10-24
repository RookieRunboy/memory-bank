// 王女士演示数据（虚构，路演用）：一次已完成的访谈，供第二次访谈接续开场
import { DEMO_PROFILE, DEMO_ANSWERS } from '../src/questions.js';
export const DEMO_ID = 'demo-wang';
export async function seedDemo({ db, ai, P }) {
  const FW = ai.FW, p = { ...DEMO_PROFILE }, iid = 'i-demo-1', t0 = Date.now() - 86400000;
  const A = [ // 每句回答的节点/层次/情绪/实体（与 nextTurn 输出同结构）
    { ask: ['youth-meet', 1], nodeId: 'youth-meet', depth: 1, emotion: '平静', note: '在纺织厂认识，他是修机器的', entities: [{ type: 'person', name: '李建国', aliases: ['老李', '李先生'], relation: 'spouse', deceased: true, note: '纺织厂修机器的，一身机油味' }, { type: 'place', name: '扬州纺织厂', note: '相识的地方' }] },
    { ask: ['youth-meet', 2], nodeId: 'youth-meet', depth: 2, emotion: '开心', note: '见面脸一红就不会说话', entities: [{ type: 'person', name: '李建国', note: '见面脸一红不会说话' }] },
    { ask: ['youth-meet', 3], nodeId: 'youth-date', depth: 2, emotion: '卡壳', note: '骑自行车带我去瘦西湖', entities: [{ type: 'place', name: '瘦西湖', note: '谈对象时常去' }, { type: 'thing', name: '自行车', note: '他骑车带我' }] },
    { ask: ['youth-date', 2], nodeId: 'youth-date', depth: 3, emotion: '难过', note: '春天柳树都绿了；他走了好多年', entities: [{ type: 'person', name: '李建国', deceased: true, note: '走了好多年' }] },
    { ask: ['youth-date', 3], nodeId: 'youth-date', depth: 3, emotion: '开心', note: '一包桂花糕，跟我一样甜', entities: [{ type: 'thing', name: '桂花糕', trigger: 'food', note: '他说扬州最甜的就是这个' }] }];
  const plan = { ...P.planSession(FW, { profile: p, request: { nodeId: 'youth-meet' } }), sessionId: iid, lastSessionId: null };
  let states = {}, entities = [];
  const opening = P.openingText(FW, plan, { profile: p }, false);
  const turns = A.map((a, k) => { const id = `${iid}-t${k + 1}`, q = k ? P.questionFor(FW, a.ask[0], a.ask[1], p) : opening;
    states = P.applyAnswer(FW, states, { nodeId: a.nodeId, depth: a.depth, note: a.note, short: false, emotion: a.emotion }, iid).states;
    entities = P.mergeEntities(entities, a.entities, a.nodeId, iid);
    const names = new Set(a.entities.map(x => x.name)); for (const x of entities) if (names.has(x.name)) x.sourceTurns = [...new Set([...(x.sourceTurns || []), id])];
    return { id, q, qid: a.ask.join(':'), ask: { nodeId: a.ask[0], depth: a.ask[1] }, raw: DEMO_ANSWERS[k], clean: DEMO_ANSWERS[k], audio: null, at: t0 + k * 60000, asrSource: 'demo',
      analysis: { nodeId: a.nodeId, depth: a.depth, note: a.note, entities: a.entities }, agent: { emotion: a.emotion, action: '追问细节', source: 'demo' } }; });
  plan.ask = { nodeId: 'youth-date', depth: 4 }; plan.done = true;
  const archive = { ...(await ai.updateArchive(p, {}, turns, '相识', { offline: true })), interviews: [iid] };
  db.run('insert into elders values(?,?,?,?)', [DEMO_ID, JSON.stringify(p), JSON.stringify(archive), t0]);
  db.run('insert into interviews values(?,?,?,?,?,?,1)', [iid, DEMO_ID, P.nodeTitle(FW, 'youth-meet', p), t0, JSON.stringify(turns), JSON.stringify({ say: opening, source: 'demo', plan, closing: P.closingText(FW, plan, { profile: p }) })]);
  turns.forEach((t, k) => db.run('insert into transcript_turns values(?,?,?,?,?)', [t.id, iid, DEMO_ID, k + 1, JSON.stringify({ id: t.id, idx: k + 1, at: t.at, question: t.q, raw: t.raw, clean: t.clean, audio: null, asrSource: 'demo', nodeId: t.analysis.nodeId, depth: t.analysis.depth, emotion: t.agent.emotion, note: t.analysis.note, askedNode: t.ask.nodeId, askedDepth: t.ask.depth })]));
  db.run('insert or replace into elder_state values(?,?,?)', [DEMO_ID, JSON.stringify(states), JSON.stringify(entities)]);
  const s = ai.DEMO_STORY, bg = x => { const c = x.replace(/[\s，。,.！!？?…、“”"]/g, ''), r = new Set(); for (let i = 0; i < c.length - 1; i++) r.add(c.slice(i, i + 2)); return r; };
  const paras = s.body.split(/\n+/).filter(Boolean).map(text => { const b = bg(text); return { text, refs: turns.map(t => ({ id: t.id, n: [...b].filter(x => bg(t.clean).has(x)).length / Math.max(1, Math.min(b.size, bg(t.clean).size)) })).filter(x => x.n >= 0.25).sort((a, c) => c.n - a.n).slice(0, 2).map(x => x.id) }; });
  db.run('insert into stories values(?,?,?,?,?)', ['s-demo-1', DEMO_ID, iid, t0 + 400000, JSON.stringify({ ...s, source: 'demo', stage: P.nodeTitle(FW, 'youth-meet', p), paras, clips: turns.map(t => ({ id: t.id, q: t.q, text: t.clean, audio: null })) })]);
}
