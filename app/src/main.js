// 记忆银行前端（记忆册版）：后端账户 + Gemini 访谈；后端不可达时回退到本地离线流程。视图模板在 views.js，声音在 audio.js
import { SCRIPT, DEMO_PROFILE, fill } from './questions.js';
import { autoCallName, callNameOf } from './callname.js';
import FW from './framework.json';
import * as P from './planner.js';
import { generateStory } from './story.js';
import { saveStory, listStories, getStory } from './db.js';
import { speak, stopSpeak, unlockAudio, playAck, ackPlayer } from './audio.js';
import * as V from './views.js';
const $app = document.getElementById('app');
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const api = async (u, o = {}) => { const r = await fetch('/api' + u, { ...o, headers: o.body instanceof FormData ? {} : { 'Content-Type': 'application/json' } }); if (!r.ok) throw new Error(r.status); return r.json(); };
const post = (u, b) => api(u, { method: 'POST', body: b instanceof FormData ? b : JSON.stringify(b) });
let elderId = localStorage.getItem('mb_elder'), cache = null, session = null;
const getProfile = () => cache?.profile || JSON.parse(localStorage.getItem('mb_profile') || 'null');
async function load() { if (!elderId) return null; try { cache = await api('/elders/' + elderId); } catch { cache = null; } return cache; }
async function setProfile(p) { localStorage.setItem('mb_profile', JSON.stringify(p));
  try { const e = await post('/elders', { id: elderId, profile: p }); elderId = e.id; localStorage.setItem('mb_elder', e.id); cache = e; } catch {} }
const routes = { '': home, family, profile, stage: stagePick, interview, story, library, archive, map: lifeMap };
const route = async () => { const [p, id] = location.hash.slice(2).split('/'); await load(); document.body.dataset.view = p || 'home'; (routes[p || ''] || home)(id); window.scrollTo(0, 0); };
window.addEventListener('hashchange', route);
const go = h => location.hash = h;
const day = t => new Date(t).toLocaleDateString('zh-CN');
const $ = id => document.getElementById(id), esc = V.esc;

function home() { const p = getProfile(); if (!p) return family();
  $app.innerHTML = V.elderHome({ name: callNameOf(p) });
  $('start').onclick = () => { unlockAudio(); setReq(null); go('#/interview'); }; }
function family() {
  const p = getProfile(), n = cache?.interviews?.filter(i => i.finished).length || 0, s0 = cache?.stories?.[0];
  const cov = p ? FW.nodes.filter(x => P.st(cache?.states || {}, x.id).status !== 'not_started').length : 0;
  $app.innerHTML = V.familyHome({ name: p ? callNameOf(p) : '', n, cov, total: FW.nodes.length, elderId, latest: p && s0 ? { id: s0.id, title: s0.title, date: day(s0.created) } : null });
  $('start').onclick = () => go(p ? '#/stage' : '#/profile'); }
function profile() {
  const p = getProfile() || {};
  $app.innerHTML = V.profileForm(p);
  const f = document.getElementById('f'), cn = f.callName, man = f.callNameManual;
  const auto = () => { if (!man.value) cn.value = autoCallName(f.name.value, f.gender.value); }; // 手动改过就不再自动覆盖
  f.name.oninput = auto; f.gender.onchange = auto; cn.oninput = () => { man.value = cn.value.trim() ? '1' : ''; if (!man.value) auto(); }; auto();
  f.onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(f)); const np = { ...p, ...d, callNameManual: !!d.callNameManual };
    if (np.callName !== p.callName) delete np.callNameBy; await setProfile(np); go('#/stage'); };
  document.getElementById('demo').onclick = async () => { if (!elderId) { elderId = 'demo-wang'; localStorage.setItem('mb_elder', elderId); } await setProfile(DEMO_PROFILE); go('#/stage'); }; // 演示：接上服务器预置的王女士数据
}
// 会话规划页：自动选题 + 家人指定（节点或触发物）
const getReq = () => JSON.parse(sessionStorage.getItem('mb_req') || 'null');
const setReq = r => r ? sessionStorage.setItem('mb_req', JSON.stringify(r)) : sessionStorage.removeItem('mb_req');
async function stagePick() {
  const p = getProfile(); if (!p) return go('#/profile');
  const req = getReq(); let d = null;
  try { d = await api(`/elders/${elderId}/plan${req ? '?' + new URLSearchParams(Object.entries(req).filter(([, v]) => v)) : ''}`); } catch {}
  const plan = d?.plan || P.offlineQuestions(FW, p, req).plan, v = d?.vars || P.planVars(FW, plan, { profile: p });
  const T = id => P.nodeTitle(FW, id, p), x = plan.nodes[plan.currentNodeIndex || 0] || plan.nodes[0];
  $app.innerHTML = V.planPage({ name: callNameOf(p), topic: v.今天话题, first: x ? T(x.nodeId) : '', ask: v.当前话题入场问题, lastTopic: cache?.archive?.lastTopic,
    triggers: Object.entries(FW.dimensions.trigger.values), req, reqLabel: req ? (req.nodeId ? T(req.nodeId) : FW.dimensions.trigger.values[req.trigger]) : '' });
  $('go').onclick = () => go('#/interview');
  $app.querySelectorAll('.trig').forEach(b => b.onclick = () => { setReq(req?.trigger === b.dataset.t ? null : { trigger: b.dataset.t }); stagePick(); });
  const c = $('clr'); if (c) c.onclick = () => { setReq(null); stagePick(); };
}
function lifeMap() {
  const p = getProfile() || {}, states = cache?.states || {}, cov = P.coverage(FW, states);
  const node = n => { const s = P.st(states, n.id); return { id: n.id, title: P.nodeTitle(FW, n.id, p), status: s.status, depth: s.depth, sensitive: s.sensitive }; };
  $app.innerHTML = V.lifeMap({ name: callNameOf(p), eras: Object.entries(FW.dimensions.time.values).map(([t, label]) => ({ label, nodes: FW.nodes.filter(n => n.tags.time === t).map(node) })),
    covs: ['relation', 'domain', 'trigger'].map(dim => ({ label: FW.dimensions[dim].label, rows: cov[dim] })) });
  $app.querySelectorAll('.node[data-n]').forEach(b => b.onclick = () => { setReq({ nodeId: b.dataset.n }); go('#/stage'); });
}
async function interview() {
  const p = getProfile(); if (!p) return go('#/profile');
  $app.innerHTML = V.loading('小忆来啦，正在翻看上次的记录……');
  try { if (!elderId) throw 0; const o = await post('/interviews', { elderId, request: getReq() }); setReq(null);
    startFull();
    session = { online: true, id: o.id, p, say: o.say, n: 0, isReturn: o.isReturn, log: [], topic: o.topic, ask: o.ask, closing: o.closing, phase: o.phase || 'chat', cards: o.cards, after: false };
  } catch { const req = getReq(); setReq(null); const cards = P.candidates(FW, { profile: p, request: req }); // 无网兜底：本地出候选、本地解析选择
    session = { online: false, p, n: 0, answers: [], log: [], phase: 'choose', cards, shown: cards.map(c => c.nodeId), after: false,
      say: P.greetText(FW, P.offlineQuestions(FW, p, req).plan, { profile: p }, false) + P.choiceText(cards) }; }
  renderTurn();
}
function topicLabel(s) {
  const t = s.ask?.nodeId ? P.nodeTitle(FW, s.ask.nodeId, s.p) : '';
  if (!t) return s.isReturn ? '接着上次聊' : '今天聊聊';
  if (s.isReturn && s.n === 0) return `接着聊${t}`;
  return `今天聊${t}`;
}
function renderTurn() {
  const s = session, text = s.say, choosing = s.phase === 'choose';
  $app.innerHTML = choosing ? V.choosePage({ heading: s.after ? '接下来想聊什么' : (s.isReturn ? '接着上次，想聊哪个？' : '今天想聊哪个？'), say: text, cards: s.cards || [], after: s.after })
    : V.talkPage({ heading: topicLabel(s), said: s.log.at(-1), say: text });
  const live = $('live'), manual = $('manual'), micl = $('micl'), mic = $('mic');
  let rec = null, sr = null, chunks = [], btext = '', recording = false, busy = false;
  $('replay').onclick = () => speak(text);
  if (choosing) { const lock = () => $app.querySelectorAll('.tcard,[data-a]').forEach(b => b.disabled = true);
    $app.querySelectorAll('.tcard').forEach(b => b.onclick = () => { lock(); b.classList.add('on'); choose({ action: 'pick', index: +b.dataset.i }); });
    $app.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { lock(); choose({ action: b.dataset.a }); }); }
  setTimeout(() => speak(text), 300);
  mic.onclick = async () => {
    if (busy) return;
    if (!recording) {
      stopSpeak(); ackPlayer.pause();
      try { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); rec = new MediaRecorder(st); chunks = []; rec.ondataavailable = e => chunks.push(e.data); rec.start(); recAt = Date.now(); }
      catch { live.textContent = '没能打开麦克风，可以手动补记'; manual.classList.remove('hidden'); }
      if (SR && !s.online) { sr = new SR(); sr.lang = 'zh-CN'; sr.continuous = true; sr.interimResults = true; // 仅离线兜底用浏览器识别
        sr.onresult = ev => { btext = [...ev.results].map(r => r[0].transcript).join(''); live.textContent = btext; }; try { sr.start(); } catch {} }
      recording = true; mic.classList.add('rec'); micl.textContent = '说完了，点一下'; live.textContent = '我在听…';
    } else {
      recording = false; busy = true; if (!choosing && s.online) playAck(); // 选题阶段不播短回应
      mic.classList.remove('rec'); sr?.stop();
      const th = $('thinking'), tt = $('thinkt'); th.classList.remove('hidden'); mic.classList.add('hidden'); live.classList.add('hidden');
      const tmr = setTimeout(() => tt.textContent = '小忆在想下一个问题……', 2500);
      const blob = await new Promise(res => { if (!rec || rec.state === 'inactive') return res(null);
        rec.onstop = () => res(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })); rec.stop(); rec.stream.getTracks().forEach(t => t.stop()); });
      if (choosing) await choose({ blob, manual: manual.value.trim(), btext }); else await answer(blob, manual.value.trim(), btext); clearTimeout(tmr);
    }
  };
  document.getElementById('end')?.addEventListener('click', finish);
}
// 选话题：点卡片 / 按钮（action），或录音、打字（交给后端：Gemini 判断 + 规则兜底）；无网时本地规则解析
async function choose({ action, index, blob, manual, btext }) {
  const s = session; stopSpeak();
  if (s.online) {
    const fd = new FormData(); if (action) { fd.append('action', action); fd.append('index', index ?? 0); }
    if (blob) { fd.append('audio', blob, 'a.webm'); if (recAt) fd.append('durMs', Date.now() - recAt); } if (manual) fd.append('manual', manual); if (btext) fd.append('browserText', btext);
    try { const r = await post(`/interviews/${s.id}/choose`, fd);
      if (r.end) return finish();
      Object.assign(s, { phase: r.phase, cards: r.cards || s.cards, ask: r.ask, closing: r.closing || s.closing, say: r.say, heard: r.heard });
      if (r.heard) s.log.push(r.heard);
      return renderTurn();
    } catch { s.online = false; }
  }
  const ch = action ? { action, index } : P.parseChoice(FW, manual || btext || '', s.cards, s.p);
  if (ch.action === 'end') return finish();
  if (ch.action === 'more') { s.cards = P.candidates(FW, { profile: s.p, exclude: s.shown }); s.shown.push(...s.cards.map(c => c.nodeId)); s.say = '好，那再换几个。' + P.choiceText(s.cards).replace(/^今天想聊哪个？/, ''); return renderTurn(); }
  const nodeId = ch.action === 'pick' ? (s.cards[ch.index]?.nodeId || ch.nodeId || s.cards[0].nodeId) : s.cards[0].nodeId;
  const { qs, plan } = P.offlineQuestions(FW, s.p, { nodeId });
  Object.assign(s, { phase: 'chat', qs, plan, answers: [], closing: P.closingText(FW, plan, { profile: s.p }), say: (ch.action === 'free' ? '好，想聊什么都行。' : `好，那咱们就聊${P.nodeTitle(FW, nodeId, s.p)}。`) + qs[0].text });
  renderTurn();
}
let recAt = 0;
async function answer(blob, manualText, btext) {
  const s = session;
  if (s.online) {
    const fd = new FormData(); if (blob) fd.append('audio', blob, 'a.webm'); fd.append('question', s.say); if (manualText) fd.append('manual', manualText); if (btext) fd.append('browserText', btext);
    try { const r = await post(`/interviews/${s.id}/turn`, fd); s.log.push(r.transcript.clean || '……'); s.n++; s.ask = r.next.ask; s.closing = r.closing || s.closing; if (r.profile) { localStorage.setItem('mb_profile', JSON.stringify(r.profile)); if (cache) cache.profile = r.profile; }
      if (r.next.done) { session.closedSpoken = !!r.next.say; if (r.next.say) await speak(r.next.say); return finish(); } s.say = r.next.say;
      if (r.next.phase === 'choose') Object.assign(s, { phase: 'choose', cards: r.next.cards, after: true }); return renderTurn();
    } catch { s.online = false; const o = P.offlineQuestions(FW, s.p, s.ask?.nodeId ? { nodeId: s.ask.nodeId } : null); s.qs = o.qs; s.plan = o.plan; s.answers = []; }
  }
  const q = s.qs[s.answers.length] || s.qs.at(-1); s.answers.push({ question: q.text, stage: P.nodeTitle(FW, q.nodeId, s.p), text: manualText || btext, audio: blob });
  s.log.push(manualText || btext || '……'); s.n++;
  if (s.answers.length >= s.qs.length) return finish();
  await speak(fill(SCRIPT.acks[s.n % 3], s.p)); s.say = s.qs[s.answers.length].text; renderTurn();
}
// 第 1 层原声：整场完整录音（与逐句片段并存）
let full = null;
async function startFull() { try { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); const r = new MediaRecorder(st), ch = []; r.ondataavailable = e => ch.push(e.data); r.start(1000); full = { r, ch }; } catch { full = null; } }
async function stopFull(id) { if (!full) return; const { r, ch } = full; full = null;
  const b = await new Promise(res => { r.onstop = () => res(new Blob(ch, { type: r.mimeType || 'audio/webm' })); r.stop(); r.stream.getTracks().forEach(t => t.stop()); });
  if (b.size && id) { const fd = new FormData(); fd.append('audio', b, 'full.webm'); await post(`/interviews/${id}/full`, fd).catch(() => {}); } }
async function finish() {
  stopSpeak(); if (!session.closedSpoken) speak(P.speakable(session.closing || fill(SCRIPT.closing, session.p)));
  $app.innerHTML = V.loading('小忆在把您的故事写下来……', '就几秒钟，您歇一歇');
  if (session.online) { await stopFull(session.id); try { const r = await post(`/interviews/${session.id}/finish`, {}); return go(r.storyId ? '#/story/' + r.storyId : '#/'); } catch {} }
  const st = await generateStory(session.answers || [], session.p), id = 'local' + Date.now();
  await saveStory({ id, createdAt: Date.now(), ...st, profile: session.p, answers: session.answers || [] }); go('#/story/' + id);
}
async function story(id) {
  let s; if (id.startsWith('local')) { const l = await getStory(id); s = l && { ...l, created: l.createdAt, elder: l.profile, clips: l.answers.map(a => ({ q: a.question, text: a.text, src: a.audio && URL.createObjectURL(a.audio) })) }; }
  else s = await api('/stories/' + id).catch(() => null);
  if (!s) return go('#/library');
  const T = Object.fromEntries((s.transcript || []).map(t => [t.id, t])), clipOf = id => T[id] || (s.clips || []).find(c => c.id === id);
  const paras = s.paras || (s.body || '').split(/\n+/).map(text => ({ text, refs: [] }));
  const au = a => a ? (a.startsWith('blob:') ? a : '/api/audio/' + a) : null;
  const turns = (s.transcript?.length ? s.transcript : (s.clips || []).map((c, k) => ({ id: c.id || 'c' + k, question: c.q, raw: c.text, clean: c.text, audio: c.audio || c.src }))).map(t => ({ ...t, audio: au(t.audio) }));
  $app.innerHTML = V.storyPage({ id, date: day(s.created), teller: s.elder.name, stage: s.stage, title: s.title, paras, quotes: s.quotes, people: s.people, timePlace: s.timePlace,
    fullAudio: au(s.fullAudio), turns, editable: !id.startsWith('local'), edits: (s.edits || []).map(x => ({ ...x, at: new Date(x.at).toLocaleString('zh-CN') })) });
  if (matchMedia('(min-width: 1024px)').matches) $('tx').open = true; // 桌面：原声访谈稿默认展开在右栏
  const player = new Audio();
  $app.querySelectorAll('.play').forEach(b => b.onclick = () => { const refs = paras[b.dataset.k].refs.map(clipOf).filter(Boolean), c = refs[0]; if (!c) return;
    const a = au(c.audio || c.src); document.getElementById('tx').open = true; document.getElementById(c.id)?.classList.add('hl');
    if (a) { player.src = a; player.play().catch(() => speak(c.clean || c.text)); } else speak(c.clean || c.text); });
  const ed = document.getElementById('edit'); if (ed) ed.onclick = () => { const art = $app.querySelector('article');
    art.outerHTML = `<form id="ef" class="edit"><input name="title" value="${esc(s.title)}"><textarea name="body" rows="14">${esc(s.body)}</textarea><button class="primary">保存修改</button></form>`; ed.remove();
    document.getElementById('ef').onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
      await fetch('/api/stories/' + id, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...f, by: '家人' }) }); story(id); }; };
  $('share').onclick = () => navigator.share ? navigator.share({ title: s.title, text: s.body, url: location.href }).catch(() => {}) : (navigator.clipboard?.writeText(s.title + '\n\n' + s.body), alert('故事文字已复制，可以发给家人'));
}
async function library() {
  const list = [...(cache?.stories || []), ...(await listStories()).map(l => ({ ...l, created: l.createdAt, local: true }))];
  $app.innerHTML = V.libraryPage({ list: list.map(s => ({ id: s.id, title: s.title, meta: `${day(s.created)}${s.stage ? ' · ' + s.stage : ''} · ${(s.clips || s.answers || []).length} 段原声${s.local ? ' · 本机' : ''}` })) });
  $('again').onclick = () => go('#/stage');
}
function archive() {
  const a = cache?.archive || {}, p = getProfile() || {};
  const ivs = (cache?.interviews || []).filter(i => i.finished).map(i => ({ ...i, when: new Date(i.created).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }));
  const entities = (cache?.entities || []).map(x => ({ ...x, relation: x.relation ? (FW.dimensions.relation.values[x.relation] || x.relation) : '', from: (x.sourceNodes || []).map(id => P.nodeTitle(FW, id, p)).join('、'), notes: x.notes?.length ? x.notes.slice(-2).join('；') : '' }));
  $app.innerHTML = V.archivePage({ name: callNameOf(p), pending: cache?.archivePending, lastTopic: a.lastTopic, entities, a, ivs });
  if (cache?.archivePending) setTimeout(async () => { if (!location.hash.startsWith('#/archive')) return; await load(); archive(); }, 3000);
}
document.addEventListener('pointerdown', unlockAudio, { once: true }); // 首次点击解锁音频（「开始聊天」也会再解锁一次）
route();
