import { STAGES, SCRIPT, DEMO_PROFILE, DEMO_ANSWERS, questionsFor, fill } from './questions.js';
import { generateStory } from './story.js';
import { saveStory, listStories, getStory, getProfile, setProfile } from './db.js';
const $app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let session = null;

function speak(text) {
  return new Promise(res => { if (!('speechSynthesis' in window)) return res();
    speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'zh-CN'; u.rate = 1.0;
    const v = speechSynthesis.getVoices().find(v => v.lang.startsWith('zh')); if (v) u.voice = v;
    u.onend = u.onerror = res; speechSynthesis.speak(u); setTimeout(res, 20000); });
}
const route = () => { const [p, id] = location.hash.slice(2).split('/'); ({ '': home, profile, stage: stagePick, interview, story: () => story(id), library }[p || ''] || home)(); };
window.addEventListener('hashchange', route);
const go = h => location.hash = h;

function home() {
  const p = getProfile();
  $app.innerHTML = `<main class="page home"><p class="poem">趁我还记得，<br>请听我慢慢说。</p><h1 class="logo">记忆银行</h1><p class="sub">陪伴阿尔茨海默病患者</p>
  <div class="illus">📻 📖 🧸</div>
  ${p ? `<p class="hello">${esc(p.name)}，今天想聊聊吗？</p><button class="big" id="start">🎙 开始聊天</button>` : `<button class="big" id="start">开始建档</button>`}
  <button class="ghost" onclick="location.hash='#/library'">📚 记忆库</button>
  ${p ? `<button class="link" onclick="location.hash='#/profile'">修改档案</button>` : ''}
  <p class="slogan">爱比遗忘更强大</p></main>`;
  document.getElementById('start').onclick = () => go(p ? '#/stage' : '#/profile');
}
function profile() {
  const p = getProfile() || {};
  $app.innerHTML = `<main class="page"><h2>老人档案</h2><p class="tip">由家人填写，帮 AI 更亲切地提问</p>
  <form id="f"><label>姓名<input name="name" required value="${esc(p.name)}" placeholder="如：王秀兰"></label>
  <label>希望怎么称呼<input name="callName" value="${esc(p.callName)}" placeholder="如：王女士"></label>
  <label>出生年份<input name="birthYear" inputmode="numeric" value="${esc(p.birthYear)}" placeholder="如：1945"></label>
  <label>家乡<input name="hometown" value="${esc(p.hometown)}" placeholder="如：浙江绍兴"></label>
  <label>重要的人（可选）<input name="people" value="${esc(p.people)}" placeholder="如：老伴李建国、女儿小梅"></label>
  <button class="big" type="submit">保存，下一步</button></form>
  <button class="ghost" id="demo">✨ 填入演示档案（王女士）</button>
  <button class="link" onclick="location.hash='#/'">← 返回</button></main>`;
  document.getElementById('f').onsubmit = e => { e.preventDefault(); setProfile({ ...getProfile(), ...Object.fromEntries(new FormData(e.target)) }); go('#/stage'); };
  document.getElementById('demo').onclick = () => { setProfile(DEMO_PROFILE); go('#/stage'); };
}
function interview() {
  const p = getProfile(); if (!p) return go('#/profile');
  session = { i: 0, answers: [], profile: p, qs: questionsFor(p) }; renderQ();
}
function renderQ() {
  const { i, qs } = session, q = qs[i], text = q.text;
  $app.innerHTML = `<main class="page interview"><div class="progress">${qs.map((_, k) => `<span class="${k <= i ? 'on' : ''}"></span>`).join('')}</div>
  <p class="stage">第 ${i + 1} 个话题 · ${q.stage}</p><div class="bubble" id="q">${esc(text)}</div>
  <button class="link" id="replay">🔊 再听一遍</button>
  <button class="mic" id="mic"><span class="ico">🎙</span><span id="micl">点一下，开始说</span></button>
  <p class="live" id="live">慢慢说，不着急，说错了也没关系</p>
  <button class="link" id="demoA">（演示：填入示范回答）</button>
  <textarea id="manual" placeholder="（家人可在此补记文字）" class="${SR ? 'hidden' : ''}"></textarea>
  <div class="row"><button class="ghost" id="skip">跳过这个</button><button class="ghost" id="end">今天先聊到这</button></div></main>`;
  const live = document.getElementById('live'), manual = document.getElementById('manual'), micl = document.getElementById('micl'), mic = document.getElementById('mic');
  if (!SR) live.textContent = '此浏览器不支持语音转文字，录音照常保存，可手动补记';
  let rec = null, sr = null, chunks = [], transcript = '', recording = false;
  document.getElementById('demoA').onclick = () => { manual.classList.remove('hidden'); manual.value = DEMO_ANSWERS[i] || ''; };
  document.getElementById('replay').onclick = () => speak(text);
  setTimeout(() => speak(text), 300);
  mic.onclick = async () => {
    if (!recording) {
      speechSynthesis?.cancel();
      try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        rec = new MediaRecorder(stream); chunks = []; rec.ondataavailable = e => chunks.push(e.data); rec.start();
      } catch (e) { live.textContent = '没能打开麦克风，可以手动补记'; manual.classList.remove('hidden'); }
      if (SR) { sr = new SR(); sr.lang = 'zh-CN'; sr.continuous = true; sr.interimResults = true;
        sr.onresult = ev => { let f = '', t = ''; for (const r of ev.results) (r.isFinal ? (f += r[0].transcript) : (t += r[0].transcript)); transcript = f; live.textContent = f + t || '我在听…'; };
        sr.onerror = () => manual.classList.remove('hidden'); try { sr.start(); } catch {} }
      recording = true; mic.classList.add('rec'); micl.textContent = '说完了，点一下'; live.textContent = '我在听…';
    } else {
      recording = false; mic.classList.remove('rec'); micl.textContent = '保存中…'; sr?.stop();
      const blob = await new Promise(res => { if (!rec || rec.state === 'inactive') return res(null);
        rec.onstop = () => res(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })); rec.stop(); rec.stream.getTracks().forEach(t => t.stop()); });
      setTimeout(() => next({ question: text, stage: q.stage, text: (transcript || manual.value).trim(), audio: blob }), 400);
    }
  };
  document.getElementById('skip').onclick = () => next(manual.value.trim() ? { question: text, stage: q.stage, text: manual.value.trim(), audio: null } : null);
  document.getElementById('end').onclick = finish;
}
async function next(ans) {
  if (ans) session.answers.push(ans);
  if (ans) await speak(fill(SCRIPT.acks[session.i % 3], session.profile));
  session.i++; session.i < session.qs.length ? renderQ() : finish();
}
async function finish() {
  speechSynthesis?.cancel(); speak(fill(SCRIPT.closing, session.profile));
  $app.innerHTML = `<main class="page center"><div class="spinner">📖</div><h2>正在把您的故事<br>写成一本小书…</h2></main>`;
  const { answers, profile: p } = session;
  const s = await generateStory(answers, p);
  const id = 's' + Date.now();
  await saveStory({ id, createdAt: Date.now(), ...s, profile: p, answers });
  go('#/story/' + id);
}
async function story(id) {
  const s = await getStory(id); if (!s) return go('#/library');
  $app.innerHTML = `<main class="page story"><p class="stage">${new Date(s.createdAt).toLocaleDateString('zh-CN')} · ${esc(s.profile.name)} 讲述</p>
  <h1 class="title">${esc(s.title)}</h1><article>${esc(s.body).split('\n\n').map(x => `<p>${x}</p>`).join('')}</article>
  ${s.quotes ? `<blockquote>${esc(s.quotes)}</blockquote>` : ''}${s.people ? `<p class="tip">关键人物：${esc(s.people)}<br>时间地点：${esc(s.timePlace)}</p>` : ''}
  <h3>🎧 原声</h3>${s.answers.map(a => `<div class="clip"><p class="cq">${esc(a.stage)}：${esc(a.question)}</p>${a.audio ? `<audio controls src="${URL.createObjectURL(a.audio)}"></audio>` : '<p class="tip">（无录音）</p>'}${a.text ? `<p class="ca">“${esc(a.text)}”</p>` : ''}</div>`).join('') || '<p class="tip">本次没有录音</p>'}
  <button class="big" id="share">💌 分享给家人</button><button class="ghost" onclick="location.hash='#/library'">📚 回到记忆库</button></main>`;
  document.getElementById('share').onclick = () => navigator.share ? navigator.share({ title: s.title, text: s.body }).catch(() => {}) : (navigator.clipboard?.writeText(s.title + '\n\n' + s.body), alert('故事文字已复制，可以发给家人'));
}
async function library() {
  const list = await listStories();
  $app.innerHTML = `<main class="page"><h2>📚 记忆库</h2><p class="tip">每一段，都是留给孩子们的宝藏</p>
  ${list.length ? list.map(s => `<a class="card" href="#/story/${s.id}"><b>${esc(s.title)}</b><span>${new Date(s.createdAt).toLocaleDateString('zh-CN')} · ${esc(s.profile.name)} · ${s.answers.length} 段原声</span></a>`).join('') : '<p class="empty">还没有故事。<br>去和老人聊一聊吧。</p>'}
  <button class="big" onclick="location.hash='#/stage'">🎙 再聊一次</button><button class="link" onclick="location.hash='#/'">← 首页</button></main>`;
}
function stagePick() {
  const p = getProfile(); if (!p) return go('#/profile');
  $app.innerHTML = `<main class="page"><h2>今天聊哪段日子？</h2><p class="tip">${esc(p.callName || p.name)}，选一个想聊的</p>
  ${STAGES.map((s, k) => `<button class="${p.stage === s ? 'big' : 'ghost'} stagebtn" data-s="${s}">${['🌾', '📚', '💞', '👶'][k]} ${s}</button>`).join('')}
  <button class="link" onclick="location.hash='#/'">← 返回</button></main>`;
  $app.querySelectorAll('.stagebtn').forEach(b => b.onclick = () => { setProfile({ ...p, stage: b.dataset.s }); go('#/interview'); });
}
route();
