import express from 'express'; import multer from 'multer'; import initSqlJs from 'sql.js';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { status } from './gemini.mjs'; import * as ai from './ai.mjs'; import { withAutoCallName } from '../src/callname.js';
import * as P from '../src/planner.js'; import { makeTTS, TTS } from './tts.mjs'; import { ACKS } from '../src/split.js'; import JSZip from 'jszip';
const dir = path.dirname(fileURLToPath(import.meta.url)), DATA = path.resolve(process.env.DATA_DIR || path.join(dir, 'data')), AUDIO = path.join(DATA, 'audio'), DBF = path.join(DATA, 'mb.sqlite');
fs.mkdirSync(AUDIO, { recursive: true });
const SQL = await initSqlJs(); const db = fs.existsSync(DBF) ? new SQL.Database(fs.readFileSync(DBF)) : new SQL.Database();
db.run(`create table if not exists elders(id text primary key, profile text, archive text, created int);
create table if not exists interviews(id text primary key, elder_id text, stage text, created int, turns text, opening text, finished int);
create table if not exists stories(id text primary key, elder_id text, interview_id text, created int, data text);
create table if not exists transcript_turns(id text primary key, interview_id text, elder_id text, idx int, data text); -- 第 2 层 访谈稿：只插入，永不修改
create table if not exists edits(id text primary key, elder_id text, target text, target_id text, field text, before text, after text, by text, at int); -- 第 3 层家人修改留痕
create table if not exists elder_state(elder_id text primary key, nodes text, entities text);`); // 话题网节点状态 + 实体表（每轮同步更新，不依赖后台档案）
const save = () => fs.writeFileSync(DBF, Buffer.from(db.export()));
const all = (q, p = []) => { const s = db.prepare(q); s.bind(p); const r = []; while (s.step()) r.push(s.getAsObject()); s.free(); return r; };
const one = (q, p) => all(q, p)[0];
const J = s => JSON.parse(s || 'null');
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const elder = id => { const e = one('select * from elders where id=?', [id]); return e && { id: e.id, profile: J(e.profile), archive: J(e.archive) || {} }; };
const iv = id => { const r = one('select * from interviews where id=?', [id]); return r && { ...r, turns: J(r.turns) || [], opening: J(r.opening) }; };

// 空库自动灌入王女士演示数据（档案 + 一次访谈 + 故事 + 记忆档案/实体/话题状态），第二次访谈可直接接续开场
if (!one('select count(*) n from elders').n) { const { seedDemo } = await import('./seed.mjs'); await seedDemo({ db, ai, P }); save(); console.log('[seed] 已灌入王女士演示数据（elder id: demo-wang）'); }
const app = express(); app.use(express.json({ limit: '2mb' }));
const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20e6 } });
import { gemini } from './gemini.mjs';
app.get('/api/health', async (_, res) => { if (status.ok === null) await gemini([{ text: '回复：好' }], { timeout: 10000 }).catch(() => {}); res.json({ gemini: { ok: status.ok, models: status.models, lastModel: status.lastModel, hasKey: status.hasKey, lastError: status.lastError } }); });
app.post('/api/elders', (req, res) => { const id = req.body.id || uid('e'); const old = elder(id);
  let np = withAutoCallName(req.body.profile || {}); // 称呼默认 姓＋先生/女士；手动改过/老人要求过的不覆盖
  if (old?.profile?.callNameBy === 'elder' && !np.callNameManual && np.callNameBy !== 'elder') np = { ...np, callName: old.profile.callName, callNameBy: 'elder' };
  db.run('insert or replace into elders values(?,?,?,?)', [id, JSON.stringify(np), JSON.stringify(old?.archive || {}), Date.now()]); save(); res.json(elder(id)); });
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
  const prevNodeId = last?.plan?.ask?.nodeId || last?.plan?.nodes?.[0]?.nodeId;
  return { states, entities, plan: { ...P.planSession(ai.FW, { profile: e.profile, states, entities, lastSessionId: last?.id, prevNodeId, request }), lastSessionId: last?.id || null, prevNodeId } }; };
// 会话规划预览（家人页）：?nodeId= 或 ?trigger= 指定
app.get('/api/elders/:id/plan', (req, res) => { const e = elder(req.params.id); if (!e) return res.status(404).json({});
  const request = req.query.nodeId || req.query.trigger ? { nodeId: req.query.nodeId || null, trigger: req.query.trigger || null } : null;
  const { plan, states, entities } = makePlan(e, request);
  res.json({ plan, vars: P.planVars(ai.FW, plan, { profile: e.profile, states, entities }) }); });
app.post('/api/elders/:id/nodes/:nid/reset', (req, res) => { const x = getState(req.params.id); delete x.states[req.params.nid]; setState(req.params.id, x); save(); res.json({ ok: true }); }); // 家人手动重置
app.post('/api/interviews', async (req, res) => { const e = elder(req.body.elderId); if (!e) return res.status(404).json({});
  const p = withAutoCallName(e.profile);
  const isReturn = !!one('select id from interviews where elder_id=? and finished=1', [e.id]);
  // 档案还没整理完：最多等 3 秒，仍未完成就用档案里还没收录的上次访谈记录兜底（节点状态和实体表每轮已同步写入，不受影响）
  const job = archiveJobs.get(e.id); if (job) await Promise.race([job.promise, new Promise(r => setTimeout(r, 3000))]);
  const ea = elder(e.id).archive, done = new Set(ea.interviews || []);
  const recent = archiveJobs.get(e.id) ? all('select id,turns from interviews where elder_id=? and finished=1 order by created desc limit 1', [e.id]).filter(r => !done.has(r.id)).flatMap(r => J(r.turns)) : [];
  if (recent.length) console.log('[opening] 档案未更新完，用上次访谈记录兜底');
  const { plan, states, entities } = makePlan(e, req.body.request || null);
  const id = uid('i'); plan.sessionId = id;
  const t0 = Date.now(), o = await ai.opening(p, { archive: ea, states, entities, plan }, isReturn, recent);
  // 老人自己选话题：问候后念出 3 个候选（家人指定的排第一），屏幕同时出卡片
  const cards = P.candidates(ai.FW, { profile: p, states, entities, lastSessionId: plan.lastSessionId, prevNodeId: plan.prevNodeId, request: req.body.request || null });
  o.greet = o.say; o.say = ((o.say.match(/[^。！!？?]+[。！!？?]?/g) || []).filter(x => !/[？?]$/.test(x)).join('') || o.say) + P.choiceText(cards);
  Object.assign(o, { phase: 'choose', after: false, cards, shown: cards.map(c => c.nodeId), choices: [] });
  o.plan = plan; o.closing = ai.closing(p, { states, entities, plan });
  const topic = P.nodeTitle(ai.FW, plan.nodes[0].nodeId, p);
  console.log(`[opening] ${id} ${o.source} ${Date.now() - t0}ms cards=${cards.map(c => c.nodeId + '/' + c.kind).join(',')} plan=${plan.nodes.map(x => x.nodeId + '/' + x.reason).join(',')} next=${plan.nextNodePreview.nodeId}`);
  db.run('insert into interviews values(?,?,?,?,?,?,0)', [id, e.id, topic, Date.now(), '[]', JSON.stringify(o)]); save();
  res.json({ id, ...o, isReturn, topic }); });
// 小忆语音：Gemini TTS 单句合成（缓存命中直接返回）；超时/失败回 504，前端退回浏览器朗读
const tts = makeTTS(path.join(DATA, 'tts'));
app.get('/api/tts', async (req, res) => { const t = String(req.query.t || '').slice(0, 300).trim(); if (!t) return res.status(400).end();
  const t0 = Date.now();
  try { const { wav, cached } = await tts.get(t); res.set({ 'Content-Type': 'audio/wav', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-TTS-Ms': Date.now() - t0, 'X-TTS-Cached': cached ? 1 : 0 }); res.end(wav);
    if (!cached) console.log(`[tts] ${Date.now() - t0}ms ${TTS.model} 「${t.slice(0, 12)}…」`); }
  catch (e) { console.warn(`[tts] 回退浏览器朗读 ${Date.now() - t0}ms ${e.message.slice(0, 60)}`); res.status(504).json({ error: 'tts' }); } });
app.get('/api/tts/stream', async (req, res) => { const t = String(req.query.t || '').slice(0, 300).trim(); if (!t) return res.status(400).end();
  const ctl = new AbortController(); req.on('close', () => { if (!res.writableEnded) ctl.abort(); }); const t0 = Date.now(); let first = 0, cached = tts.has(t);
  try { for await (const c of tts.streamPCM(t, { signal: ctl.signal })) { if (!first) { first = Date.now() - t0; res.set({ 'Content-Type': 'audio/L16;rate=24000', 'X-TTS-Cached': cached ? 1 : 0, 'X-TTS-First-Ms': first }); } res.write(c); }
    res.end(); if (!cached) console.log(`[tts] 流式 首块 ${first}ms 完成 ${Date.now() - t0}ms 「${t.slice(0, 12)}…」`); }
  catch (e) { console.warn(`[tts] 流式失败 ${Date.now() - t0}ms ${String(e.message).slice(0, 60)}`); if (!res.headersSent) res.status(504).json({ error: 'tts' }); else res.end(); } });
app.get('/api/tts/config', (req, res) => res.json({ model: TTS.model, voice: TTS.voice, timeout: TTS.timeout, enabled: status.hasKey, stream: process.env.GEMINI_TTS_STREAM !== '0' }));
// 选话题：点卡片（index / action）或说出来（audio / manual 文本），Gemini 判断 + 本地规则兜底
const chatted = o => o.plan.nodes.slice(0, o.plan.currentNodeIndex + 1).map(x => x.nodeId);
app.post('/api/interviews/:id/choose', up.single('audio'), async (req, res) => { const v = iv(req.params.id); if (!v) return res.status(404).json({});
  const e = elder(v.elder_id), p = withAutoCallName(e.profile), o = v.opening, { states, entities } = getState(e.id);
  if (o.phase !== 'choose') return res.status(409).json({ error: 'not choosing' });
  const t0 = Date.now(); let heard = null, ch;
  if (req.body.action) ch = { action: req.body.action, index: +req.body.index || 0, source: 'tap' };
  else { const tr = req.body.manual ? { clean: req.body.manual, source: 'manual' } : await ai.transcribe(req.file?.buffer, req.file?.mimetype, req.body.browserText);
    heard = tr.clean || ''; ch = await ai.chooseTopic(p, o.cards, heard, { after: o.after }); }
  if (ch.action === 'stay' && !o.after || ch.action === 'end' && !o.after) ch = { ...ch, action: 'pick', index: 0 };
  o.choices.push({ at: Date.now(), heard, ...ch, cards: o.cards.map(c => c.nodeId) });
  let say, cards = null;
  const cur = o.plan.nodes[o.plan.currentNodeIndex];
  if (ch.action === 'more') {
    cards = P.candidates(ai.FW, { profile: p, states, entities, lastSessionId: o.plan.lastSessionId, prevNodeId: o.plan.prevNodeId, exclude: [...o.shown, ...(o.after ? chatted(o) : [])] });
    o.cards = cards; o.shown = [...o.shown, ...cards.map(c => c.nodeId)];
    say = '好，那再换几个。' + P.choiceText(cards, { after: o.after }).replace(/^(今天|接下来)想聊哪个？/, '');
  } else if (ch.action === 'end') { say = null;
  } else if (ch.action === 'stay') { o.phase = 'chat';
    const d = Math.min(4, (o.plan.ask.depth || 1) + 1); o.plan.ask = { ...o.plan.ask, depth: d };
    say = '好，那咱们接着聊。' + P.questionFor(ai.FW, o.plan.ask.nodeId, d, p);
  } else if (ch.action === 'free') { o.phase = 'chat'; o.plan.free = true;
    say = P.fillAll('好，{称呼}想聊什么都行，想到哪儿说到哪儿。您想先讲讲哪件事呀？', p);
  } else { // pick
    const c = o.cards[ch.index] || (ch.nodeId && { nodeId: ch.nodeId, kind: 'voice', reason: 'elder_choice' }) || o.cards[0];
    const sp = P.planSession(ai.FW, { profile: p, states, entities, lastSessionId: o.plan.lastSessionId, prevNodeId: o.plan.prevNodeId, request: { nodeId: c.nodeId } });
    sp.prevNodeId = o.plan.prevNodeId;
    const node = { ...sp.nodes[0], reason: c.kind === 'family' ? sp.nodes[0].reason : 'elder_choice', pickedFrom: c.kind, note: c.note || sp.nodes[0].note };
    const base = o.after ? o.plan.nodes.slice(0, o.plan.currentNodeIndex + 1) : [];
    // 老人自选：只挂当前选中话题；第二个节点等聊够再选题时再定（planSession 内部备选不写入可见 nodes）
    o.plan = { ...o.plan, ...sp, nodes: [...base, node], currentNodeIndex: base.length, ask: sp.ask, free: false, sessionId: v.id, lastSessionId: o.plan.lastSessionId };
    o.phase = 'chat';
    say = `好，那咱们就聊${P.nodeTitle(ai.FW, c.nodeId, p)}。` + P.questionFor(ai.FW, sp.ask.nodeId, sp.ask.depth, p, sp.ask.trigger);
  }
  o.closing = ai.closing(p, { states, entities, plan: o.plan });
  console.log(`[choose] ${v.id} heard=${heard ?? '(点击)'} → ${ch.action}${ch.index != null ? '#' + ch.index : ''}${ch.nodeId ? ' ' + ch.nodeId : ''} (${ch.source}) ${Date.now() - t0}ms ask=${o.plan.ask.nodeId}:${o.plan.ask.depth}`);
  db.run('update interviews set opening=? where id=?', [JSON.stringify(o), v.id]); save();
  res.json({ heard, choice: ch, say, phase: o.phase, cards: o.phase === 'choose' ? o.cards : null, after: o.after, ask: o.plan.ask, closing: o.closing, end: ch.action === 'end' }); });
app.post('/api/interviews/:id/turn', up.single('audio'), async (req, res) => { const v = iv(req.params.id); if (!v) return res.status(404).json({});
  const e = elder(v.elder_id), p = withAutoCallName(e.profile), o = v.opening;
  let audio = null; if (req.file?.size > 0) { audio = `${v.id}-${v.turns.length}.${(req.file.mimetype || '').includes('mp4') ? 'm4a' : 'webm'}`; fs.writeFileSync(path.join(AUDIO, audio), req.file.buffer); }
  const t0 = Date.now();
  const wavMs = b => b.toString('ascii', 0, 4) === 'RIFF' && b.readUInt32LE(28) ? (b.length - 44) / b.readUInt32LE(28) * 1000 : 0;
  // 有录音：先试合并调用（听音频 + 出回复一次完成），失败再走 转写 → 生成 两步
  const fused = !req.body.manual && req.file?.size > 1000 && process.env.GEMINI_FUSED !== '0';
  let tr = req.body.manual ? { raw: req.body.manual, clean: req.body.manual, source: 'manual' } : fused ? { raw: '', clean: '', source: 'gemini-fused' } : await ai.transcribe(req.file?.buffer, req.file?.mimetype, req.body.browserText);
  const ask = o.plan.ask;
  const tid = `${v.id}-t${v.turns.length + 1}`;
  v.turns.push({ id: tid, q: req.body.question, qid: `${ask.nodeId}:${ask.depth}`, ask, raw: tr.raw, clean: tr.clean, audio, at: Date.now(), asrSource: tr.source });
  const st = getState(e.id);
  let t1 = Date.now(), n = null; const ctx = { archive: e.archive, ...st, plan: o.plan };
  if (fused) try { n = await ai.nextTurn(p, ctx, v.turns, v.id, { audio: { buf: req.file.buffer, mime: req.file.mimetype, durMs: +req.body.durMs || wavMs(req.file.buffer) } }); tr = { raw: v.turns.at(-1).raw, clean: v.turns.at(-1).clean, source: 'gemini-fused' }; }
    catch (err) { console.warn(`[turn] 合并调用失败 ${Date.now() - t1}ms → 回退两步`); tr = await ai.transcribe(req.file?.buffer, req.file?.mimetype, req.body.browserText); Object.assign(v.turns.at(-1), { raw: tr.raw, clean: tr.clean, asrSource: tr.source }); }
  if (fused && n) { t1 = t0; } else t1 = Date.now();
  if (!n) n = await ai.nextTurn(p, ctx, v.turns, v.id); const t2 = Date.now();
  console.log(`[turn] ${v.id}#${v.turns.length} ${n.source === 'gemini-fused' ? 'fused' : `asr=${t1 - t0}ms(${tr.source})`} agent=${t2 - t1}ms(${n.source}) total=${t2 - t0}ms node=${n.analysis.nodeId} depth=${n.analysis.depth}${n.analysis.nodeId !== ask.nodeId ? '（跑题归档）' : ''} ents=${(n.analysis.entities || []).map(x => x.name).join('/')} → ask=${n.plan.ask.nodeId}:${n.plan.ask.depth}${n.done ? ' done' : ''}`);
  v.turns.at(-1).asrSource = tr.source; v.turns.at(-1).analysis = n.analysis; v.turns.at(-1).agent = { emotion: n.emotion, action: n.action, source: n.source };
  const T = v.turns.at(-1); // 第 2 层：逐轮访谈稿，写入后不再修改
  db.run('insert into transcript_turns values(?,?,?,?,?)', [tid, v.id, e.id, v.turns.length, JSON.stringify({ id: tid, idx: v.turns.length, at: T.at, question: T.q, raw: T.raw, clean: T.clean, audio: T.audio, asrSource: T.asrSource, nodeId: n.analysis.nodeId, depth: n.analysis.depth, emotion: n.emotion, note: n.analysis.note, askedNode: ask.nodeId, askedDepth: ask.depth })]);
  const names = new Set((n.analysis.entities || []).map(x => x.name)); // 实体表每条注明出处句子
  for (const x of n.entities) if (names.has(x.name) || (x.aliases || []).some(a => names.has(a))) x.sourceTurns = [...new Set([...(x.sourceTurns || []), tid])];
  if (n.callName) { // 老人当场改口：写入档案称呼（后续轮次、下次访谈生效）
    const np = { ...e.profile, callName: n.callName, callNameBy: 'elder', callNameManual: true }, arc = { ...e.archive, callName: n.callName, callNameAt: Date.now() };
    db.run('update elders set profile=?, archive=? where id=?', [JSON.stringify(np), JSON.stringify(arc), e.id]); console.log(`[callName] ${e.id} 改口为「${n.callName}」`); }
  if (o.plan.free && !n.done) { // 自由聊：第一句话讲到哪个节点，就把它定为当前话题
    const nid = n.analysis.nodeId && P.nodeById(ai.FW, n.analysis.nodeId) ? n.analysis.nodeId : n.plan.ask.nodeId;
    const nodes = [...n.plan.nodes.slice(0, n.plan.currentNodeIndex), { nodeId: nid, reason: 'elder_free', startDepth: 1, note: '老人自己想聊的' }];
    n.plan = { ...n.plan, free: false, nodes, currentNodeIndex: nodes.length - 1, ask: n.plan.ask.nodeId === nid ? n.plan.ask : { nodeId: nid, depth: Math.min(4, (n.analysis.depth || 1) + 1) } };
    if (n.switch) n.switch = false; }
  let cards = null;
  if (n.switch) { // 聊够了：念出新候选让老人选（继续聊这个 / 今天先到这），不直接跳
    const tmp = { ...o, plan: n.plan };
    cards = P.candidates(ai.FW, { profile: p, states: n.states, entities: n.entities, lastSessionId: n.plan.lastSessionId, prevNodeId: n.plan.ask.nodeId, exclude: chatted(tmp) });
    Object.assign(o, { phase: 'choose', after: true, cards, shown: [...(o.shown || []), ...cards.map(c => c.nodeId)] });
    n.say = ai.keepAck(n.say) + P.choiceText(cards, { after: true }); }
  setState(e.id, { states: n.states, entities: n.entities }); o.plan = n.plan; o.closing = ai.closing(n.callName ? { ...p, callName: n.callName } : p, { states: n.states, entities: n.entities, plan: n.plan });
  db.run('update interviews set turns=?, opening=? where id=?', [JSON.stringify(v.turns), JSON.stringify(o), v.id]); save();
  res.json({ timing: { total: t2 - t0, asr: n.source === 'gemini-fused' ? null : t1 - t0, agent: t2 - t1, fused: n.source === 'gemini-fused' }, transcript: tr, next: { emotion: n.emotion, action: n.action, say: n.say, done: n.done, source: n.source, analysis: n.analysis, ask: n.plan.ask, phase: cards ? 'choose' : 'chat', cards }, closing: o.closing, ...(n.callName ? { profile: elder(e.id).profile } : {}) }); });
// 记忆档案后台更新：同一位老人串行，不阻塞故事页
const archiveJobs = new Map(); // elderId -> { promise, since, pending: [interviewId] }
function queueArchive(eid, v, p) {
  const prev = archiveJobs.get(eid), job = prev || { since: Date.now(), pending: [] }; job.pending.push(v.id);
  job.promise = (prev?.promise || Promise.resolve()).then(async () => { const t0 = Date.now(), e = elder(eid);
    const a = await ai.updateArchive(e.profile, e.archive, v.turns, v.stage).catch(() => null);
    if (a) { a.interviews = [...(e.archive.interviews || []), v.id]; if (e.archive.callName) { a.callName = e.archive.callName; a.callNameAt = e.archive.callNameAt; } db.run('update elders set archive=? where id=?', [JSON.stringify(a), eid]); save(); }
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
  const sid = uid('s'); db.run('insert into stories values(?,?,?,?,?)', [sid, e.id, v.id, Date.now(), JSON.stringify({ ...s, stage: v.stage, paras: linkParas(s.body, v.turns), clips: v.turns.map(t => ({ id: t.id, q: t.q, text: t.clean, audio: t.audio })) })]); save();
  res.json({ storyId: sid }); });
// 第 3 层：故事每段引用第 2 层句子 id（按字的重合度对齐），可回溯原声
const bigrams = t => { const c = (t || '').replace(/[\s，。,.！!？?…、“”"：:；;]/g, ''), r = new Set(); for (let i = 0; i < c.length - 1; i++) r.add(c.slice(i, i + 2)); return r; };
function linkParas(body, turns) { const tb = turns.map(t => ({ id: t.id, b: bigrams(t.clean || t.raw) }));
  return (body || '').split(/\n+/).filter(x => x.trim()).map(text => { const b = bigrams(text);
    const sc = tb.map(t => ({ id: t.id, s: [...b].filter(x => t.b.has(x)).length / Math.max(1, Math.min(b.size, t.b.size)) })).filter(x => x.s >= 0.25).sort((a, c) => c.s - a.s);
    return { text, refs: sc.slice(0, 2).map(x => x.id) }; }); }
const transcriptOf = iid => all('select data from transcript_turns where interview_id=? order by idx', [iid]).map(r => J(r.data));
const storyOut = s => { const d = J(s.data), v = iv(s.interview_id); return { id: s.id, created: s.created, elder: elder(s.elder_id).profile, ...d, paras: d.paras || linkParas(d.body, v?.turns || []), transcript: transcriptOf(s.interview_id), fullAudio: v?.opening?.fullAudio || null,
  edits: all('select * from edits where target=? and target_id=? order by at', ['story', s.id]) }; };
app.get('/api/stories/:id', (req, res) => { const s = one('select * from stories where id=?', [req.params.id]); s ? res.json(storyOut(s)) : res.status(404).json({}); });
// 家人修改故事：只改第 3 层，旧值写入 edits 留痕；原话（第 2 层）不动
app.put('/api/stories/:id', (req, res) => { const s = one('select * from stories where id=?', [req.params.id]); if (!s) return res.status(404).json({});
  const d = J(s.data), by = req.body.by || '家人';
  for (const f of ['title', 'body']) if (typeof req.body[f] === 'string' && req.body[f] !== d[f]) {
    db.run('insert into edits values(?,?,?,?,?,?,?,?,?)', [uid('x'), s.elder_id, 'story', s.id, f, d[f], req.body[f], by, Date.now()]); d[f] = req.body[f]; }
  d.paras = linkParas(d.body, transcriptOf(s.interview_id).map(t => ({ id: t.id, clean: t.clean, raw: t.raw })));
  db.run('update stories set data=? where id=?', [JSON.stringify(d), s.id]); save(); res.json(storyOut(one('select * from stories where id=?', [s.id]))); });
// 第 1 层：整场完整录音
app.post('/api/interviews/:id/full', up.single('audio'), (req, res) => { const v = iv(req.params.id); if (!v || !req.file?.size) return res.status(400).json({});
  const f = `${v.id}-full.${(req.file.mimetype || '').includes('mp4') ? 'm4a' : 'webm'}`; fs.writeFileSync(path.join(AUDIO, f), req.file.buffer);
  const o = v.opening; o.fullAudio = f; db.run('update interviews set opening=? where id=?', [JSON.stringify(o), v.id]); save(); res.json({ fullAudio: f }); });
// 一键打包：原声 + 访谈稿 + 故事 + 档案（数据归家人所有）
app.get('/api/elders/:id/export.zip', async (req, res) => { const e = elder(req.params.id); if (!e) return res.status(404).json({});
  const z = new JSZip(), st = getState(e.id), name = e.profile.name || '老人';
  const ivs = all('select * from interviews where elder_id=? order by created', [e.id]).map(r => ({ ...r, turns: J(r.turns), opening: J(r.opening) }));
  z.file('说明.txt', `记忆银行 · ${name} 的全部记忆\n导出时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n\n1-原声/：每次访谈的完整录音（*-full）和每句回答的片段（*-tN）\n2-访谈稿/：逐轮原始记录（AI 问句、原始转写、整理文本、音频、节点、层次、情绪），永不修改\n3-加工成果/：记忆故事（每段注明引用的句子 id）、记忆档案、实体表、家人修改记录\n`);
  for (const v of ivs) { const T = transcriptOf(v.id), d = new Date(v.created).toLocaleDateString('sv', { timeZone: 'Asia/Shanghai' });
    for (const f of [v.opening?.fullAudio, ...v.turns.map(t => t.audio)].filter(Boolean)) { const fp = path.join(AUDIO, f); if (fs.existsSync(fp)) z.file(`1-原声/${f}`, fs.readFileSync(fp)); }
    z.file(`2-访谈稿/${d}-${v.id}.json`, JSON.stringify({ interviewId: v.id, created: v.created, topic: v.stage, opening: v.opening?.say, plan: v.opening?.plan, turns: T }, null, 2));
    z.file(`2-访谈稿/${d}-${v.id}.txt`, `${v.stage || ''}  ${d}\n\n小忆：${v.opening?.say || ''}\n\n` + T.map(t => `[${t.id}] 小忆：${t.question}\n${name}（原始转写）：${t.raw || ''}\n${name}（整理）：${t.clean || ''}\n  节点 ${t.nodeId} · 第${t.depth}层 · ${t.emotion || ''}${t.audio ? ` · 音频 1-原声/${t.audio}` : ''}`).join('\n\n')); }
  for (const s of all('select * from stories where elder_id=? order by created', [e.id])) { const o = storyOut(s);
    z.file(`3-加工成果/故事/${s.id}.json`, JSON.stringify({ ...o, transcript: undefined }, null, 2));
    z.file(`3-加工成果/故事/${s.id}.md`, `# ${o.title}\n\n` + o.paras.map(p => `${p.text}${p.refs.length ? `  〔原话：${p.refs.join('、')}〕` : ''}`).join('\n\n') + `\n\n${o.quotes || ''}\n`); }
  z.file('3-加工成果/记忆档案.json', JSON.stringify({ profile: e.profile, archive: e.archive }, null, 2));
  z.file('3-加工成果/实体表.json', JSON.stringify(st.entities, null, 2)); z.file('3-加工成果/话题网状态.json', JSON.stringify(st.states, null, 2));
  z.file('3-加工成果/家人修改记录.json', JSON.stringify(all('select * from edits where elder_id=? order by at', [e.id]), null, 2));
  const buf = await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`记忆银行-${name}.zip`)}` }).send(buf); });
app.use('/api/audio', express.static(AUDIO));
// 生产：同一进程提供前端构建产物（dist）+ SPA 回退
const DIST = path.join(dir, '../dist');
if (fs.existsSync(DIST)) { app.use(express.static(DIST, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api\/).*/, (_, res) => res.sendFile(path.join(DIST, 'index.html'))); }
app.use('/api', (_, res) => res.status(404).json({ error: 'not found' }));
const PORT = +(process.env.PORT || 8787), HOST = process.env.HOST || '0.0.0.0';
// 启动后后台预热固定话术（不阻塞启动）：演示老人的候选念白、选题回应、收尾、通用回应
function warmTTS() { if (!status.hasKey || process.env.GEMINI_TTS_WARM === '0') return;
  setTimeout(async () => { const t0 = Date.now(), texts = [...ACKS]; // 短回应最先预热
    try { for (const e of all('select id from elders').map(r => elder(r.id))) { const p = withAutoCallName(e.profile), { plan, states, entities } = makePlan(e, null);
        let ex = []; for (let k = 0; k < 2; k++) { const c = P.candidates(ai.FW, { profile: p, states, entities, lastSessionId: plan.lastSessionId, prevNodeId: plan.prevNodeId, exclude: ex }); ex.push(...c.map(x => x.nodeId));
          texts.push(P.choiceText(c), P.choiceText(c, { after: true }), '好，那再换几个。', ...c.map(x => `好，那咱们就聊${P.nodeTitle(ai.FW, x.nodeId, p)}。` + P.questionFor(ai.FW, x.nodeId, x.startDepth || 1, p))); }
        texts.push(ai.closing(p, { states, entities, plan }), P.fillAll('好，{称呼}想聊什么都行，想到哪儿说到哪儿。您想先讲讲哪件事呀？', p), '好，那咱们接着聊。'); }
      texts.push('嗯，是这样。', '没关系，想不起来就不想了。', '说起他，您心里肯定还惦记着。', '这段我都好好记下了。');
      const n = await tts.warm(texts.map(t => P.speakable ? P.speakable(t) : t)); console.log(`[tts] 预热完成 新合成 ${n} 句 ${Date.now() - t0}ms`); } catch (e) { console.warn('[tts] 预热失败', e.message.slice(0, 80)); } }, 1000); }
app.listen(PORT, HOST, () => { warmTTS(); console.log(`memory-bank on ${HOST}:${PORT}${fs.existsSync(DIST) ? ' (含前端 dist)' : ''}, data=${DATA}, gemini key ${status.hasKey ? 'present' : 'missing（走兜底）'}`); });
