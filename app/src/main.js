// v2：后端账户 + Gemini 访谈 Agent；后端不可达时回退到 v1 本地离线流程（固定问题 + 演示故事）
import { SCRIPT, DEMO_PROFILE, DEMO_ANSWERS, DEMO_ANSWERS_2, fill } from './questions.js';
import { autoCallName, callNameOf } from './callname.js';
import FW from './framework.json';
import * as P from './planner.js';
import { generateStory } from './story.js'; import { splitSentences, firstShort, ACKS, pickAck } from './split.js';
import { saveStory, listStories, getStory } from './db.js';
const $app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const api = async (u, o = {}) => { const r = await fetch('/api' + u, { ...o, headers: o.body instanceof FormData ? {} : { 'Content-Type': 'application/json' } }); if (!r.ok) throw new Error(r.status); return r.json(); };
const post = (u, b) => api(u, { method: 'POST', body: b instanceof FormData ? b : JSON.stringify(b) });
let elderId = localStorage.getItem('mb_elder'), cache = null, session = null, aiMode = '…';
const getProfile = () => cache?.profile || JSON.parse(localStorage.getItem('mb_profile') || 'null');
async function load() { if (!elderId) return null; try { cache = await api('/elders/' + elderId); } catch { cache = null; } return cache; }
async function setProfile(p) { localStorage.setItem('mb_profile', JSON.stringify(p));
  try { const e = await post('/elders', { id: elderId, profile: p }); elderId = e.id; localStorage.setItem('mb_elder', e.id); cache = e; } catch {} }
api('/health').then(h => aiMode = h.gemini.ok === false ? '演示模式' : h.gemini.hasKey ? 'AI 在线' : '演示模式').catch(() => aiMode = '离线');

// 小忆语音：Gemini TTS（Kore）按句合成，第一句好了就播，后面并行合成按序播；单句失败/超时退回浏览器朗读，对话不中断
const player = new Audio(); let speakGen = 0, ttsOn = null;
let ttsStreamOn = false, actx = null;
const ttsReady = () => ttsOn ??= fetch('/api/tts/config').then(r => r.json()).then(c => { ttsStreamOn = !!c.stream && !!(window.AudioContext || window.webkitAudioContext); return !!c.enabled; }).catch(() => false);
// 流式播放：Web Audio 按块排队播放 24kHz PCM，边下边播
const AC = () => actx ??= new (window.AudioContext || window.webkitAudioContext)();
let srcs = [];
function openStream(t) { const c = new AbortController(), tm = setTimeout(() => c.abort(), 9000); // 首块 8 秒内没到就退回浏览器朗读
  const q = { chunks: [], done: false, ok: null, wake: null, c, next: null };
  fetch('/api/tts/stream?t=' + encodeURIComponent(t), { signal: c.signal }).then(async r => { if (!r.ok) throw 0; const rd = r.body.getReader();
    for (;;) { const { done, value } = await rd.read(); if (done) break; if (q.ok === null) { q.ok = true; clearTimeout(tm); } q.chunks.push(value); q.wake?.(); } })
    .catch(() => {}).finally(() => { clearTimeout(tm); if (q.ok === null) q.ok = false; q.done = true; q.wake?.(); q.next?.(); });
  return q; }
async function playStream(q, g) { const ctx = AC(); if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  let t = Math.max(ctx.currentTime + 0.05, 0), rest = null, any = false;
  for (;;) { if (g !== speakGen) return true;
    if (!q.chunks.length) { if (q.done) break; await new Promise(r => q.wake = r); q.wake = null; continue; }
    let b = q.chunks.shift(); if (rest) { const m = new Uint8Array(rest.length + b.length); m.set(rest); m.set(b, rest.length); b = m; rest = null; }
    if (b.length % 2) { rest = b.slice(-1); b = b.slice(0, -1); } if (!b.length) continue;
    const n = b.length / 2, dv = new DataView(b.buffer, b.byteOffset, b.length), buf = ctx.createBuffer(1, n, 24000), ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = dv.getInt16(i * 2, true) / 32768;
    const s = ctx.createBufferSource(); s.buffer = buf; s.connect(ctx.destination); t = Math.max(t, ctx.currentTime); s.start(t); t += buf.duration; srcs.push(s); any = true; }
  if (!any) return false;
  await new Promise(r => setTimeout(r, Math.max(0, (t - ctx.currentTime) * 1000))); return true; }
function unlockAudio() { // 手机浏览器：首次用户点击时解锁自动播放
  try { player.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='; player.play().catch(() => {});
    if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(''); u.volume = 0; speechSynthesis.speak(u); } } catch {} ttsReady(); prefetchAcks(); try { AC().resume(); } catch {} }
function browserSay(text) { return new Promise(res => { if (!('speechSynthesis' in window)) return res();
  const u = new SpeechSynthesisUtterance(text); u.lang = 'zh-CN'; u.rate = 1.0;
  const zh = speechSynthesis.getVoices().find(v => /zh|Chinese/i.test(v.lang)); if (zh) u.voice = zh;
  u.onend = u.onerror = res; speechSynthesis.speak(u); setTimeout(res, 15000); }); }
const fetchTTS = t => { const c = new AbortController(), tm = setTimeout(() => c.abort(), 9000); // 服务端单句 8 秒超时，这里多留 1 秒网络
  return fetch('/api/tts?t=' + encodeURIComponent(t), { signal: c.signal }).then(r => r.ok ? r.blob() : null).catch(() => null).finally(() => clearTimeout(tm)); };
const playBlob = b => new Promise(res => { const u = URL.createObjectURL(b); player.onended = player.onerror = () => { URL.revokeObjectURL(u); res(true); }; player.src = u; player.play().catch(() => { URL.revokeObjectURL(u); res(false); }); });
// 老人一说完立刻播一句缓存好的短回应（不等后端），正式回复接在它后面
const ackPlayer = new Audio(), ackBlobs = {}; let ackDone = Promise.resolve(), lastAck = null;
function prefetchAcks() { ttsReady().then(on => on && ACKS.forEach(a => ackBlobs[a] ??= fetchTTS(a))); }
function playAck() { const a = lastAck = pickAck(lastAck); const t0 = performance.now();
  ackDone = (async () => { const b = await Promise.race([ackBlobs[a] || fetchTTS(a), new Promise(r => setTimeout(() => r(null), 600))]);
    window.__ackMs = performance.now() - t0;
    if (b) await new Promise(res => { const u = URL.createObjectURL(b); ackPlayer.onended = ackPlayer.onerror = res; ackPlayer.src = u; ackPlayer.play().catch(res); }); else await browserSay(a); })();
  return ackDone; }
function setSpeaking(on) { document.body.classList.toggle('speaking', on); const el = document.getElementById('speakInd'); if (el) el.classList.toggle('hidden', !on);
  const live = document.getElementById('live'); if (live && !on && live.dataset.after) live.textContent = live.dataset.after; }
function stopSpeak() { speakGen++; player.pause(); srcs.forEach(x => { try { x.stop(); } catch {} }); srcs = []; try { speechSynthesis.cancel(); } catch {} setSpeaking(false); }
async function speak(text) { text = P.speakable(text || ''); stopSpeak(); const g = speakGen; const parts = firstShort(splitSentences(text)); if (!parts.length) return;
  setSpeaking(true); const on = await ttsReady();
  if (on && ttsStreamOn) { // 第一句立刻开流；后面的句子在前一句下载完后依次开流（低并发，避免 429）
    const qs = []; const open = i => { if (i >= parts.length || g !== speakGen) return; const q = qs[i] = openStream(parts[i]); q.next = () => open(i + 1); if (q.done) open(i + 1); };
    const ready = i => qs[i] ? Promise.resolve() : new Promise(r => { const iv = setInterval(() => { if (qs[i] || g !== speakGen) { clearInterval(iv); r(); } }, 30); });
    open(0); await ackDone;
    for (let i = 0; i < parts.length && g === speakGen; i++) { await ready(i); if (g !== speakGen) break; if (!(await playStream(qs[i], g)) && g === speakGen) await browserSay(parts[i]); }
    qs.forEach(q => { if (q && !q.done) q.c.abort(); }); if (g === speakGen) setSpeaking(false); return; }
  const jobs = on ? parts.map(fetchTTS) : parts.map(() => Promise.resolve(null));
  await ackDone; // 短回应还在播就等它说完再接上
  for (let i = 0; i < parts.length && g === speakGen; i++) { const b = await jobs[i]; if (g !== speakGen) break;
    if (!(b && await playBlob(b))) await browserSay(parts[i]); }
  if (g === speakGen) setSpeaking(false); }
const routes = { '': home, family, profile, stage: stagePick, interview, story, library, archive, map: lifeMap };
const route = async () => { const [p, id] = location.hash.slice(2).split('/'); await load(); (routes[p || ''] || home)(id); };
window.addEventListener('hashchange', route);
const go = h => location.hash = h;
const back = (h = '#/family', t = '← 返回') => `<button class="link" onclick="location.hash='${h}'">${t}</button>`;

// 老人端首屏：只有「开始聊天」；角落低调入口进入与家人同视角的完整内容（不剥夺老人操作权限）
function home() {
  const p = getProfile(); if (!p) return family();
  $app.innerHTML = `<main class="page home elder"><a class="corner" id="more" href="#/family">📖 看看我的故事</a>
  <p class="hello big2">${esc(callNameOf(p))}，<br>今天想聊聊吗？</p>
  <button class="huge" id="start">🎙<br>开始聊天</button><p class="slogan">爱比遗忘更强大</p></main>`;
  document.getElementById('start').onclick = () => { unlockAudio(); setReq(null); go('#/interview'); };
}
function family() {
  const p = getProfile(), n = cache?.interviews?.filter(i => i.finished).length || 0;
  const cov = p ? FW.nodes.filter(x => P.st(cache?.states || {}, x.id).status !== 'not_started').length : 0;
  $app.innerHTML = `<main class="page home"><p class="poem">趁我还记得，<br>请听我慢慢说。</p><h1 class="logo">记忆银行</h1><p class="sub">陪伴阿尔茨海默病患者</p>
  <div class="illus">📻 📖 🧸</div>
  ${p ? `<p class="hello">${esc(callNameOf(p))}，今天想聊聊吗？${n ? `<br><small>已经聊过 ${n} 次啦</small>` : ''}</p><button class="big" id="start">🎙 开始今天的聊天</button>` : `<button class="big" id="start">开始建档</button>`}
  ${p && cache?.stories?.[0] ? `<a class="card" href="#/story/${cache.stories[0].id}"><b>最近的故事：${esc(cache.stories[0].title)}</b><span>${new Date(cache.stories[0].created).toLocaleDateString('zh-CN')}</span></a>` : ''}
  <div class="row"><button class="ghost" onclick="location.hash='#/library'">📚 记忆库</button>${p ? `<button class="ghost" onclick="location.hash='#/archive'">🗂 记忆档案</button>` : ''}</div>
  ${p ? `<button class="ghost wide" onclick="location.hash='#/map'">🗺 人生地图 · 已聊 ${cov}/${FW.nodes.length} 个话题</button>` : ''}
  ${p && elderId ? `<a class="ghost wide btn" id="zip" href="/api/elders/${elderId}/export.zip" download>📦 一键打包下载（原声+访谈稿+故事+档案）</a>` : ''}
  ${p ? back('#/profile', '修改档案') : ''}${p ? back('#/', '← 回到老人首页') : ''}<p class="badge">${aiMode}</p></main>`;
  document.getElementById('start').onclick = () => go(p ? '#/stage' : '#/profile');
}
function profile() {
  const p = getProfile() || {};
  $app.innerHTML = `<main class="page"><h2>老人档案</h2><p class="tip">由家人填写，帮 AI 更亲切地提问</p>
  <form id="f"><label>姓名<input name="name" required value="${esc(p.name)}" placeholder="如：王秀兰"></label>
  <label>性别<select name="gender"><option value="">请选择</option><option value="女"${p.gender === '女' ? ' selected' : ''}>女</option><option value="男"${p.gender === '男' ? ' selected' : ''}>男</option></select></label>
  <label>希望怎么称呼<input name="callName" value="${esc(p.callName)}" placeholder="按姓氏和性别自动生成，如：王女士"><small class="tip">默认“姓＋先生/女士”，可以手动改</small></label>
  <input type="hidden" name="callNameManual" value="${p.callNameManual ? '1' : ''}">
  <label>出生年份<input name="birthYear" inputmode="numeric" value="${esc(p.birthYear)}" placeholder="如：1948"></label>
  <label>家乡<input name="hometown" value="${esc(p.hometown)}" placeholder="如：江苏扬州"></label>
  <label>重要的人（可选）<input name="people" value="${esc(p.people)}" placeholder="如：老伴李建国、女儿小梅"></label>
  <button class="big" type="submit">保存，下一步</button></form>
  <button class="ghost" id="demo">✨ 填入演示档案（王女士）</button>${back()}</main>`;
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
const TRIG_ICON = { photo: '🖼', song: '🎵', food: '🥮', object: '⌚', festival: '🏮' };
async function stagePick() {
  const p = getProfile(); if (!p) return go('#/profile');
  const req = getReq(); let d = null;
  try { d = await api(`/elders/${elderId}/plan${req ? '?' + new URLSearchParams(Object.entries(req).filter(([, v]) => v)) : ''}`); } catch {}
  const plan = d?.plan || P.offlineQuestions(FW, p, req).plan, v = d?.vars || P.planVars(FW, plan, { profile: p });
  const T = id => P.nodeTitle(FW, id, p);
  $app.innerHTML = `<main class="page plan"><h2>今天聊什么？</h2><p class="tip">小忆按话题网替${esc(callNameOf(p))}挑好了，家人也可以指定</p>
  <div class="plancard"><p class="lbl">今天话题</p><p class="topic">${esc(v.今天话题)}</p>
  ${plan.nodes.map((x, k) => `<p class="why">${k ? '然后' : '先聊'}「${esc(T(x.nodeId))}」<small>${esc(x.note || '')}</small></p>`).join('')}
  <p class="lbl">小忆会先问</p><p class="q">“${esc(v.当前话题入场问题)}”</p>
  ${v.顺藤线索 ? `<p class="lbl">顺藤线索</p><p class="why">${esc(v.顺藤线索)}</p>` : ''}
  ${v.下次话题 ? `<p class="lbl">下次预告</p><p class="why">${esc(v.下次话题)}</p>` : ''}</div>
  <button class="big" id="go">🎙 就聊这个</button>
  <h3>家人指定</h3><p class="tip">带了老照片、老歌、家乡菜？点一下，小忆用它开场</p>
  <div class="trigs">${Object.entries(FW.dimensions.trigger.values).map(([k, l]) => `<button class="${req?.trigger === k ? 'big' : 'ghost'} trig" data-t="${k}">${TRIG_ICON[k]} ${l}</button>`).join('')}</div>
  <button class="ghost wide" onclick="location.hash='#/map'">🗺 从人生地图里挑一个话题</button>
  ${req ? `<p class="hint">已指定：${esc(req.nodeId ? T(req.nodeId) : FW.dimensions.trigger.values[req.trigger])} <button class="link" id="clr">清除，改回自动</button></p>` : ''}
  ${cache?.archive?.lastTopic ? `<p class="hint">💭 上次聊到：${esc(cache.archive.lastTopic)}</p>` : ''}${back()}</main>`;
  document.getElementById('go').onclick = () => go('#/interview');
  $app.querySelectorAll('.trig').forEach(b => b.onclick = () => { setReq(req?.trigger === b.dataset.t ? null : { trigger: b.dataset.t }); stagePick(); });
  const c = document.getElementById('clr'); if (c) c.onclick = () => { setReq(null); stagePick(); };
}
// 人生地图：各维度哪些聊过、哪些空着；点节点即指定为下次话题
function lifeMap() {
  const p = getProfile() || {}, states = cache?.states || {}, cov = P.coverage(FW, states);
  const dot = s => [1, 2, 3, 4].map(k => `<i class="${s.depth >= k ? 'on' : ''}"></i>`).join('');
  const chip = n => { const s = P.st(states, n.id); return `<button class="node ${s.status}${s.sensitive ? ' sens' : ''}" data-n="${n.id}"><b>${esc(P.nodeTitle(FW, n.id, p))}</b><span class="d">${dot(s)}</span>${s.sensitive ? '<small>先放一放</small>' : ''}</button>`; };
  $app.innerHTML = `<main class="page map"><h2>🗺 ${esc(callNameOf(p))}的人生地图</h2>
  <p class="tip">深色是聊完的，浅色是聊过一些，空白的还没聊。点一个话题，下次就聊它</p>
  <div class="legend"><span class="node done">聊完</span><span class="node partial">聊过一些</span><span class="node not_started">还没聊</span></div>
  ${Object.entries(FW.dimensions.time.values).map(([t, l]) => `<section class="era"><h3>${l}</h3><div class="nodes">${FW.nodes.filter(n => n.tags.time === t).map(chip).join('')}</div></section>`).join('')}
  ${['relation', 'domain', 'trigger'].map(dim => `<section class="cov"><h3>${FW.dimensions[dim].label}</h3>${cov[dim].map(x => `<div class="bar"><span>${x.label}</span><div class="track"><div class="fill" style="width:${x.total ? 100 * x.chatted / x.total : 0}%"></div></div><small>${x.chatted}/${x.total}</small></div>`).join('')}</section>`).join('')}
  ${back()}</main>`;
  $app.querySelectorAll('.node[data-n]').forEach(b => b.onclick = () => { setReq({ nodeId: b.dataset.n }); go('#/stage'); });
}
async function interview() {
  const p = getProfile(); if (!p) return go('#/profile');
  $app.innerHTML = `<main class="page center"><div class="thinking"><div class="dots"><i></i><i></i><i></i></div><p>小忆来啦，正在翻看上次的记录……</p></div></main>`;
  try { if (!elderId) throw 0; const o = await post('/interviews', { elderId, request: getReq() }); setReq(null);
    startFull();
    session = { online: true, id: o.id, p, say: o.say, n: 0, isReturn: o.isReturn, log: [], topic: o.topic, ask: o.ask, closing: o.closing, phase: o.phase || 'chat', cards: o.cards, after: false };
  } catch { const req = getReq(); setReq(null); const cards = P.candidates(FW, { profile: p, request: req }); // 无网兜底：本地出候选、本地解析选择
    session = { online: false, p, n: 0, answers: [], log: [], phase: 'choose', cards, shown: cards.map(c => c.nodeId), after: false,
      say: P.greetText(FW, P.offlineQuestions(FW, p, req).plan, { profile: p }, false) + P.choiceText(cards) }; }
  renderTurn();
}
function renderTurn() {
  const s = session, text = s.say, n = s.n, choosing = s.phase === 'choose';
  $app.innerHTML = choosing ? `<main class="page interview choose"><p class="stage">${s.after ? '这个话题聊得真好 · 接下来聊什么' : '今天想聊哪个？'}${s.isReturn && !s.after ? ' · <b>接着上次聊</b>' : ''}</p>
  <div class="bubble"><span class="who">小忆</span>${esc(text)}</div>
  <p class="speaking-ind hidden" id="speakInd">🔊 小忆在说话…</p><button class="link" id="replay">🔊 再听一遍</button>
  <div class="cards">${(s.cards || []).map((c, i) => `<button class="tcard" data-i="${i}"><b>${['一', '二', '三'][i]}</b><span>${esc(c.text)}</span></button>`).join('')}</div>
  <div class="row choose-more"><button class="ghost" data-a="more">🔄 换几个</button><button class="ghost" data-a="free">💬 您想聊什么都行</button></div>
  ${s.after ? `<div class="row choose-more"><button class="ghost" data-a="stay">↩️ 继续聊这个</button><button class="ghost" data-a="end">🌙 今天先到这</button></div>` : ''}
  <button class="mic small" id="mic"><span class="ico">🎙</span><span id="micl">或者直接说：“就聊第二个”</span></button>
  <p class="live" id="live" data-after="点卡片，或者说出来都行">小忆说完，您点卡片或直接说</p>
  <div class="thinking hidden" id="thinking"><div class="dots"><i></i><i></i><i></i></div><p id="thinkt">小忆在听您想聊哪个……</p></div>
  <button class="link" id="demoA">（演示：说“就聊第一个吧”）</button>
  <textarea id="manual" placeholder="（家人可在此打字代说）" class="hidden"></textarea></main>`
  : `<main class="page interview"><p class="stage">${s.online ? `第 ${n + 1} 轮 · ${esc(P.nodeTitle(FW, s.ask?.nodeId, s.p))} · ${P.LAYER_LABEL[s.ask?.depth] || ''}` : `离线演示 · 第 ${n + 1} 题`}${s.isReturn && n === 0 ? ' · <b>接着上次聊</b>' : ''}</p>
  ${s.log.slice(-1).map(l => `<p class="said">您刚才说：“${esc(l)}”</p>`).join('')}
  <div class="bubble"><span class="who">小忆</span>${esc(text)}</div>
  <p class="speaking-ind hidden" id="speakInd">🔊 小忆在说话…</p><button class="link" id="replay">🔊 再听一遍</button>
  <button class="mic" id="mic"><span class="ico">🎙</span><span id="micl">点一下，开始说</span></button>
  <p class="live" id="live" data-after="该您说了，点一下话筒">慢慢说，不着急，说错了也没关系</p>
  <div class="thinking hidden" id="thinking"><div class="dots"><i></i><i></i><i></i></div><p id="thinkt">小忆在认真听……</p><small>不着急，您喝口水歇一歇</small></div>
  <button class="link" id="demoA">（演示：填入示范回答）</button>
  <textarea id="manual" placeholder="（家人可在此补记文字）" class="hidden"></textarea>
  <div class="row"><button class="ghost" id="end">今天先聊到这</button></div></main>`;
  const live = document.getElementById('live'), manual = document.getElementById('manual'), micl = document.getElementById('micl'), mic = document.getElementById('mic');
  let rec = null, sr = null, chunks = [], btext = '', recording = false, busy = false;
  document.getElementById('replay').onclick = () => speak(text);
  document.getElementById('demoA').onclick = () => { manual.classList.remove('hidden'); manual.value = choosing ? '就聊第一个吧' : (s.isReturn ? DEMO_ANSWERS_2 : DEMO_ANSWERS)[n] || ''; };
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
      recording = false; busy = true; if (!choosing && s.online) playAck(); // 选题阶段不播短回应 mic.classList.remove('rec'); mic.classList.add('busy'); micl.textContent = '小忆在听…'; sr?.stop();
      const th = document.getElementById('thinking'), tt = document.getElementById('thinkt'); th.classList.remove('hidden'); mic.classList.add('hidden'); live.classList.add('hidden');
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
  $app.innerHTML = `<main class="page center"><div class="thinking" id="storyThinking"><div class="dots"><i></i><i></i><i></i></div><p>小忆在把您的故事写下来……</p><small>就几秒钟，您歇一歇</small></div></main>`;
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
  $app.innerHTML = `<main class="page story"><p class="stage">${new Date(s.created).toLocaleDateString('zh-CN')} · ${esc(s.elder.name)} 讲述 ${s.stage ? '· ' + esc(s.stage) : ''}</p>
  <h1 class="title">${esc(s.title)}</h1><article>${paras.map((x, k) => `<div class="para"><p>${esc(x.text)}</p>${x.refs.length ? `<button class="play" data-k="${k}" aria-label="听原声">▶ 原声</button>` : ''}</div>`).join('')}</article>
  ${s.quotes ? `<blockquote>${esc(s.quotes)}</blockquote>` : ''}${s.people ? `<p class="tip">关键人物：${esc(s.people)}</p>` : ''}${s.timePlace ? `<p class="tip">时间地点：${esc(s.timePlace)}</p>` : ''}
  ${s.fullAudio ? `<h3>🎧 整场录音</h3><audio controls preload="none" src="${au(s.fullAudio)}"></audio>` : ''}
  <details class="transcript" id="tx"><summary>📜 查看完整访谈稿（${(s.transcript || s.clips || []).length} 轮，原话不改动）</summary>
  ${(s.transcript?.length ? s.transcript : (s.clips || []).map((c, k) => ({ id: c.id || 'c' + k, question: c.q, raw: c.text, clean: c.text, audio: c.audio || c.src }))).map(t => `<div class="turn" id="${esc(t.id)}"><p class="cq">小忆：${esc(t.question)}</p>
    <p class="ca">“${esc(t.clean || '')}”</p>${t.raw && t.raw !== t.clean ? `<p class="raw">原始转写：${esc(t.raw)}</p>` : ''}
    ${t.audio ? `<audio controls preload="none" src="${au(t.audio)}"></audio>` : ''}
    <p class="meta">${esc(t.id)}${t.nodeId ? ` · ${esc(P.nodeTitle(FW, t.nodeId, s.elder))} · 第${t.depth}层 · ${esc(t.emotion || '')}` : ''}</p></div>`).join('')}</details>
  ${id.startsWith('local') ? '' : `<button class="ghost wide" id="edit">✏️ 修改故事（原话保留，修改留痕）</button>`}
  ${s.edits?.length ? `<details class="edits"><summary>修改记录（${s.edits.length}）</summary>${s.edits.map(x => `<p class="meta">${new Date(x.at).toLocaleString('zh-CN')} · ${esc(x.by)} 改了${x.field === 'title' ? '标题' : '正文'}<br>原来：${esc(x.before.slice(0, 40))}…</p>`).join('')}</details>` : ''}
  <button class="big" id="share">💌 分享给家人</button><button class="ghost" onclick="location.hash='#/library'">📚 回到记忆库</button></main>`;
  const player = new Audio();
  $app.querySelectorAll('.play').forEach(b => b.onclick = () => { const refs = paras[b.dataset.k].refs.map(clipOf).filter(Boolean), c = refs[0]; if (!c) return;
    const a = au(c.audio || c.src); document.getElementById('tx').open = true; document.getElementById(c.id)?.classList.add('hl');
    if (a) { player.src = a; player.play().catch(() => speak(c.clean || c.text)); } else speak(c.clean || c.text); });
  const ed = document.getElementById('edit'); if (ed) ed.onclick = () => { const art = $app.querySelector('article');
    art.outerHTML = `<form id="ef" class="edit"><input name="title" value="${esc(s.title)}"><textarea name="body" rows="14">${esc(s.body)}</textarea><button class="big">保存修改</button></form>`; ed.remove();
    document.getElementById('ef').onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
      await fetch('/api/stories/' + id, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...f, by: '家人' }) }); story(id); }; };
  document.getElementById('share').onclick = () => navigator.share ? navigator.share({ title: s.title, text: s.body, url: location.href }).catch(() => {}) : (navigator.clipboard?.writeText(s.title + '\n\n' + s.body), alert('故事文字已复制，可以发给家人'));
}
async function library() {
  const list = [...(cache?.stories || []), ...(await listStories()).map(l => ({ ...l, created: l.createdAt, local: true }))];
  $app.innerHTML = `<main class="page"><h2>📚 记忆库</h2><p class="tip">每一段，都是留给孩子们的宝藏</p>
  ${list.length ? list.map(s => `<a class="card" href="#/story/${s.id}"><b>${esc(s.title)}</b><span>${new Date(s.created).toLocaleDateString('zh-CN')} · ${esc(s.stage || '')} · ${(s.clips || s.answers || []).length} 段原声${s.local ? ' · 本机' : ''}</span></a>`).join('') : '<p class="empty">还没有故事。<br>去和老人聊一聊吧。</p>'}
  <button class="big" onclick="location.hash='#/stage'">🎙 再聊一次</button>${back('#/family', '← 首页')}</main>`;
}
function archive() {
  const a = cache?.archive || {}, p = getProfile() || {}, ivs = (cache?.interviews || []).filter(i => i.finished);
  const sec = (t, arr, f) => `<h3>${t}</h3>${arr?.length ? arr.map(f).join('') : '<p class="tip">还没有记录</p>'}`;
  $app.innerHTML = `<main class="page archive"><h2>🗂 ${esc(callNameOf(p))}的记忆档案</h2><p class="tip">每次聊完自动整理，小忆下次会接着聊</p>
  ${cache?.archivePending ? `<div class="thinking small" id="archPending"><div class="dots"><i></i><i></i><i></i></div><p>小忆正在整理这次的记忆……</p><small>整理好会自动刷新</small></div>` : ''}
  ${a.lastTopic ? `<p class="hint">💭 上次聊到：${esc(a.lastTopic)}</p>` : ''}
  ${sec('🧾 实体表（人 · 地 · 物）', cache?.entities, x => `<div class="ent"><span class="ty">${{ person: '👤 人', place: '📍 地', thing: '🎁 物' }[x.type] || x.type}</span><b>${esc(x.name)}</b>${x.relation ? ` · ${esc(FW.dimensions.relation.values[x.relation] || x.relation)}` : ''}${x.deceased ? ' · 已故' : ''}<br><small>来自：${x.sourceNodes.map(id => esc(P.nodeTitle(FW, id, p))).join('、')}${x.sourceTurns?.length ? ` · 出处句子 ${x.sourceTurns.map(esc).join('、')}` : ''}</small>${x.notes?.length ? `<br><small>${esc(x.notes.slice(-2).join('；'))}</small>` : ''}</div>`)}
  ${sec('👥 人物', a.people, x => `<div class="chip"><b>${esc(x.name)}</b> · ${esc(x.relation)}<br><small>${esc(x.note)}</small></div>`)}
  ${sec('📍 地点', a.places, x => `<div class="chip"><b>${esc(x.name)}</b><br><small>${esc(x.note)}</small></div>`)}
  ${sec('✨ 事件', a.events, x => `<div class="chip"><b>${esc(x.title)}</b> <small>${esc(x.when)}</small><br><small>${esc(x.detail)}</small></div>`)}
  ${sec('🕰 时间线', a.timeline, x => `<div class="tl"><b>${esc(x.when)}</b><span>${esc(x.what)}</span></div>`)}
  ${a.conflicts?.filter(Boolean).length ? sec('🔀 前后说法（并列保留）', a.conflicts, x => `<p class="tip">${esc(x)}</p>`) : ''}
  ${sec('🎙 访谈记录', ivs, i => `<details class="chip"><summary>${new Date(i.created).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${esc(i.stage)} · ${i.turns.length} 句</summary>${i.turns.map(t => `<p class="cq">小忆：${esc(t.q)}</p>${t.audio ? `<audio controls preload="none" src="/api/audio/${t.audio}"></audio>` : ''}<p>整理：${esc(t.clean)}</p><p class="tip">原始：${esc(t.raw)}</p>`).join('')}</details>`)}
  ${back()}</main>`;
  if (cache?.archivePending) setTimeout(async () => { if (!location.hash.startsWith('#/archive')) return; await load(); archive(); }, 3000);
}
document.addEventListener('pointerdown', unlockAudio, { once: true }); // 首次点击解锁音频（「开始聊天」也会再解锁一次）
route();
