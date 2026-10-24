import express from 'express'; import multer from 'multer'; import initSqlJs from 'sql.js';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { status } from './gemini.mjs'; import * as ai from './ai.mjs';
const dir = path.dirname(fileURLToPath(import.meta.url)), DATA = path.join(dir, 'data'), AUDIO = path.join(DATA, 'audio'), DBF = path.join(DATA, 'mb.sqlite');
fs.mkdirSync(AUDIO, { recursive: true });
const SQL = await initSqlJs(); const db = fs.existsSync(DBF) ? new SQL.Database(fs.readFileSync(DBF)) : new SQL.Database();
db.run(`create table if not exists elders(id text primary key, profile text, archive text, created int);
create table if not exists interviews(id text primary key, elder_id text, stage text, created int, turns text, opening text, finished int);
create table if not exists stories(id text primary key, elder_id text, interview_id text, created int, data text);`);
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
  e.archivePending = !!archiveJobs.get(e.id)?.pending.length;
  res.json(e); });
app.post('/api/interviews', async (req, res) => { const e = elder(req.body.elderId); if (!e) return res.status(404).json({});
  const p = { ...e.profile, stage: req.body.stage || e.profile.stage };
  const isReturn = !!one('select id from interviews where elder_id=? and finished=1', [e.id]);
  // 档案还没整理完：最多等 3 秒，仍未完成就用档案里还没收录的上次访谈记录兜底
  const job = archiveJobs.get(e.id); if (job) await Promise.race([job.promise, new Promise(r => setTimeout(r, 3000))]);
  const ea = elder(e.id).archive, done = new Set(ea.interviews || []);
  const recent = archiveJobs.get(e.id) ? all('select id,turns from interviews where elder_id=? and finished=1 order by created desc limit 1', [e.id]).filter(r => !done.has(r.id)).flatMap(r => J(r.turns)) : [];
  if (recent.length) console.log('[opening] 档案未更新完，用上次访谈记录兜底');
  const o = await ai.opening(p, recent.length ? { ...ea, pendingFallback: true } : ea, isReturn, recent);
  const id = uid('i'); db.run('insert into interviews values(?,?,?,?,?,?,0)', [id, e.id, p.stage, Date.now(), '[]', JSON.stringify(o)]); save();
  res.json({ id, ...o, isReturn }); });
app.post('/api/interviews/:id/turn', up.single('audio'), async (req, res) => { const v = iv(req.params.id); if (!v) return res.status(404).json({});
  const e = elder(v.elder_id), p = { ...e.profile, stage: v.stage };
  let audio = null; if (req.file?.size > 0) { audio = `${v.id}-${v.turns.length}.${(req.file.mimetype || '').includes('mp4') ? 'm4a' : 'webm'}`; fs.writeFileSync(path.join(AUDIO, audio), req.file.buffer); }
  const t0 = Date.now();
  const tr = req.body.manual ? { raw: req.body.manual, clean: req.body.manual, source: 'manual' } : await ai.transcribe(req.file?.buffer, req.file?.mimetype, req.body.browserText);
  const prevQid = v.turns.length ? v.turns.at(-1).nextQid : v.opening?.qid;
  v.turns.push({ q: req.body.question, qid: prevQid, raw: tr.raw, clean: tr.clean, audio, at: Date.now(), asrSource: tr.source });
  const t1 = Date.now(); const n = await ai.nextTurn(p, e.archive, v.turns); const t2 = Date.now();
  console.log(`[turn] ${v.id}#${v.turns.length} asr=${t1 - t0}ms(${tr.source}) agent=${t2 - t1}ms(${n.source}) total=${t2 - t0}ms`); v.turns.at(-1).nextQid = n.qid; v.turns.at(-1).agent = { emotion: n.emotion, action: n.action, source: n.source };
  db.run('update interviews set turns=? where id=?', [JSON.stringify(v.turns), v.id]); save();
  res.json({ transcript: tr, next: n }); });
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
