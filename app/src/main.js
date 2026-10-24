// v2：后端账户 + Gemini 访谈 Agent；后端不可达时回退到 v1 本地离线流程（固定问题 + 演示故事）
import { STAGES, SCRIPT, DEMO_PROFILE, DEMO_ANSWERS, DEMO_ANSWERS_2, questionsFor, fill } from './questions.js';
import { generateStory } from './story.js';
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

function speak(text) { return new Promise(res => { if (!('speechSynthesis' in window)) return res();
  speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'zh-CN'; u.rate = 0.85;
  const v = speechSynthesis.getVoices().find(v => v.lang.startsWith('zh')); if (v) u.voice = v;
  u.onend = u.onerror = res; speechSynthesis.speak(u); setTimeout(res, 25000); }); }
const routes = { '': home, profile, stage: stagePick, interview, story, library, archive };
const route = async () => { const [p, id] = location.hash.slice(2).split('/'); await load(); (routes[p || ''] || home)(id); };
window.addEventListener('hashchange', route);
const go = h => location.hash = h;
const back = (h = '#/', t = '← 返回') => `<button class="link" onclick="location.hash='${h}'">${t}</button>`;

function home() {
  const p = getProfile(), n = cache?.interviews?.filter(i => i.finished).length || 0;
  $app.innerHTML = `<main class="page home"><p class="poem">趁我还记得，<br>请听我慢慢说。</p><h1 class="logo">记忆银行</h1><p class="sub">陪伴阿尔茨海默病患者</p>
  <div class="illus">📻 📖 🧸</div>
  ${p ? `<p class="hello">${esc(p.callName || p.name)}，今天想聊聊吗？${n ? `<br><small>已经聊过 ${n} 次啦</small>` : ''}</p><button class="big" id="start">🎙 开始聊天</button>` : `<button class="big" id="start">开始建档</button>`}
  <div class="row"><button class="ghost" onclick="location.hash='#/library'">📚 记忆库</button>${p ? `<button class="ghost" onclick="location.hash='#/archive'">🗂 记忆档案</button>` : ''}</div>
  ${p ? back('#/profile', '修改档案') : ''}<p class="slogan">爱比遗忘更强大</p><p class="badge">${aiMode}</p></main>`;
  document.getElementById('start').onclick = () => go(p ? '#/stage' : '#/profile');
}
function profile() {
  const p = getProfile() || {};
  $app.innerHTML = `<main class="page"><h2>老人档案</h2><p class="tip">由家人填写，帮 AI 更亲切地提问</p>
  <form id="f"><label>姓名<input name="name" required value="${esc(p.name)}" placeholder="如：王秀兰"></label>
  <label>希望怎么称呼<input name="callName" value="${esc(p.callName)}" placeholder="如：王奶奶"></label>
  <label>出生年份<input name="birthYear" inputmode="numeric" value="${esc(p.birthYear)}" placeholder="如：1948"></label>
  <label>家乡<input name="hometown" value="${esc(p.hometown)}" placeholder="如：江苏扬州"></label>
  <label>重要的人（可选）<input name="people" value="${esc(p.people)}" placeholder="如：老伴李建国、女儿小梅"></label>
  <button class="big" type="submit">保存，下一步</button></form>
  <button class="ghost" id="demo">✨ 填入演示档案（王奶奶）</button>${back()}</main>`;
  document.getElementById('f').onsubmit = async e => { e.preventDefault(); await setProfile({ ...p, ...Object.fromEntries(new FormData(e.target)) }); go('#/stage'); };
  document.getElementById('demo').onclick = async () => { await setProfile(DEMO_PROFILE); go('#/stage'); };
}
function stagePick() {
  const p = getProfile(); if (!p) return go('#/profile');
  $app.innerHTML = `<main class="page"><h2>今天聊哪段日子？</h2><p class="tip">${esc(p.callName || p.name)}，选一个想聊的</p>
  ${cache?.archive?.lastTopic ? `<p class="hint">💭 上次聊到：${esc(cache.archive.lastTopic)}</p>` : ''}
  ${STAGES.map((s, k) => `<button class="${p.stage === s ? 'big' : 'ghost'} stagebtn" data-s="${s}">${['🌾', '📚', '💞', '👶'][k]} ${s}</button>`).join('')}${back()}</main>`;
  $app.querySelectorAll('.stagebtn').forEach(b => b.onclick = async () => { await setProfile({ ...p, stage: b.dataset.s }); go('#/interview'); });
}

async function interview() {
  const p = getProfile(); if (!p) return go('#/profile');
  $app.innerHTML = `<main class="page center"><div class="thinking"><div class="dots"><i></i><i></i><i></i></div><p>小忆来啦，正在翻看上次的记录……</p></div></main>`;
  try { if (!elderId) throw 0; const o = await post('/interviews', { elderId, stage: p.stage });
    session = { online: true, id: o.id, p, say: o.say, n: 0, isReturn: o.isReturn, log: [] };
  } catch { const qs = questionsFor(p); session = { online: false, p, qs, n: 0, say: qs[0].text, answers: [], log: [] }; }
  renderTurn();
}
function renderTurn() {
  const s = session, text = s.say, n = s.n;
  $app.innerHTML = `<main class="page interview"><p class="stage">${s.online ? `第 ${n + 1} 轮 · ${esc(s.p.stage)}` : `离线演示 · 第 ${n + 1} 题`}${s.isReturn && n === 0 ? ' · <b>接着上次聊</b>' : ''}</p>
  ${s.log.slice(-1).map(l => `<p class="said">您刚才说：“${esc(l)}”</p>`).join('')}
  <div class="bubble"><span class="who">小忆</span>${esc(text)}</div>
  <button class="link" id="replay">🔊 再听一遍</button>
  <button class="mic" id="mic"><span class="ico">🎙</span><span id="micl">点一下，开始说</span></button>
  <p class="live" id="live">慢慢说，不着急，说错了也没关系</p>
  <div class="thinking hidden" id="thinking"><div class="dots"><i></i><i></i><i></i></div><p id="thinkt">小忆在认真听……</p><small>不着急，您喝口水歇一歇</small></div>
  <button class="link" id="demoA">（演示：填入示范回答）</button>
  <textarea id="manual" placeholder="（家人可在此补记文字）" class="hidden"></textarea>
  <div class="row"><button class="ghost" id="end">今天先聊到这</button></div></main>`;
  const live = document.getElementById('live'), manual = document.getElementById('manual'), micl = document.getElementById('micl'), mic = document.getElementById('mic');
  let rec = null, sr = null, chunks = [], btext = '', recording = false, busy = false;
  document.getElementById('replay').onclick = () => speak(text);
  document.getElementById('demoA').onclick = () => { manual.classList.remove('hidden'); manual.value = (s.isReturn ? DEMO_ANSWERS_2 : DEMO_ANSWERS)[n] || ''; };
  setTimeout(() => speak(text), 300);
  mic.onclick = async () => {
    if (busy) return;
    if (!recording) {
      speechSynthesis?.cancel();
      try { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); rec = new MediaRecorder(st); chunks = []; rec.ondataavailable = e => chunks.push(e.data); rec.start(); }
      catch { live.textContent = '没能打开麦克风，可以手动补记'; manual.classList.remove('hidden'); }
      if (SR && !s.online) { sr = new SR(); sr.lang = 'zh-CN'; sr.continuous = true; sr.interimResults = true; // 仅离线兜底用浏览器识别
        sr.onresult = ev => { btext = [...ev.results].map(r => r[0].transcript).join(''); live.textContent = btext; }; try { sr.start(); } catch {} }
      recording = true; mic.classList.add('rec'); micl.textContent = '说完了，点一下'; live.textContent = '我在听…';
    } else {
      recording = false; busy = true; mic.classList.remove('rec'); mic.classList.add('busy'); micl.textContent = '小忆在听…'; sr?.stop();
      const th = document.getElementById('thinking'), tt = document.getElementById('thinkt'); th.classList.remove('hidden'); mic.classList.add('hidden'); live.classList.add('hidden');
      const tmr = setTimeout(() => tt.textContent = '小忆在想下一个问题……', 2500);
      const blob = await new Promise(res => { if (!rec || rec.state === 'inactive') return res(null);
        rec.onstop = () => res(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })); rec.stop(); rec.stream.getTracks().forEach(t => t.stop()); });
      await answer(blob, manual.value.trim(), btext); clearTimeout(tmr);
    }
  };
  document.getElementById('end').onclick = finish;
}
async function answer(blob, manualText, btext) {
  const s = session;
  if (s.online) {
    const fd = new FormData(); if (blob) fd.append('audio', blob, 'a.webm'); fd.append('question', s.say); if (manualText) fd.append('manual', manualText); if (btext) fd.append('browserText', btext);
    try { const r = await post(`/interviews/${s.id}/turn`, fd); s.log.push(r.transcript.clean || '……'); s.n++;
      if (r.next.done) { await speak(r.next.say); return finish(); } s.say = r.next.say; return renderTurn();
    } catch { s.online = false; s.qs = questionsFor(s.p); s.answers = []; }
  }
  const q = s.qs[s.answers.length] || s.qs.at(-1); s.answers.push({ question: q.text, stage: q.stage, text: manualText || btext, audio: blob });
  s.log.push(manualText || btext || '……'); s.n++;
  if (s.answers.length >= s.qs.length) return finish();
  await speak(fill(SCRIPT.acks[s.n % 3], s.p)); s.say = s.qs[s.answers.length].text; renderTurn();
}
async function finish() {
  speechSynthesis?.cancel(); speak(fill(SCRIPT.closing, session.p));
  $app.innerHTML = `<main class="page center"><div class="thinking" id="storyThinking"><div class="dots"><i></i><i></i><i></i></div><p>小忆在把您的故事写下来……</p><small>就几秒钟，您歇一歇</small></div></main>`;
  if (session.online) { try { const r = await post(`/interviews/${session.id}/finish`, {}); return go('#/story/' + r.storyId); } catch {} }
  const st = await generateStory(session.answers || [], session.p), id = 'local' + Date.now();
  await saveStory({ id, createdAt: Date.now(), ...st, profile: session.p, answers: session.answers || [] }); go('#/story/' + id);
}
async function story(id) {
  let s; if (id.startsWith('local')) { const l = await getStory(id); s = l && { ...l, created: l.createdAt, elder: l.profile, clips: l.answers.map(a => ({ q: a.question, text: a.text, src: a.audio && URL.createObjectURL(a.audio) })) }; }
  else s = await api('/stories/' + id).catch(() => null);
  if (!s) return go('#/library');
  $app.innerHTML = `<main class="page story"><p class="stage">${new Date(s.created).toLocaleDateString('zh-CN')} · ${esc(s.elder.name)} 讲述 ${s.stage ? '· ' + esc(s.stage) : ''}</p>
  <h1 class="title">${esc(s.title)}</h1><article>${esc(s.body).split(/\n+/).map(x => `<p>${x}</p>`).join('')}</article>
  ${s.quotes ? `<blockquote>${esc(s.quotes)}</blockquote>` : ''}${s.people ? `<p class="tip">关键人物：${esc(s.people)}</p>` : ''}${s.timePlace ? `<p class="tip">时间地点：${esc(s.timePlace)}</p>` : ''}
  <h3>🎧 原声</h3>${(s.clips || []).map(c => `<div class="clip"><p class="cq">小忆：${esc(c.q)}</p>${c.audio || c.src ? `<audio controls preload="none" src="${c.src || '/api/audio/' + c.audio}"></audio>` : '<p class="tip">（无录音）</p>'}${c.text ? `<p class="ca">“${esc(c.text)}”</p>` : ''}</div>`).join('')}
  <button class="big" id="share">💌 分享给家人</button><button class="ghost" onclick="location.hash='#/library'">📚 回到记忆库</button></main>`;
  document.getElementById('share').onclick = () => navigator.share ? navigator.share({ title: s.title, text: s.body, url: location.href }).catch(() => {}) : (navigator.clipboard?.writeText(s.title + '\n\n' + s.body), alert('故事文字已复制，可以发给家人'));
}
async function library() {
  const list = [...(cache?.stories || []), ...(await listStories()).map(l => ({ ...l, created: l.createdAt, local: true }))];
  $app.innerHTML = `<main class="page"><h2>📚 记忆库</h2><p class="tip">每一段，都是留给孩子们的宝藏</p>
  ${list.length ? list.map(s => `<a class="card" href="#/story/${s.id}"><b>${esc(s.title)}</b><span>${new Date(s.created).toLocaleDateString('zh-CN')} · ${esc(s.stage || '')} · ${(s.clips || s.answers || []).length} 段原声${s.local ? ' · 本机' : ''}</span></a>`).join('') : '<p class="empty">还没有故事。<br>去和老人聊一聊吧。</p>'}
  <button class="big" onclick="location.hash='#/stage'">🎙 再聊一次</button>${back('#/', '← 首页')}</main>`;
}
function archive() {
  const a = cache?.archive || {}, p = getProfile() || {}, ivs = (cache?.interviews || []).filter(i => i.finished);
  const sec = (t, arr, f) => `<h3>${t}</h3>${arr?.length ? arr.map(f).join('') : '<p class="tip">还没有记录</p>'}`;
  $app.innerHTML = `<main class="page archive"><h2>🗂 ${esc(p.callName || p.name || '')}的记忆档案</h2><p class="tip">每次聊完自动整理，小忆下次会接着聊</p>
  ${cache?.archivePending ? `<div class="thinking small" id="archPending"><div class="dots"><i></i><i></i><i></i></div><p>小忆正在整理这次的记忆……</p><small>整理好会自动刷新</small></div>` : ''}
  ${a.lastTopic ? `<p class="hint">💭 上次聊到：${esc(a.lastTopic)}</p>` : ''}
  ${sec('👥 人物', a.people, x => `<div class="chip"><b>${esc(x.name)}</b> · ${esc(x.relation)}<br><small>${esc(x.note)}</small></div>`)}
  ${sec('📍 地点', a.places, x => `<div class="chip"><b>${esc(x.name)}</b><br><small>${esc(x.note)}</small></div>`)}
  ${sec('✨ 事件', a.events, x => `<div class="chip"><b>${esc(x.title)}</b> <small>${esc(x.when)}</small><br><small>${esc(x.detail)}</small></div>`)}
  ${sec('🕰 时间线', a.timeline, x => `<div class="tl"><b>${esc(x.when)}</b><span>${esc(x.what)}</span></div>`)}
  ${a.conflicts?.filter(Boolean).length ? sec('🔀 前后说法（并列保留）', a.conflicts, x => `<p class="tip">${esc(x)}</p>`) : ''}
  ${sec('🎙 访谈记录', ivs, i => `<details class="chip"><summary>${new Date(i.created).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${esc(i.stage)} · ${i.turns.length} 句</summary>${i.turns.map(t => `<p class="cq">小忆：${esc(t.q)}</p>${t.audio ? `<audio controls preload="none" src="/api/audio/${t.audio}"></audio>` : ''}<p>整理：${esc(t.clean)}</p><p class="tip">原始：${esc(t.raw)}</p>`).join('')}</details>`)}
  ${back()}</main>`;
  if (cache?.archivePending) setTimeout(async () => { if (!location.hash.startsWith('#/archive')) return; await load(); archive(); }, 3000);
}
route();
