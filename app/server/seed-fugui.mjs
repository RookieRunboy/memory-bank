// 徐先生演示数据装配（虚构，路演用）：人物原型取自余华《活着》里的福贵，对话与故事均为自编，不引用原书文字。
// 内容在 seed-fugui-data.mjs；这里只负责按真实流程写库：开场/收尾由 planner 生成，实体和话题状态逐轮累积，
// 故事每段的出处句子按 data 里标的轮次对应，本人改过的标题同时写入 edits 留痕（前端“修改记录”显示改前的值）。
import { PROFILE, SESSIONS } from './seed-fugui-data.mjs';
export const FUGUI_ID = 'demo-fugui';
export const FUGUI_PROFILE = PROFILE;
export const SEED_VERSION = 3; // 内容升级时加一，启动时会重灌徐先生（只动 demo-fugui）

const mergeBy = (arr, add, key) => { for (const x of add || []) { const i = arr.findIndex(y => key(y) === key(x)); if (i < 0) arr.push({ ...x }); else arr[i] = { ...arr[i], ...x }; } };

export async function seedFugui({ db, ai, P }) {
  const FW = ai.FW, p = { ...PROFILE }, now = Date.now();
  let states = {}, entities = [], prev = null;
  const arch = { people: [], places: [], events: [], timeline: [], conflicts: [], lastTopic: '' }, asked = [];
  const when = S => { const d = new Date(now - S.daysAgo * 864e5); d.setHours(S.hm[0], S.hm[1], 0, 0); return d.getTime(); };
  db.run('insert into elders values(?,?,?,?)', [FUGUI_ID, JSON.stringify(p), '{}', when(SESSIONS[0]) - 3600e3]);

  SESSIONS.forEach((S, si) => {
    const t0 = when(S), plan = { ...P.planSession(FW, { profile: p, states, entities, lastSessionId: prev, request: { nodeId: S.node } }), sessionId: S.id, lastSessionId: prev };
    // 顺藤线索：把 S.clue 对应的实体排到最前，openingText 取“上次访谈里的第一个实体”
    const ctxEnt = [...entities.filter(e => e.name === S.clue), ...entities.filter(e => e.name !== S.clue)];
    const opening = P.openingText(FW, { ...plan, nodes: plan.nodes.map(n => ({ ...n, entity: null })) }, { profile: p, states, entities: ctxEnt }, si > 0); // 去掉选题带的 entity，开场只接 S.clue

    let at = t0;
    const turns = S.turns.map((a, k) => {
      const id = `${S.id}-t${k + 1}`, q = k ? a.q : opening;
      states = P.applyAnswer(FW, states, { nodeId: a.node, depth: a.d, note: a.note, short: false, emotion: a.emo, leave: a.leave || null }, S.id).states;
      entities = P.mergeEntities(entities, a.ent, a.node, S.id);
      const names = new Set(a.ent.map(x => x.name));
      for (const x of entities) if (names.has(x.name)) x.sourceTurns = [...new Set([...(x.sourceTurns || []), id])];
      at += k ? 30000 + a.a.length * 420 : 0; // 回答越长，间隔越久
      asked.push(a.ask.join(':'));
      return { id, q, qid: a.ask.join(':'), ask: { nodeId: a.ask[0], depth: a.ask[1] }, raw: a.raw || a.a, clean: a.a, audio: null, at, asrSource: 'demo',
        analysis: { nodeId: a.node, depth: a.d, note: a.note, entities: a.ent }, agent: { emotion: a.emo, action: a.leave ? '收尾' : a.emo === '难过' ? '安抚' : a.emo === '卡壳' ? '给台阶' : '追问细节', source: 'demo' } };
    });
    plan.ask = { nodeId: S.turns.at(-1).ask[0], depth: 4 }; plan.done = true;
    const closing = P.closingText(FW, plan, { profile: p, states, entities });
    db.run('insert into interviews values(?,?,?,?,?,?,1)', [S.id, FUGUI_ID, P.nodeTitle(FW, S.node, p), t0, JSON.stringify(turns), JSON.stringify({ say: opening, source: 'demo', plan, closing })]);
    turns.forEach((t, k) => db.run('insert into transcript_turns values(?,?,?,?,?)', [t.id, S.id, FUGUI_ID, k + 1, JSON.stringify({ id: t.id, idx: k + 1, at: t.at, question: t.q, raw: t.raw, clean: t.clean, audio: null, asrSource: 'demo',
      nodeId: t.analysis.nodeId, depth: t.analysis.depth, emotion: t.agent.emotion, note: t.analysis.note, askedNode: t.ask.nodeId, askedDepth: t.ask.depth })]));

    // 档案：逐次并入
    mergeBy(arch.people, S.arch.people, x => x.name); mergeBy(arch.places, S.arch.places, x => x.name);
    mergeBy(arch.events, S.arch.events, x => x.title); mergeBy(arch.timeline, S.arch.timeline, x => x.when + x.what);
    for (const c of S.arch.conflicts || []) if (!arch.conflicts.includes(c)) arch.conflicts.push(c);
    arch.lastTopic = S.arch.lastTopic;

    // 故事：每段出处按 from 轮次对应；edit 表示本人事后改过其中一段
    const st = S.story, tAt = at + 90000;
    const cur = st.paras.map(x => x.t), body = cur.join('\n\n');
    const paras = st.paras.map(x => ({ text: x.t, refs: x.from.map(n => `${S.id}-t${n}`) }));
    const sid = `s-fugui-${si + 1}`;
    db.run('insert into stories values(?,?,?,?,?)', [sid, FUGUI_ID, S.id, tAt, JSON.stringify({ title: st.title, body, people: st.people, timePlace: st.timePlace, quotes: st.quotes,
      source: 'demo', stage: P.nodeTitle(FW, S.node, p), paras, clips: turns.map(t => ({ id: t.id, q: t.q, text: t.clean, audio: null })) })]);
    if (st.edit) db.run('insert into edits values(?,?,?,?,?,?,?,?,?)', [`x-fugui-${si + 1}`, FUGUI_ID, 'story', sid, st.edit.field, st.edit.was, st[st.edit.field], st.edit.by, tAt + st.edit.daysLater * 864e5]);
    prev = S.id;
  });
  db.run('update elders set archive=? where id=?', [JSON.stringify({ ...arch, interviews: SESSIONS.map(s => s.id), asked, updatedAt: now, source: 'demo', seedVersion: SEED_VERSION }), FUGUI_ID]);
  db.run('insert or replace into elder_state values(?,?,?)', [FUGUI_ID, JSON.stringify(states), JSON.stringify(entities)]);
}
