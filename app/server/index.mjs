import express from 'express'; import multer from 'multer'; import initSqlJs from 'sql.js';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { status } from './gemini.mjs'; import * as ai from './ai.mjs'; import * as P from '../src/planner.js';
const dir = path.dirname(fileURLToPath(import.meta.url)), DATA = path.join(dir, 'data'), AUDIO = path.join(DATA, 'audio'), DBF = path.join(DATA, 'mb.sqlite');
fs.mkdirSync(AUDIO, { recursive: true });
const SQL = await initSqlJs(); const db = fs.existsSync(DBF) ? new SQL.Database(fs.readFileSync(DBF)) : new SQL.Database();
db.run(`create table if not exists elders(id text primary key, profile text, archive text, created int);
create table if not exists interviews(id text primary key, elder_id text, stage text, created int, turns text, opening text, finished int);
create table if not exists stories(id text primary key, elder_id text, interview_id text, created int, data text);
create table if not exists elder_state(elder_id text primary key, nodes text, entities text);`); // 话题网节点状态 + 实体表（每轮同步更新，不依赖后台档案）
const save = () => fs.writeFileSync(DBF, Buffer.from(db.export()));
const all = (q, p = []) => { const s = db.prepare(q); s.bind(p); const r = []; while (s.step()) r.push(s.getAsObject()); s.free(); return r; };
const one = (q, p) => all(q, p)[0];
const J = s => JSON.parse(s || 'null');
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const elder = id => { const e = one('select * from elders where id=?', [id]); return e && { id: e.id, profile: J(e.profile), archive: J(e.archive) || {} }; };
const iv = id => { const r = one('select * from interviews where id=?', [id]); return r && { ...r, turns: J(r.turns) || [], opening: J(r.opening) }; };

const app = express(); app.use(express.json({ limit: '2mb' }));
const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20e6 } });
import { gemini } from './gemini.mjs';
app.get('/api/health', async (_, res) => { if (status.ok === null) await gemini([{ text: '回复：好' }], { timeout: 10000 }).catch(() => {}); res.json({ gemini: { ok: status.ok, models: status.models, lastModel: status.lastModel, hasKey: status.hasKey, lastError: status.lastError } }); });
app.post('/api/elders', (req, res) => { const id = req.body.id || uid('e'); const old = elder(id);
  db.run('insert or replace into elders values(?,?,?,?)', [id, JSON.stringify(req.body.profile), JSON.stringify(old?.archive || {}), Date.now()]); save(); res.json(elder(id)); });
app.get('/api/elders/:id', (req, res) => { const e = elder(req.params.id); if (!e) return res.status(404).json({});
  e.interviews = all('select id,stage,created,turns,finished from interviews where elder_id=? order by created desc', [e.id]).map(r => ({ ...r, turns: J(r.turns) }));
  e.stories = all('select * from stories where elder_id=? order by created desc', [e.id]).map(s => ({ id: s.id, created: s.created, interview_id: s.interview_id, ...J(s.data) }));
  Object.assign(e, getState(e.id));
  e.archivePending = !!archiveJobs.get(e.id)?.pending.length;
  res.json(e); });
const getState = id => { const r = one('select * from elder_state where elder_id=?', [id]); return { states: J(r?.nodes) || {}, entities: J(r?.entities) || [] }; };
const setState = (id, x) => db.run('insert or replace into elder_state values(?,?,?)', [id, JSON.stringify(x.states), JSON.stringify(x.entities)]);
const lastDone = id => { const r = one('select id,opening from interviews where elder_id=? and finished=1 order by created desc limit 1', [id]); return r && { id: r.id, plan: J(r.opening)?.plan }; };
const makePlan = (e, request) => { const { states, entities } = getState(e.id), last = lastDone(e.id);
  return { states, entities, plan: { ...P.planSession(ai.FW, { profile: e.profile, states, entities, lastSessionId: last?.id, prevNodeId: last?.plan?.ask?.nodeId || last?.plan?.nodes?.[0]?.nodeId, request }), lastSessionId: last?.id || null } }; };
// 会话规划预览（家人页）：?nodeId= 或 ?trigger= 指定
app.get('/api/elders/:id/plan', (req, res) => { const e = elder(req.params.id); if (!e) return res.status(404).json({});
  const request = req.query.nodeId || req.query.trigger ? { nodeId: req.query.nodeId || null, trigger: req.query.trigger || null } : null;
  const { plan, states, entities } = makePlan(e, request);
  res.json({ plan, vars: P.planVars(ai.FW, plan, { profile: e.profile, states, entities }) }); });
app.post('/api/elders/:id/nodes/:nid/reset', (req, res) => { const x = getState(req.params.id); delete x.states[req.params.nid]; setState(req.params.id, x); save(); res.json({ ok: true }); }); // 家人手动重置
app.post('/api/interviews', async (req, res) => { const e = elder(req.body.elderId); if (!e) return res.status(404).json({});
  const p = e.profile;
  const isReturn = !!one('select id from interviews where elder_id=? and finished=1', [e.id]);
  // 档案还没整理完：最多等 3 秒，仍未完成就用档案里还没收录的上次访谈记录兜底（节点状态和实体表每轮已同步写入，不受影响）
  const job = archiveJobs.get(e.id); if (job) await Promise.race([job.promise, new Promise(r => setTimeout(r, 3000))]);
  const ea = elder(e.id).archive, done = new Set(ea.interviews || []);
  const recent = archiveJobs.get(e.id) ? all('select id,turns from interviews where elder_id=? and finished=1 order by created desc limit 1', [e.id]).filter(r => !done.has(r.id)).flatMap(r => J(r.turns)) : [];
  if (recent.length) console.log('[opening] 档案未更新完，用上次访谈记录兜底');
  const { plan, states, entities } = makePlan(e, req.body.request || null);
  const id = uid('i'); plan.sessionId = id;
  const t0 = Date.now(), o = await ai.opening(p, { archive: ea, states, entities, plan }, isReturn, recent);
  o.plan = plan; o.closing = ai.closing(p, { states, entities, plan });
  const topic = P.nodeTitle(ai.FW, plan.nodes[0].nodeId, p);
  console.log(`[opening] ${id} ${o.source} ${Date.now() - t0}ms plan=${plan.nodes.map(x => x.nodeId + '/' + x.reason).join(',')} next=${plan.nextNodePreview.nodeId}`);
  db.run('insert into interviews values(?,?,?,?,?,?,0)', [id, e.id, topic, Date.now(), '[]', JSON.stringify(o)]); save();
  res.json({ id, ...o, isReturn, topic }); });
app.post('/api/interviews/:id/turn', up.single('audio'), async (req, res) => { const v = iv(req.params.id); if (!v) return res.status(404).json({});
  const e = elder(v.elder_id), p = e.profile, o = v.opening;
  let audio = null; if (req.file?.size > 0) { audio = `${v.id}-${v.turns.length}.${(req.file.mimetype || '').includes('mp4') ? 'm4a' : 'webm'}`; fs.writeFileSync(path.join(AUDIO, audio), req.file.buffer); }
  const t0 = Date.now();
  const tr = req.body.manual ? { raw: req.body.manual, clean: req.body.manual, source: 'manual' } : await ai.transcribe(req.file?.buffer, req.file?.mimetype, req.body.browserText);
  const ask = o.plan.ask;
  v.turns.push({ q: req.body.question, qid: `${ask.nodeId}:${ask.depth}`, ask, raw: tr.raw, clean: tr.clean, audio, at: Date.now(), asrSource: tr.source });
  const st = getState(e.id);
  const t1 = Date.now(); const n = await ai.nextTurn(p, { archive: e.archive, ...st, plan: o.plan }, v.turns, v.id); const t2 = Date.now();
  console.log(`[turn] ${v.id}#${v.turns.length} asr=${t1 - t0}ms(${tr.source}) agent=${t2 - t1}ms(${n.source}) total=${t2 - t0}ms node=${n.analysis.nodeId} depth=${n.analysis.depth}${n.analysis.nodeId !== ask.nodeId ? '（跑题归档）' : ''} ents=${(n.analysis.entities || []).map(x => x.name).join('/')} → ask=${n.plan.ask.nodeId}:${n.plan.ask.depth}${n.done ? ' done' : ''}`);
  v.turns.at(-1).analysis = n.analysis; v.turns.at(-1).agent = { emotion: n.emotion, action: n.action, source: n.source };
  setState(e.id, { states: n.states, entities: n.entities }); o.plan = n.plan; o.closing = ai.closing(p, { states: n.states, entities: n.entities, plan: n.plan });
  db.run('update interviews set turns=?, opening=? where id=?', [JSON.stringify(v.turns), JSON.stringify(o), v.id]); save();
  res.json({ transcript: tr, next: { emotion: n.emotion, action: n.action, say: n.say, done: n.done, source: n.source, analysis: n.analysis, ask: n.plan.ask }, closing: o.closing }); });
// 记忆档案后台更新：同一位老人串行，不阻塞故事页
const archiveJobs = new Map(); // elderId -> { promise, since, pending: [interviewId] }
function queueArchive(eid, v, p) {
  const prev = archiveJobs.get(eid), job = prev || { since: Date.now(), pending: [] }; job.pending.push(v.id);
  job.promise = (prev?.promise || Promise.resolve()).then(async () => { const t0 = Date.now(), e = elder(eid);
    const a = await ai.updateArchive(p, e.archive, v.turns, v.stage).catch(() => null);
    if (a) { a.interviews = [...(e.archive.interviews || []), v.id]; db.run('update elders set archive=? where id=?', [JSON.stringify(a), eid]); save(); }
    console.log(`[archive] ${v.id} ${a?.source || 'error'} ${Date.now() - t0}ms（后台，自结束起 ${Date.now() - v.finishedAt}ms）`);
    job.pending = job.pending.filter(x => x !== v.id); if (!job.pending.length) archiveJobs.delete(eid); });
  archiveJobs.set(eid, job);
}
app.post('/api/interviews/:id/finish', async (req, res) => { const v = iv(req.params.id); if (!v) return res.status(404).json({});
  const e = elder(v.elder_id), p = { ...e.profile, stage: v.stage };
  if (!v.turns.length) { db.run('update interviews set finished=1 where id=?', [v.id]); save(); return res.json({ storyId: null }); }
  const tf = v.finishedAt = Date.now();
  db.run('update interviews set finished=1 where id=?', [v.id]); save();
  queueArchive(e.id, v, p);
  const s = await ai.story(p, v.turns);
  console.log(`[story] ${v.id} ${s.source} ${Date.now() - tf}ms`);
  const sid = uid('s'); db.run('insert into stories values(?,?,?,?,?)', [sid, e.id, v.id, Date.now(), JSON.stringify({ ...s, stage: v.stage, clips: v.turns.map(t => ({ q: t.q, text: t.clean, audio: t.audio })) })]); save();
  res.json({ storyId: sid }); });
app.get('/api/stories/:id', (req, res) => { const s = one('select * from stories where id=?', [req.params.id]); s ? res.json({ id: s.id, created: s.created, elder: elder(s.elder_id).profile, ...J(s.data) }) : res.status(404).json({}); });
app.use('/api/audio', express.static(AUDIO));
app.listen(8787, () => console.log('memory-bank api on :8787, gemini key', status.hasKey ? 'present' : 'missing'));
