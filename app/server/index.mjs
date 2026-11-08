import express from 'express'; import multer from 'multer'; import initSqlJs from 'sql.js';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { status } from './gemini.mjs'; import { asrViaOpenai } from './openai.mjs'; import * as ai from './ai.mjs'; import { withAutoCallName } from '../src/callname.js';
import * as P from '../src/planner.js'; import { makeTTS, TTS, DS } from './tts.mjs'; import { ACKS } from '../src/split.js'; import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { attachRealtimeASR } from './realtime-asr.mjs';
import { InterviewQueue, audioExtension, normalizeWav, readWav } from './interview-session.mjs';
import { interviewStream } from './interview-stream.mjs';
import { getRealtimeTranscript } from './realtime-asr.mjs';
import { conversationHistory } from './interview-context.mjs';
const dir = path.dirname(fileURLToPath(import.meta.url)), DATA = path.resolve(process.env.DATA_DIR || path.join(dir, 'data')), AUDIO = path.join(DATA, 'audio'), DBF = path.join(DATA, 'mb.sqlite');
fs.mkdirSync(AUDIO, { recursive: true });
const SQL = await initSqlJs(); const db = fs.existsSync(DBF) ? new SQL.Database(fs.readFileSync(DBF)) : new SQL.Database();
db.run(`create table if not exists elders(id text primary key, profile text, archive text, created int);
create table if not exists interviews(id text primary key, elder_id text, stage text, created int, turns text, opening text, finished int);
create table if not exists stories(id text primary key, elder_id text, interview_id text, created int, data text);
create table if not exists transcript_turns(id text primary key, interview_id text, elder_id text, idx int, data text); -- 第 2 层 访谈稿：只插入，永不修改
create table if not exists interview_requests(interview_id text, operation text, request_id text, fingerprint text, status int, response text, primary key(interview_id, operation, request_id));
create table if not exists interview_events(id text primary key, interview_id text, at int, data text);
create table if not exists edits(id text primary key, elder_id text, target text, target_id text, field text, before text, after text, by text, at int); -- 第 3 层家人修改留痕
create table if not exists elder_state(elder_id text primary key, nodes text, entities text);`); // 话题网节点状态 + 实体表（每轮同步更新，不依赖后台档案）
const save = () => { const temporary = DBF + '.tmp'; fs.writeFileSync(temporary, Buffer.from(db.export())); fs.renameSync(temporary, DBF); };
const all = (q, p = []) => { const s = db.prepare(q); s.bind(p); const r = []; while (s.step()) r.push(s.getAsObject()); s.free(); return r; };
const one = (q, p) => all(q, p)[0];
const J = s => JSON.parse(s || 'null');
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const elder = id => { const e = one('select * from elders where id=?', [id]); return e && { id: e.id, profile: J(e.profile), archive: J(e.archive) || {} }; };
const iv = id => { const r = one('select * from interviews where id=?', [id]); return r && { ...r, turns: J(r.turns) || [], opening: J(r.opening) }; };

// 空库自动灌入王女士演示数据（档案 + 一次访谈 + 故事 + 记忆档案/实体/话题状态），第二次访谈可直接接续开场
if (!one('select count(*) n from elders').n) { const { seedDemo } = await import('./seed.mjs'); await seedDemo({ db, ai, P }); save(); console.log('[seed] 已灌入王女士演示数据（elder id: demo-wang）'); }
{ const { seedFugui, SEED_VERSION } = await import('./seed-fugui.mjs'), old = one('select archive from elders where id=?', ['demo-fugui']);
  if (!old || J(old.archive)?.seedVersion !== SEED_VERSION) { // 缺失或内容版本过旧：只清掉并重灌 demo-fugui，其他老人不动
    for (const t of ['interviews', 'stories', 'transcript_turns', 'edits', 'elder_state']) db.run(`delete from ${t} where elder_id=?`, ['demo-fugui']);
    db.run('delete from elders where id=?', ['demo-fugui']);
    await seedFugui({ db, ai, P }); save(); console.log('[seed] 已灌入徐先生演示数据（elder id: demo-fugui，人物原型取自《活着》，内容为自编）'); } }
{ const { seedFancheng } = await import('./seed-fancheng.mjs');
  if (seedFancheng({ db })) { save(); console.log('[seed] 已加入范成采访寒春的虚构演示（讲述者 demo-hanchun）'); } }
const app = express(); app.use(express.json({ limit: '2mb' }));
const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20e6 } });
const interviewQueue = new InterviewQueue();
// Persist the result and the route's database changes together. A lost HTTP
// response can safely be retried, even after restart. Do not abort on disconnect.
const serial = (operation, upload, handle) => (req, res, next) => interviewQueue.run(req.params.id, async () => {
  if (upload) await new Promise((resolve, reject) => up.single('audio')(req, res, error => error ? reject(error) : resolve()));
  req.body ||= {};
  const key = String(req.body.clientTurnId || req.body.eventId || '').slice(0, 200);
  const scope = operation === 'choose' || operation === 'turn' ? 'input' : operation;
  const hash = createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(req.body).sort()))).update(req.file?.buffer || '').digest('hex');
  const prior = key && one('select * from interview_requests where interview_id=? and operation=? and request_id=?', [req.params.id, scope, key]);
  if (prior && prior.fingerprint !== hash) return res.status(409).json({ error: 'request-id-conflict' });
  const stream = scope === 'input' ? interviewStream(req, res) : null;
  if (stream) { res.voiceEvent = stream.send; res.voiceFailure = stream.fail; }
  if (prior) return stream ? stream.finish(J(prior.response), prior.status, true) : res.status(prior.status).json(J(prior.response));
  const json = res.json.bind(res);
  res.json = data => {
    if (res.statusCode < 500) {
      if (key) db.run('insert into interview_requests values(?,?,?,?,?,?)', [req.params.id, scope, key, hash, res.statusCode, JSON.stringify(data)]);
      save();
    }
    return stream ? stream.finish(data, res.statusCode) : json(data);
  };
  await handle(req, res);
}).catch(error => { if (res.voiceFailure) res.voiceFailure(); else next(error); });
const realtimeTranscript = (req, interviewId) => {
  if (isTrue(req.body.continuation) || isTrue(req.body.finalizeContinuation) || !req.file?.size || !req.body.asrSessionId) return null;
  const text = getRealtimeTranscript(req.body.asrSessionId, { interviewId, utteranceId: req.body.utteranceId });
  return text?.trim() ? { raw: text, clean: text, source: 'dashscope-realtime' } : null;
};
const emitTranscript = (req, res, transcript) => res.voiceEvent?.({ type: 'transcript', clientTurnId: req.body.clientTurnId, transcript });
const emitReply = (req, res, responseId, text, ask, phase = 'chat') => {
  if (!res.voiceEvent || !text) return;
  const previous = res.voiceText || '';
  if (text === previous) return;
  if (!text.startsWith(previous)) throw new Error('reply-stream-diverged');
  res.voiceText = text;
  res.voiceEvent({ type: 'reply', clientTurnId: req.body.clientTurnId, responseId, text, delta: text.slice(previous.length), ask: captureAsk({ ask }, {}), phase: phase === 'choose' ? 'choose' : 'chat' });
};
const emitReplyDraft = (req, res, responseId, text, ask, phase = 'chat') => {
  if (!res.voiceEvent) return;
  const stable = res.voiceText || '';
  const visible = String(text || '').startsWith(stable) ? String(text || '') : stable;
  if (visible === (res.voiceDraft || '')) return;
  res.voiceDraft = visible;
  res.voiceEvent({ type: 'reply-draft', clientTurnId: req.body.clientTurnId, responseId, text: visible, ask: captureAsk({ ask }, {}), phase: phase === 'choose' ? 'choose' : 'chat' });
};
const captureAsk = (body, fallback) => { try { const a = typeof body.ask === 'string' ? JSON.parse(body.ask) : body.ask;
  if (a && P.nodeById(ai.FW, a.nodeId)) return { ...a, depth: Math.max(1, Math.min(4, +a.depth || 1)) }; } catch {} return { ...fallback }; };
const eventsOf = id => all('select data from interview_events where interview_id=? order by at,rowid', [id]).map(r => J(r.data));
const transcriptIndex = id => one('select count(*) n from transcript_turns where interview_id=?', [id]).n + 1;
const saveAudio = (v, suffix, file) => { if (!file?.size) return null; const name = `${v.id}-${suffix}.${audioExtension(file.mimetype)}`; fs.writeFileSync(path.join(AUDIO, name), file.buffer); return name; };
// Bound memory to one upload when deriving the legacy single WAV. Pause gaps
// remain explicit metadata; they are not fabricated as recorded silence.
const rebuildFull = (name, segments) => {
  const target = path.join(AUDIO, name), temporary = target + '.tmp';
  const format = readWav(fs.readFileSync(path.join(AUDIO, segments[0].audio))).format;
  const fd = fs.openSync(temporary, 'w'); let bytes = 0;
  try {
    fs.writeSync(fd, Buffer.alloc(44));
    for (const segment of segments) { const pcm = readWav(normalizeWav(fs.readFileSync(path.join(AUDIO, segment.audio)), format)).pcm; fs.writeSync(fd, pcm); bytes += pcm.length; }
    const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(bytes + 36, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); format.copy(header, 20); header.write('data', 36); header.writeUInt32LE(bytes, 40); fs.writeSync(fd, header, 0, 44, 0);
  } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, target);
};
const noSpeech = (res, tr, phase) => tr.unavailable ? res.status(503).json({ error: 'asr-unavailable', retryable: true }) : res.json({ ignored: true, reason: 'no-speech', phase });
const isTrue = value => value === true || value === 'true';
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
  // 声音只说固定邀请；屏幕保留候选，老人也可以直接说自己的话题。
  const cards = P.candidates(ai.FW, { profile: p, states, entities, lastSessionId: plan.lastSessionId, prevNodeId: plan.prevNodeId, request: req.body.request || null });
  o.greet = o.say;
  Object.assign(o, { phase: 'choose', after: false, cards, shown: cards.map(c => c.nodeId), choices: [] });
  o.responseId = `${id}:opening`; o.plan = plan; o.closing = ai.closing(p, { states, entities, plan });
  const topic = '自由聊聊'; // 候选首卡还没有被选择，不能当作本次访谈的主题。
  console.log(`[opening] ${id} source=${o.source} total=${Date.now() - t0}ms`);
  db.run('insert into interviews values(?,?,?,?,?,?,0)', [id, e.id, topic, Date.now(), '[]', JSON.stringify(o)]); save();
  res.json({ id, ...o, isReturn, topic }); });
// 小忆语音：Gemini TTS 单句合成（缓存命中直接返回）；超时/失败回 504，前端退回浏览器朗读
const tts = makeTTS(path.join(DATA, 'tts'));
app.get('/api/tts', async (req, res) => { const t = String(req.query.t || '').slice(0, 300).trim(); if (!t) return res.status(400).end();
  const t0 = Date.now();
  try { const { wav, cached } = await tts.get(t); res.set({ 'Content-Type': 'audio/wav', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-TTS-Ms': Date.now() - t0, 'X-TTS-Cached': cached ? 1 : 0 }); res.end(wav);
    if (!cached) console.log(`[tts] ${Date.now() - t0}ms ${TTS.model}`); }
  catch (e) { console.warn(`[tts] 回退浏览器朗读 ${Date.now() - t0}ms ${e.message.slice(0, 60)}`); res.status(504).json({ error: 'tts' }); } });
app.get('/api/tts/stream', async (req, res) => { const t = String(req.query.t || '').slice(0, 300).trim(); if (!t) return res.status(400).end();
  const ctl = new AbortController(); res.on('close', () => { if (!res.writableEnded) ctl.abort(); }); const t0 = Date.now(); let first = 0, cached = tts.has(t);
  try { for await (const c of tts.streamPCM(t, { signal: ctl.signal })) { if (!first) { first = Date.now() - t0; res.set({ 'Content-Type': 'audio/L16;rate=24000', 'X-TTS-Cached': cached ? 1 : 0, 'X-TTS-First-Ms': first }); } res.write(c); }
    res.end(); if (!cached) console.log(`[tts] 流式 首块 ${first}ms 完成 ${Date.now() - t0}ms`); }
  catch (e) { console.warn(`[tts] 流式失败 ${Date.now() - t0}ms ${String(e.message).slice(0, 60)}`); if (!res.headersSent) res.status(504).json({ error: 'tts' }); else res.end(); } });
app.get('/api/tts/config', (req, res) => res.json({ model: TTS.model, voice: TTS.voice, timeout: TTS.timeout, enabled: status.hasKey || DS, stream: process.env.GEMINI_TTS_STREAM !== '0' }));
// 选话题：点卡片（index / action）或说出来（audio / manual 文本），Gemini 判断 + 本地规则兜底
const chatted = o => o.plan.nodes.slice(0, o.plan.currentNodeIndex + 1).map(x => x.nodeId);
app.post('/api/interviews/:id/choose', serial('choose', true, async (req, res) => { const v = iv(req.params.id); if (!v) return res.status(404).json({});
  if (v.finished) return res.status(409).json({ error: 'finished' });
  const e = elder(v.elder_id), p = withAutoCallName(e.profile), o = v.opening, { states, entities } = getState(e.id);
  if (o.phase !== 'choose') { if (!req.body.action) return handleTurn(req, res); return res.status(409).json({ error: 'not-choosing' }); }
  const t0 = Date.now(); let heard = null, ch, tr = null;
  const finalizing = isTrue(req.body.finalizeContinuation);
  if (finalizing) {
    const parts = (o.choiceContinuations || []).filter(t => req.body.utteranceId && t.utteranceId === req.body.utteranceId);
    if (!parts.length) return res.status(409).json({ error: 'continuation-not-found' });
    heard = parts.map(t => t.clean || t.raw).filter(Boolean).join('\n');
    ch = await ai.chooseTopic(p, o.cards, heard, { after: o.after });
  } else if (req.body.action) ch = { action: req.body.action, index: +req.body.index || 0, source: 'tap' };
  else { tr = req.body.manual ? { raw: req.body.manual.trim(), clean: req.body.manual.trim(), source: 'manual' } : realtimeTranscript(req, v.id) || await ai.transcribe(req.file?.buffer, req.file?.mimetype, req.body.browserText);
    emitTranscript(req, res, tr);
    heard = (tr.clean || tr.raw || '').trim(); if (!heard) return noSpeech(res, tr, o.phase);
    if (req.body.continuation === true || req.body.continuation === 'true') {
      const partNumber = transcriptIndex(v.id), deferredId = `${v.id}-choice-part${partNumber}`;
      const audio = saveAudio(v, `choice-part${partNumber}`, req.file);
      const T = { id: deferredId, kind: 'choice', deferred: true, utteranceId: req.body.utteranceId, at: Date.now(), question: req.body.question || o.say, questionId: req.body.questionId || o.responseId, raw: tr.raw || heard, clean: heard, audio, asrSource: tr.source, clientTurnId: req.body.clientTurnId };
      db.run('insert into transcript_turns values(?,?,?,?,?)', [deferredId, v.id, e.id, transcriptIndex(v.id), JSON.stringify(T)]);
      (o.choiceContinuations ||= []).push(T);
      db.run('update interviews set opening=? where id=?', [JSON.stringify(o), v.id]);
      return res.json({ deferred: true, transcript: tr, phase: o.phase, turnId: deferredId });
    }
    ch = await ai.chooseTopic(p, o.cards, [...(o.choiceContinuations || []).map(t => t.clean), heard].join('\n'), { after: o.after }); }
  if (ch.action === 'discuss') {
    // A story is already a conversation turn. Do not reduce it to a card and
    // lose the opening words before the host sees them.
    o.phase = 'chat'; o.plan.free = true;
    for (const part of o.choiceContinuations || []) v.turns.push({ ...part, q: part.question, ask: o.plan.ask, qid: `${o.plan.ask.nodeId}:${o.plan.ask.depth}`, continuation: true });
    o.choiceContinuations = [];
    return handleTurn(req, res, { interview: v, transcript: tr });
  }
  if (ch.action === 'stay' && !o.after) ch = { ...ch, action: 'free' };
  const choiceId = `${v.id}-c${o.choices.length + 1}`, question = req.body.question || o.say;
  const audio = finalizing ? null : saveAudio(v, `c${o.choices.length + 1}`, req.file);
  if (tr) db.run('insert into transcript_turns values(?,?,?,?,?)', [choiceId, v.id, e.id, transcriptIndex(v.id), JSON.stringify({ id: choiceId, kind: 'choice', utteranceId: req.body.utteranceId, at: Date.now(), question, raw: tr.raw || heard, clean: heard, audio, asrSource: tr.source, questionId: req.body.questionId || o.responseId, clientTurnId: req.body.clientTurnId })]);
  o.choices.push({ id: choiceId, at: Date.now(), heard, raw: tr?.raw, clean: heard, audio, ...ch, cards: o.cards.map(c => c.nodeId) });
  o.choiceContinuations = [];
  let say, cards = null;
  const cur = o.plan.nodes[o.plan.currentNodeIndex];
  if (ch.action === 'help') { say = P.OPENING_NUDGE;
  } else if (ch.action === 'more') {
    cards = P.candidates(ai.FW, { profile: p, states, entities, lastSessionId: o.plan.lastSessionId, prevNodeId: o.plan.prevNodeId, exclude: [...o.shown, ...(o.after ? chatted(o) : [])] });
    o.cards = cards; o.shown = [...o.shown, ...cards.map(c => c.nodeId)];
    say = '好，那再换几个。' + P.choiceText(cards, { after: o.after }).replace(/^(今天|接下来)想聊哪个？/, '');
  } else if (ch.action === 'end') { say = null;
  } else if (ch.action === 'stay') { o.phase = 'chat';
    const d = Math.min(4, (o.plan.ask.depth || 1) + 1); o.plan.ask = { ...o.plan.ask, depth: d };
    say = '好，那咱们接着聊。' + P.questionFor(ai.FW, o.plan.ask.nodeId, d, p);
  } else if (ch.action === 'free') { o.phase = 'chat'; o.plan.free = true;
    v.stage = '自由聊聊';
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
    v.stage = P.nodeTitle(ai.FW, c.nodeId, p);
    say = `好，那咱们就聊${P.nodeTitle(ai.FW, c.nodeId, p)}。` + P.questionFor(ai.FW, sp.ask.nodeId, sp.ask.depth, p, sp.ask.trigger);
  }
  o.closing = ai.closing(p, { states, entities, plan: o.plan });
  o.say = say || o.say; o.responseId = `${v.id}:choice:${o.choices.length}`;
  console.log(`[choose] ${v.id} action=${ch.action} source=${ch.source} total=${Date.now() - t0}ms`);
  db.run('update interviews set opening=?, stage=? where id=?', [JSON.stringify(o), v.stage, v.id]);
  emitReply(req, res, o.responseId, say, o.plan.ask, o.phase);
  res.json({ responseId: o.responseId, turnId: tr ? choiceId : null, ...(tr ? { transcript: tr } : {}), heard, choice: ch, say, phase: o.phase, free: !!o.plan.free, cards: o.phase === 'choose' ? o.cards : null, after: o.after, ask: o.plan.ask, closing: o.closing, end: ch.action === 'end' }); }));
async function handleTurn(req, res, input = {}) { const v = input.interview || iv(req.params.id); if (!v) return res.status(404).json({});
  const e = elder(v.elder_id), p = withAutoCallName(e.profile), o = v.opening;
  if (v.finished) return res.status(409).json({ error: 'finished' });
  if (o.phase === 'choose') {
    // A previously accepted turn may propose new cards while the elder is
    // continuing the question they actually heard. Preserve that supplement.
    if (req.body.questionId && req.body.questionId !== o.responseId) o.phase = 'chat';
    else return res.status(409).json({ error: 'choose-required' });
  }
  const continuation = isTrue(req.body.continuation), finalizing = isTrue(req.body.finalizeContinuation);
  const prior = finalizing && v.turns.at(-1);
  if (finalizing && (!req.body.utteranceId || !prior?.continuation || prior.utteranceId !== req.body.utteranceId)) return res.status(409).json({ error: 'continuation-not-found' });
  const audio = finalizing ? prior.audio : saveAudio(v, `t${v.turns.length + 1}`, req.file);
  const t0 = Date.now();
  const wavMs = b => b.toString('ascii', 0, 4) === 'RIFF' && b.readUInt32LE(28) ? (b.length - 44) / b.readUInt32LE(28) * 1000 : 0;
  // 有录音：先试合并调用（听音频 + 出回复一次完成），失败再走 转写 → 生成 两步
  const liveTranscript = !req.body.manual ? realtimeTranscript(req, v.id) : null;
  const fused = !input.transcript && !liveTranscript && !finalizing && !continuation && !req.body.manual && req.file?.size > 1000 && process.env.GEMINI_FUSED !== '0' && !asrViaOpenai(); // 转写走 whisper 时不用 Gemini 合并调用
  let tr = finalizing ? { raw: prior.raw, clean: prior.clean, source: prior.asrSource } : input.transcript || (req.body.manual ? { raw: req.body.manual.trim(), clean: req.body.manual.trim(), source: 'manual' } : liveTranscript || (fused ? { raw: '', clean: '', source: 'gemini-fused' } : await ai.transcribe(req.file?.buffer, req.file?.mimetype, req.body.browserText)));
  if (!fused && !finalizing && !input.transcript) emitTranscript(req, res, tr);
  if (!fused && !(tr.clean || tr.raw || '').trim()) return noSpeech(res, tr, o.phase);
  const ask = captureAsk(req.body, o.plan.ask);
  const tid = finalizing ? prior.id : `${v.id}-t${v.turns.length + 1}`;
  // This is the mutable conversation projection. The already inserted raw/clean
  // transcript stays untouched; an empty terminal marker adds no user sentence.
  if (finalizing) { prior.continuation = false; prior.finalizedBy = req.body.clientTurnId; }
  else v.turns.push({ id: tid, q: req.body.question || o.say, questionId: req.body.questionId || '', utteranceId: req.body.utteranceId, clientTurnId: req.body.clientTurnId, continuation, interrupted: isTrue(req.body.interrupted), qid: `${ask.nodeId}:${ask.depth}`, ask, raw: tr.raw, clean: tr.clean, audio, at: Date.now(), asrSource: tr.source });
  const st = getState(e.id);
  let t1 = Date.now(), n = null; const ctx = { archive: e.archive, ...st, plan: { ...o.plan, ask, free: true }, delivery: eventsOf(v.id).filter(e => /interrupted|suppressed/.test(e.type)).slice(-8) };
  // Older sessions may have stored a substantive opening only as a choice.
  // Recover it for context without changing any original transcript record.
  const history = conversationHistory(ai.FW, p, v, transcriptOf(v.id));
  if (continuation) {
    const T = v.turns.at(-1);
    db.run('insert into transcript_turns values(?,?,?,?,?)', [tid, v.id, e.id, transcriptIndex(v.id), JSON.stringify({ ...T, question: T.q, idx: v.turns.length, nodeId: ask.nodeId, depth: ask.depth, deferred: true })]);
    db.run('update interviews set turns=? where id=?', [JSON.stringify(v.turns), v.id]);
    return res.json({ deferred: true, transcript: tr, phase: o.phase, turnId: tid, ask, timing: { total: Date.now() - t0, asr: Date.now() - t0, agent: 0 } });
  }
  if (fused) try { n = await ai.nextTurn(p, ctx, history, v.id, { audio: { buf: req.file.buffer, mime: req.file.mimetype, durMs: +req.body.durMs || wavMs(req.file.buffer) } }); tr = { raw: v.turns.at(-1).raw, clean: v.turns.at(-1).clean, source: 'gemini-fused' }; }
    catch (err) { if (err.message === ai.NO_SPEECH) return noSpeech(res, {}, o.phase); console.warn(`[turn] 合并调用失败 ${Date.now() - t1}ms → 回退两步`); tr = await ai.transcribe(req.file?.buffer, req.file?.mimetype, req.body.browserText); Object.assign(v.turns.at(-1), { raw: tr.raw, clean: tr.clean, asrSource: tr.source }); }
  if (!(tr.clean || tr.raw || '').trim()) return noSpeech(res, tr, o.phase);
  if (fused && n) { t1 = t0; } else t1 = Date.now();
  if (fused && !finalizing) emitTranscript(req, res, tr);
  const responseId = `${v.id}:reply:${v.turns.length}`;
  if (!n) n = await ai.nextTurn(p, ctx, history, v.id, {
    onReply: res.voiceEvent ? (text, meta) => emitReply(req, res, responseId, text, meta.ask, meta.phase) : undefined,
    onDraft: res.voiceEvent ? (text, meta) => emitReplyDraft(req, res, responseId, text, meta.ask, meta.phase) : undefined,
  }); const t2 = Date.now();
  console.log(`[turn] ${v.id}#${v.turns.length} source=${n.source} asr=${t1 - t0}ms agent=${t2 - t1}ms total=${t2 - t0}ms`);
  v.turns.at(-1).asrSource = tr.source; v.turns.at(-1).analysis = n.analysis; v.turns.at(-1).agent = { emotion: n.emotion, action: n.action, source: n.source };
  const T = v.turns.at(-1); // 第 2 层：逐轮访谈稿，写入后不再修改
  if (!finalizing) db.run('insert into transcript_turns values(?,?,?,?,?)', [tid, v.id, e.id, transcriptIndex(v.id), JSON.stringify({ id: tid, utteranceId: req.body.utteranceId, clientTurnId: req.body.clientTurnId, questionId: T.questionId, interrupted: T.interrupted, idx: v.turns.length, at: T.at, question: T.q, raw: T.raw, clean: T.clean, audio: T.audio, asrSource: T.asrSource, nodeId: n.analysis.nodeId, depth: n.analysis.depth, emotion: n.emotion, note: n.analysis.note, askedNode: ask.nodeId, askedDepth: ask.depth })]);
  const names = new Set((n.analysis.entities || []).map(x => x.name)); // 实体表每条注明出处句子
  for (const x of n.entities) if (names.has(x.name) || (x.aliases || []).some(a => names.has(a))) x.sourceTurns = [...new Set([...(x.sourceTurns || []), tid])];
  if (n.callName) { // 老人当场改口：写入档案称呼（后续轮次、下次访谈生效）
    const np = { ...e.profile, callName: n.callName, callNameBy: 'elder', callNameManual: true }, arc = { ...e.archive, callName: n.callName, callNameAt: Date.now() };
    db.run('update elders set profile=?, archive=? where id=?', [JSON.stringify(np), JSON.stringify(arc), e.id]); console.log(`[callName] ${e.id} updated`); }
  let cards = null;
  if (n.switch) { // 聊够了：念出新候选让老人选（继续聊这个 / 今天先到这），不直接跳
    const tmp = { ...o, plan: n.plan };
    cards = P.candidates(ai.FW, { profile: p, states: n.states, entities: n.entities, lastSessionId: n.plan.lastSessionId, prevNodeId: n.plan.ask.nodeId, exclude: chatted(tmp) });
    Object.assign(o, { phase: 'choose', after: true, cards, shown: [...(o.shown || []), ...cards.map(c => c.nodeId)] });
    n.say = ai.keepAck(n.say) + P.choiceText(cards, { after: true }); }
  setState(e.id, { states: n.states, entities: n.entities }); o.plan = n.plan; o.closing = ai.closing(n.callName ? { ...p, callName: n.callName } : p, { states: n.states, entities: n.entities, plan: n.plan });
  o.say = n.say; o.responseId = `${v.id}:reply:${v.turns.length}`;
  if (input.interview || history.length > v.turns.length || !n.analysis.nodeId || n.analysis.nodeId !== ask.nodeId) v.stage = '自由聊聊';
  db.run('update interviews set turns=?, opening=?, stage=? where id=?', [JSON.stringify(v.turns), JSON.stringify(o), v.stage, v.id]);
  emitReply(req, res, o.responseId, n.say, n.plan.ask, cards ? 'choose' : 'chat');
  if (n.streamInterrupted) res.voiceEvent?.({ type: 'error', code: 'reply-interrupted', retryable: false, recoverable: true });
  res.json({ responseId: o.responseId, ...(n.streamInterrupted ? { replyInterrupted: true } : {}), turnId: tid, timing: { total: t2 - t0, asr: finalizing ? 0 : n.source === 'gemini-fused' ? null : t1 - t0, agent: t2 - t1, fused: n.source === 'gemini-fused' }, ...(finalizing ? { finalized: true } : { transcript: tr }), next: { emotion: n.emotion, action: n.action, say: n.say, done: n.done, source: n.source, analysis: n.analysis, ask: n.plan.ask, phase: cards ? 'choose' : 'chat', free: !!n.plan.free, cards }, closing: o.closing, ...(n.callName ? { profile: elder(e.id).profile } : {}) });
}
app.post('/api/interviews/:id/turn', serial('turn', true, handleTurn));
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
app.post('/api/interviews/:id/finish', serial('finish', false, async (req, res) => { const v = iv(req.params.id); if (!v) return res.status(404).json({});
  const previous = one('select id from stories where interview_id=? order by created limit 1', [v.id]);
  if (v.finished) return res.json({ storyId: previous?.id || null });
  const e = elder(v.elder_id), p = { ...e.profile, stage: v.stage };
  if (!v.turns.length) { db.run('update interviews set finished=1 where id=?', [v.id]); return res.json({ storyId: null }); }
  const tf = v.finishedAt = Date.now();
  // Story generation waits for accepted turns. Mark finished only when its story
  // and idempotent result can be saved together.
  const s = await ai.story(p, v.turns);
  console.log(`[story] ${v.id} source=${s.source} total=${Date.now() - tf}ms`);
  const sid = uid('s');
  db.run('insert into stories values(?,?,?,?,?)', [sid, e.id, v.id, Date.now(), JSON.stringify({ ...s, stage: v.stage, paras: linkParas(s.body, v.turns), clips: v.turns.map(t => ({ id: t.id, q: t.q, text: t.clean, audio: t.audio })) })]);
  db.run('update interviews set finished=1 where id=?', [v.id]);
  res.json({ storyId: sid }); queueArchive(e.id, v, p);
}));
// 第 3 层：故事每段引用第 2 层句子 id（按字的重合度对齐），可回溯原声
const bigrams = t => { const c = (t || '').replace(/[\s，。,.！!？?…、“”"：:；;]/g, ''), r = new Set(); for (let i = 0; i < c.length - 1; i++) r.add(c.slice(i, i + 2)); return r; };
function linkParas(body, turns) { const tb = turns.map(t => ({ id: t.id, b: bigrams(t.clean || t.raw) }));
  return (body || '').split(/\n+/).filter(x => x.trim()).map(text => { const b = bigrams(text);
    const sc = tb.map(t => ({ id: t.id, s: [...b].filter(x => t.b.has(x)).length / Math.max(1, Math.min(b.size, t.b.size)) })).filter(x => x.s >= 0.25).sort((a, c) => c.s - a.s);
    return { text, refs: sc.slice(0, 2).map(x => x.id) }; }); }
const transcriptOf = iid => all('select data from transcript_turns where interview_id=? order by idx', [iid]).map(r => J(r.data));
const storyOut = s => { const d = J(s.data), v = iv(s.interview_id); return { id: s.id, created: s.created, elder: elder(s.elder_id).profile, ...d, quotes: Array.isArray(d.quotes) ? d.quotes.join(' ') : d.quotes, paras: d.paras || linkParas(d.body, v?.turns || []), transcript: transcriptOf(s.interview_id), fullAudio: v?.opening?.fullAudio || null, fullSegments: v?.opening?.fullSegments || [], events: eventsOf(s.interview_id),
  edits: all('select * from edits where target=? and target_id=? order by at', ['story', s.id]) }; };
app.get('/api/stories/:id', (req, res) => { const s = one('select * from stories where id=?', [req.params.id]); s ? res.json(storyOut(s)) : res.status(404).json({}); });
// 家人修改故事：只改第 3 层，旧值写入 edits 留痕；原话（第 2 层）不动
app.put('/api/stories/:id', (req, res) => { const s = one('select * from stories where id=?', [req.params.id]); if (!s) return res.status(404).json({});
  const d = J(s.data), by = req.body.by || '家人';
  for (const f of ['title', 'body']) if (typeof req.body[f] === 'string' && req.body[f] !== d[f]) {
    db.run('insert into edits values(?,?,?,?,?,?,?,?,?)', [uid('x'), s.elder_id, 'story', s.id, f, d[f], req.body[f], by, Date.now()]); d[f] = req.body[f]; }
  d.paras = linkParas(d.body, transcriptOf(s.interview_id).map(t => ({ id: t.id, clean: t.clean, raw: t.raw })));
  db.run('update stories set data=? where id=?', [JSON.stringify(d), s.id]); save(); res.json(storyOut(one('select * from stories where id=?', [s.id]))); });
// 第 1 层：每个上传是完整可解码文件，暂停恢复与切块边界单独记录。
app.post('/api/interviews/:id/full', serial('full', true, async (req, res) => { const v = iv(req.params.id); if (!v || !req.file?.size) return res.status(400).json({ error: 'audio-required' });
  if (v.finished) return res.status(409).json({ error: 'finished' });
  const o = v.opening, segmented = req.body.sequence !== undefined;
  if (segmented) {
    const sequence = Number(req.body.sequence); if (!Number.isSafeInteger(sequence) || sequence < 0) return res.status(400).json({ error: 'invalid-sequence' });
    let decoded; try { decoded = readWav(req.file.buffer); } catch { return res.status(400).json({ error: 'invalid-wav' }); }
    o.fullSegments ||= [];
    if (o.fullSegments.some(x => x.sequence === sequence)) return res.status(409).json({ error: 'segment-sequence-conflict' });
    const name = saveAudio(v, `full-part${sequence}`, { ...req.file, mimetype: 'audio/wav' });
    o.fullSegments.push({ sequence, audio: name, startedAt: +req.body.startedAt || null, endedAt: +req.body.endedAt || null, boundary: String(req.body.boundary || 'segment').slice(0, 40), durationMs: decoded.durationMs });
    o.fullSegments.sort((a, b) => a.sequence - b.sequence);
    const full = `${v.id}-full.wav`;
    rebuildFull(full, o.fullSegments); o.fullAudio = full;
  } else o.fullAudio = saveAudio(v, 'full', req.file);
  db.run('update interviews set opening=? where id=?', [JSON.stringify(o), v.id]); res.json({ fullAudio: o.fullAudio, fullSegments: o.fullSegments || [] });
}));
app.post('/api/interviews/:id/events', serial('events', false, async (req, res) => {
  const v = iv(req.params.id); if (!v) return res.status(404).json({});
  const type = String(req.body.type || '');
  if (!/^(playback[-_:])?(started|completed|interrupted|suppressed)$|^(pause|resume|device-lost|closed)$/.test(type)) return res.status(400).json({ error: 'invalid-event' });
  const id = `${v.id}:${String(req.body.eventId || uid('event')).slice(0, 200)}`;
  const event = { eventId: id, type, at: Number(req.body.at) || Date.now(), responseId: String(req.body.responseId || '').slice(0, 200), question: String(req.body.question || '').slice(0, 2000) };
  if (typeof req.body.displayed === 'boolean') event.displayed = req.body.displayed;
  db.run('insert or ignore into interview_events values(?,?,?,?)', [id, v.id, event.at, JSON.stringify(event)]);
  res.json({ saved: true, eventId: id });
}));
app.get('/api/interviews/:id', (req, res) => {
  const v = iv(req.params.id); if (!v) return res.status(404).json({}); const o = v.opening;
  // 仅刷新还没开始回答的旧开场显示；已存问题快照和原话不改。
  const fresh = !v.finished && o.phase === 'choose' && !o.after && !v.turns.length && !o.choices?.length && !o.choiceContinuations?.length && transcriptIndex(v.id) === 1;
  const display = fresh ? { say: P.greetText(ai.FW, o.plan, { profile: elder(v.elder_id).profile }), responseId: `${v.id}:opening:bank` } : {};
  res.json({ id: v.id, elderId: v.elder_id, profile: elder(v.elder_id).profile, p: elder(v.elder_id).profile, say: o.say, responseId: o.responseId || `${v.id}:opening`, ...display, phase: o.phase || 'chat', free: !!o.plan.free, cards: o.cards || [], ask: o.plan.ask, closing: o.closing, after: !!o.after, isReturn: !!o.plan.lastSessionId, turns: v.turns, transcript: transcriptOf(v.id), finished: !!v.finished, fullAudio: o.fullAudio, fullSegments: o.fullSegments || [], events: eventsOf(v.id) });
});
// 一键打包：原声 + 访谈稿 + 故事 + 档案（数据归家人所有）
app.get('/api/elders/:id/export.zip', async (req, res) => { const e = elder(req.params.id); if (!e) return res.status(404).json({});
  const z = new JSZip(), st = getState(e.id), name = e.profile.name || '老人';
  const ivs = all('select * from interviews where elder_id=? order by created', [e.id]).map(r => ({ ...r, turns: J(r.turns), opening: J(r.opening) }));
  z.file('说明.txt', `记忆银行 · ${name} 的全部记忆\n导出时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n\n1-原声/：每次访谈的完整录音（*-full）和每句回答的片段（*-tN）\n2-访谈稿/：逐轮原始记录（AI 问句、原始转写、整理文本、音频、节点、层次、情绪），永不修改\n3-加工成果/：记忆故事（每段注明引用的句子 id）、记忆档案、实体表、家人修改记录\n`);
  if (e.profile.demoNotice) {
    z.file('演示说明.txt', `${e.profile.demoNotice}\n${e.archive.disclosure || ''}\n${e.archive.processing || ''}\n本演示没有历史人物原声。时间码与2026日期为模拟排期。\n`);
    z.file('采访者.json', JSON.stringify(e.archive.interviewer || e.profile.demoInterviewer, null, 2));
  }
  for (const v of ivs) { const T = transcriptOf(v.id), d = new Date(v.created).toLocaleDateString('sv', { timeZone: 'Asia/Shanghai' });
    for (const f of [v.opening?.fullAudio, ...(v.opening?.fullSegments || []).map(x => x.audio), ...T.map(t => t.audio), ...v.turns.map(t => t.audio)].filter(Boolean)) { const fp = path.join(AUDIO, f); if (fs.existsSync(fp)) z.file(`1-原声/${f}`, fs.readFileSync(fp)); }
    z.file(`2-访谈稿/${d}-${v.id}.json`, JSON.stringify({ interviewId: v.id, created: v.created, topic: v.stage, opening: v.opening?.say, interviewer: v.opening?.interviewer, disclosure: v.opening?.disclosure, plan: v.opening?.plan, fullSegments: v.opening?.fullSegments || [], events: eventsOf(v.id), turns: T }, null, 2));
    z.file(`2-访谈稿/${d}-${v.id}.txt`, `${e.profile.demoNotice || ''}\n${v.stage || ''}  ${d}\n\n` + (v.opening?.interviewer ? '' : `小忆：${v.opening?.say || ''}\n\n`) + T.map(t => `[${t.id}] ${t.interviewer || '小忆'}：${t.question}\n${name}（${t.fictional ? '原始对话稿' : '原始转写'}）：${t.raw || ''}\n${name}（整理）：${t.clean || ''}\n  节点 ${t.nodeId} · 第${t.depth}层 · ${t.emotion || ''}${t.audio ? ` · 音频 1-原声/${t.audio}` : ''}`).join('\n\n') + (v.opening?.interviewer ? `\n\n${v.opening.interviewer.name}：${v.opening.closing || ''}\n` : '')); }
  for (const s of all('select * from stories where elder_id=? order by created', [e.id])) { const o = storyOut(s);
    z.file(`3-加工成果/故事/${s.id}.json`, JSON.stringify({ ...o, transcript: undefined }, null, 2));
    z.file(`3-加工成果/故事/${s.id}.md`, `# ${o.title}\n\n${o.disclosure ? o.disclosure + '\n\n' : ''}` + o.paras.map(p => `${p.text}${p.refs.length ? `  〔原话：${p.refs.join('、')}〕` : ''}`).join('\n\n') + `\n\n${o.quotes || ''}\n`); }
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
const httpServer=createServer(app);
attachRealtimeASR(app,httpServer);
app.use('/api', (_, res) => res.status(404).json({ error: 'not found' }));
const PORT = +(process.env.PORT || 8787), HOST = process.env.HOST || '0.0.0.0';
// 启动后后台预热固定话术（不阻塞启动）：演示老人的候选念白、选题回应、收尾、通用回应
function warmTTS() { if (!(status.hasKey || DS) || process.env.GEMINI_TTS_WARM === '0') return;
  setTimeout(async () => { const t0 = Date.now(), texts = [...ACKS]; // 短回应最先预热
    try { for (const e of all('select id from elders').map(r => elder(r.id))) { const p = withAutoCallName(e.profile), { plan, states, entities } = makePlan(e, null);
        let ex = []; for (let k = 0; k < 2; k++) { const c = P.candidates(ai.FW, { profile: p, states, entities, lastSessionId: plan.lastSessionId, prevNodeId: plan.prevNodeId, exclude: ex }); ex.push(...c.map(x => x.nodeId));
          texts.push(P.choiceText(c), P.choiceText(c, { after: true }), '好，那再换几个。', ...c.map(x => `好，那咱们就聊${P.nodeTitle(ai.FW, x.nodeId, p)}。` + P.questionFor(ai.FW, x.nodeId, x.startDepth || 1, p))); }
        texts.push(ai.closing(p, { states, entities, plan }), P.fillAll('好，{称呼}想聊什么都行，想到哪儿说到哪儿。您想先讲讲哪件事呀？', p), '好，那咱们接着聊。'); }
      texts.push('嗯，是这样。', '没关系，想不起来就不想了。', '说起他，您心里肯定还惦记着。', '这段我都好好记下了。');
      const n = await tts.warm(texts.map(t => P.speakable ? P.speakable(t) : t)); console.log(`[tts] 预热完成 新合成 ${n} 句 ${Date.now() - t0}ms`); } catch (e) { console.warn('[tts] 预热失败', e.message.slice(0, 80)); } }, 1000); }
const listener = httpServer.listen(PORT, HOST, () => { warmTTS(); console.log(`memory-bank on ${HOST}:${listener.address().port}${fs.existsSync(DIST) ? ' (含前端 dist)' : ''}, data=${DATA}, gemini key ${status.hasKey ? 'present' : 'missing（走兜底）'}`); });
