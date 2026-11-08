// 公开生平为骨架、对白为虚构的演示数据。原始 JSON 是唯一内容源。
// 仅插入缺失的演示讲述者，不覆盖用户资料，不升级重灌不可变访谈稿。
import fs from 'node:fs';
import * as P from '../src/planner.js';

export const DEMO_ID = 'demo-hanchun';
export const SEED_VERSION = 1;
const root = new URL('../../demo-data/fancheng-hanchun/', import.meta.url);
const read = name => JSON.parse(fs.readFileSync(new URL(name, root), 'utf8'));
const FW = JSON.parse(fs.readFileSync(new URL('../src/framework.json', import.meta.url), 'utf8'));
const disclosure = '范成采访寒春的虚构演示；依公开生平创作，不是真实访谈或本人原话。';
const metadata = { source: 'demo-scripted', fictional: true, processing: '预写并审核的 mock 加工成果，未调用运行时模型生成', disclosure };

export function buildFanchengDemo() {
  const user = read('user.json'), profile = read('profile.json');
  const sessions = fs.readdirSync(new URL('sessions/', root)).filter(n => /^\d\d-.*\.json$/.test(n)).sort().map(n => read('sessions/' + n));
  if (sessions.length !== 6) throw Error('寒春演示需要完整的 6 场访谈');
  const archive = { people: [], places: [], events: [], timeline: [], conflicts: [], interviews: [], asked: [], lastTopic: '', ...metadata, seedVersion: SEED_VERSION, interviewer: user };
  let states = {}, entities = [], previous = null;
  const interviews = [], transcript = [], stories = [], history = [];
  const knownIds = new Set();
  for (const [si, s] of sessions.entries()) {
    if (knownIds.has(s.id) || !Number.isFinite(Date.parse(s.recordedAt))) throw Error('重复访谈或无效日期：' + s.id);
    knownIds.add(s.id);
    const start = Date.parse(s.recordedAt);
    const plan = { ...P.planSession(FW, { profile, states, entities, lastSessionId: previous, request: { nodeId: s.node }, sessionId: s.id }), lastSessionId: previous, createdAt: start };
    let at = start;
    const turns = s.turns.map((a, k) => {
      if (!P.nodeById(FW, a.node) || !P.nodeById(FW, a.ask[0]) || a.d < 1 || a.d > 4) throw Error('无效话题：' + s.id);
      const id = `${s.id}-t${k + 1}`;
      const turn = { id, q: a.q, qid: a.ask.join(':'), ask: { nodeId: a.ask[0], depth: a.ask[1] }, raw: a.raw, clean: a.a, audio: null, at,
        interviewer: user.name, speaker: profile.name, asrSource: 'demo-scripted', fictional: true, timingSource: 'estimated-script-timing', fictionalDetails: a.fictionalDetails || [],
        analysis: { nodeId: a.node, depth: a.d, note: a.note, entities: a.ent },
        agent: { emotion: a.emo, action: k === s.turns.length - 1 ? '收尾' : '追问细节', source: 'demo-scripted' } };
      states = P.applyAnswer(FW, states, { nodeId: a.node, depth: a.d, note: a.note, short: false, emotion: a.emo }, s.id).states;
      states[a.node].updatedAt = at;
      entities = P.mergeEntities(entities, a.ent, a.node, s.id);
      for (const e of entities) if (a.ent.some(x => x.type === e.type && x.name === e.name)) e.sourceTurns = [...new Set([...(e.sourceTurns || []), id])];
      archive.asked.push(turn.qid);
      transcript.push({ id, interview_id: s.id, elder_id: DEMO_ID, idx: k + 1, data: { ...turn, question: a.q, idx: k + 1, nodeId: a.node, depth: a.d, emotion: a.emo, note: a.note, askedNode: a.ask[0], askedDepth: a.ask[1] } });
      // 供未来真人配音排练，非测得时长，不提供伪造音频。
      at += Math.round((a.q.length + a.raw.length) * 280 + 4000);
      return turn;
    });
    plan.ask = turns.at(-1).ask; plan.done = true;
    interviews.push({ id: s.id, elder_id: DEMO_ID, stage: s.title, created: start, turns, finished: 1,
      opening: { say: turns[0].q, plan, closing: s.closing, phase: 'chat', interviewer: s.interviewer || { id: user.id, name: user.name }, narrator: s.narrator,
        fullAudio: null, fullSegments: [], historicalPeriod: s.historicalPeriod, sourceRefs: s.sourceRefs || [], recordedAtMeaning: '模拟排期，不是真实采访日期', endedAt: at, ...metadata } });
    const resolve = refs => {
      if (!refs?.length || refs.some(n => !Number.isInteger(n) || n < 1 || n > turns.length)) throw Error('出处轮次不合法：' + s.id);
      return refs.map(n => turns[n - 1].id);
    };
    for (const category of ['people', 'places', 'events', 'timeline']) {
      const key = x => category === 'timeline' ? x.when + ':' + x.what : x.name || x.title;
      for (const item of s.arch[category] || []) {
        const { from, ...value } = item, old = archive[category].find(x => key(x) === key(value));
        const refs = resolve(from);
        if (old) {
          old.sourceTurns = [...new Set([...old.sourceTurns, ...refs])];
          if (value.note && !old.note.includes(value.note)) old.note += '；' + value.note;
        } else archive[category].push({ ...value, sourceTurns: refs, fictional: true });
      }
    }
    archive.conflicts.push(...(s.arch.conflicts || []));
    archive.interviews.push(s.id); archive.lastTopic = s.arch.lastTopic; archive.updatedAt = at;
    const paras = s.story.paras.map(p => ({ text: p.t, refs: resolve(p.from) }));
    const sid = `s-fancheng-${si + 1}`;
    stories.push({ id: sid, elder_id: DEMO_ID, interview_id: s.id, created: at + 60000, data: {
      title: s.story.title, body: paras.map(p => p.text).join('\n\n'), people: s.story.people, timePlace: s.story.timePlace, quotes: s.story.quotes,
      paras, clips: turns.map(t => ({ id: t.id, q: t.q, text: t.clean, audio: null })), stage: s.title, interviewer: user.name, speaker: profile.name, ...metadata } });
    history.push({ id: s.id, userId: user.id, interviewer: user.name, narratorId: DEMO_ID, narrator: profile.name, title: s.title, historicalPeriod: s.historicalPeriod,
      scheduledAt: s.recordedAt, dateMeaning: '演示排期', turns: turns.length, estimatedDurationSeconds: (at - start) / 1000, status: 'completed', storyId: sid, summary: s.summary, audioStatus: 'not-recorded', ...metadata });
    previous = s.id;
  }
  const year = item => +(item.when.match(/(?:19|20)\d{2}/)?.[0] || 9999);
  archive.timeline.sort((a, b) => year(a) - year(b));
  return { schemaVersion: 1, user, elder: { id: DEMO_ID, profile, archive, created: interviews[0].created - 3600000 }, sessions, interviews, transcript, stories, states, entities, history, ...metadata };
}

export function seedFancheng({ db }) {
  const exists = db.prepare('select id from elders where id=?');
  exists.bind([DEMO_ID]); const present = exists.step(); exists.free();
  if (present) return false;
  const data = buildFanchengDemo();
  db.run('begin');
  try {
    db.run('insert into elders values(?,?,?,?)', [DEMO_ID, JSON.stringify(data.elder.profile), JSON.stringify(data.elder.archive), data.elder.created]);
    for (const i of data.interviews) db.run('insert into interviews values(?,?,?,?,?,?,?)', [i.id, DEMO_ID, i.stage, i.created, JSON.stringify(i.turns), JSON.stringify(i.opening), i.finished]);
    for (const t of data.transcript) db.run('insert into transcript_turns values(?,?,?,?,?)', [t.id, t.interview_id, DEMO_ID, t.idx, JSON.stringify(t.data)]);
    for (const s of data.stories) db.run('insert into stories values(?,?,?,?,?)', [s.id, DEMO_ID, s.interview_id, s.created, JSON.stringify(s.data)]);
    db.run('insert into elder_state values(?,?,?)', [DEMO_ID, JSON.stringify(data.states), JSON.stringify(data.entities)]);
    db.run('commit'); return true;
  } catch (error) { db.run('rollback'); throw error; }
}
