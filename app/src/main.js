// 会话级持续语音；后端不可达时保留本机原声与手动/浏览器转写。
import { DEMO_PROFILE } from './questions.js';
import { autoCallName, callNameOf } from './callname.js';
import FW from './framework.json';
import * as P from './planner.js';
import { listStories, getStory } from './db.js';
import * as Shell from './shell.js';
import { ic, alive } from './ui.js';
import { VoicePlayback } from './voice-playback.js';
import { VoiceInterview } from './voice-interview.js';
const $app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const api = async (u, o = {}) => { const r = await fetch('/api' + u, { ...o, headers: o.body instanceof FormData ? {} : { 'Content-Type': 'application/json' } }); if (!r.ok) throw new Error(r.status); return r.json(); };
const post = (u, b) => api(u, { method: 'POST', body: b instanceof FormData ? b : JSON.stringify(b) });
let elderId = localStorage.getItem('mb_elder'), cache = null;
const getProfile = () => cache?.profile || JSON.parse(localStorage.getItem('mb_profile') || 'null');
async function load() { if (!elderId) return null; try { cache = await api('/elders/' + elderId); } catch { cache = null; } return cache; }
async function setProfile(p) { localStorage.setItem('mb_profile', JSON.stringify(p));
  try { const e = await post('/elders', { id: elderId, profile: p }); elderId = e.id; localStorage.setItem('mb_elder', e.id); cache = e; } catch {} }

// 声音与采集资源属于会话，重绘不创建资源。
let voice = null, autoVoiceStart = false;
const playback = new VoicePlayback({onState: () => voice?.paint(), onFirstAudio: x => voice?.playbackFirst(x), onComplete: x => voice?.playbackComplete(x)});
const speak = (text, options) => playback.speak(text, options);
const stopSpeak = () => playback.stop();
const unlockAudio = () => playback.unlock();
function startVoiceEntry() { autoVoiceStart = true; playback.unlock(); go('#/interview'); }
let routeEpoch = 0, storyPlayer = null, storyURLs = [];
const storyURL = b => { const u = URL.createObjectURL(b); storyURLs.push(u); return u; };
const routes = { me: Shell.chatHome, account: Shell.account, settings: Shell.settings, profile, interview, story, library, archive };
const route = async () => { const epoch = ++routeEpoch, [p, id] = location.hash.slice(2).split('/');
  voice?.dispose(); voice = null; stopSpeak(); storyPlayer?.pause(); storyPlayer = null; storyURLs.forEach(u => URL.revokeObjectURL(u)); storyURLs = [];
  if (p !== 'interview') playback.dispose();
  document.querySelectorAll('audio').forEach(a => a.pause());
  await load(); if (epoch !== routeEpoch) return;
  const name = routes[p] ? p : 'me';
  if (!getProfile() && !['profile', 'account'].includes(name)) return go('#/profile');
  Shell.mount(name); window.scrollTo(0, 0); routes[name](id); };
window.addEventListener('hashchange', route);
const go = h => location.hash = h;
const back = (h = '#/me', t = '返回') => `<button class="link" onclick="location.hash='${h}'">${ic('back', 16)}${t}</button>`;

function profile() {
  const p = getProfile() || {};
  $app.innerHTML = `<main class="page"><h2>我的资料</h2><p class="tip">您自己写，或者请身边的人帮着写都行。小忆会按这些称呼您、从合适的地方聊起</p>
  <form id="f"><label>姓名<input name="name" required value="${esc(p.name)}" placeholder="如：王秀兰"></label>
  <label>性别<select name="gender"><option value="">请选择</option><option value="女"${p.gender === '女' ? ' selected' : ''}>女</option><option value="男"${p.gender === '男' ? ' selected' : ''}>男</option></select></label>
  <label>希望怎么称呼<input name="callName" value="${esc(p.callName)}" placeholder="按姓氏和性别自动生成，如：王女士"><small class="tip">默认“姓＋先生/女士”，可以手动改</small></label>
  <input type="hidden" name="callNameManual" value="${p.callNameManual ? '1' : ''}">
  <label>出生年份<input name="birthYear" inputmode="numeric" value="${esc(p.birthYear)}" placeholder="如：1948"></label>
  <label>家乡<input name="hometown" value="${esc(p.hometown)}" placeholder="如：江苏扬州"></label>
  <label>身边重要的人（可选）<input name="people" value="${esc(p.people)}" placeholder="如：老伴李建国、女儿小梅"></label>
  <button class="big" type="submit">保存，下一步</button></form>
  <button class="ghost" id="demo">填入演示档案（王女士）</button>${back()}</main>`;
  const f = document.getElementById('f'), cn = f.callName, man = f.callNameManual;
  const auto = () => { if (!man.value) cn.value = autoCallName(f.name.value, f.gender.value); }; // 手动改过就不再自动覆盖
  f.name.oninput = auto; f.gender.onchange = auto; cn.oninput = () => { man.value = cn.value.trim() ? '1' : ''; if (!man.value) auto(); }; auto();
  f.onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(f)); const np = { ...p, ...d, callNameManual: !!d.callNameManual };
    if (np.callName !== p.callName) delete np.callNameBy; await setProfile(np); go('#/interview'); };
  document.getElementById('demo').onclick = async () => { elderId = 'demo-wang'; localStorage.setItem('mb_elder', elderId); await setProfile(DEMO_PROFILE); go('#/interview'); }; // 切换身份后再写演示资料，避免覆盖当前讲述者
}
// 没有“今天聊什么”预览页：点开始直接进访谈，小忆问候后念候选，老人自己选。手边有老照片、老歌、家乡菜时，从首页的小按钮带着进来。
const getReq = () => JSON.parse(sessionStorage.getItem('mb_req') || 'null');
const setReq = r => r ? sessionStorage.setItem('mb_req', JSON.stringify(r)) : sessionStorage.removeItem('mb_req');
async function interview() {
  const p = getProfile(); if (!p) return go('#/profile');
  const request = getReq(); setReq(null);
  const current = voice = new VoiceInterview({ app: $app, esc, api, elderId, profile: p, request, playback,
    onFinish: go, onProfile: p => { localStorage.setItem('mb_profile', JSON.stringify(p)); if (cache) cache.profile = p; } });
  const start = autoVoiceStart; autoVoiceStart = false;
  await current.initialize({ autoStart: start });
}
async function story(id) {
  const epoch = routeEpoch; let s; if (id.startsWith('local')) { const l = await getStory(id); s = l && { ...l, created: l.createdAt, elder: l.profile, clips: l.answers.map(a => ({ q: a.question, text: a.text, src: a.audio && storyURL(a.audio) })) }; }
  else s = await api('/stories/' + id).catch(() => null);
  if (epoch !== routeEpoch) return;
  if (!s) return go('#/library');
  const T = Object.fromEntries((s.transcript || []).map(t => [t.id, t])), clipOf = id => T[id] || (s.clips || []).find(c => c.id === id);
  const paras = s.paras || (s.body || '').split(/\n+/).map(text => ({ text, refs: [] }));
  const au = a => a ? (a.startsWith('blob:') ? a : '/api/audio/' + a) : null;
  const scripted = s.source === 'demo-scripted', actionLabel = scripted ? '查看出处' : '听原声';
  $app.innerHTML = `<main class="page story"><p class="stage stg">${new Date(s.created).toLocaleDateString('zh-CN')} · ${esc(s.elder.name)} 讲述 ${s.stage ? '· ' + esc(s.stage) : ''}</p>
  <h1 class="title">${esc(s.title)}</h1><p class="signal">共 ${(s.transcript || s.clips || []).length} ${scripted ? '轮访谈文本 · 范成采访 · 预置整理示例' : '段原声'}</p><article>${paras.map((x, k) => `<div class="para"><p>${esc(x.text)}</p>${x.refs.length ? `<button class="play" data-k="${k}" aria-label="${actionLabel}">${ic('play', 16)}${actionLabel}</button>` : ''}</div>`).join('')}</article>
  ${s.quotes ? `<blockquote>${esc(s.quotes)}</blockquote>` : ''}${s.people ? `<p class="tip">关键人物：${esc(s.people)}</p>` : ''}${s.timePlace ? `<p class="tip">时间地点：${esc(s.timePlace)}</p>` : ''}
  ${s.fullAudio ? `<h3>整场录音</h3><audio controls preload="none" src="${au(s.fullAudio)}"></audio>` : ''}
  ${s.fullSegments?.length ? `<details class="transcript"><summary>录音分段与暂停（${s.fullSegments.length} 段）</summary>${s.fullSegments.map((x,k) => `<div class="turn"><p class="tip">第 ${k+1} 段 · ${new Date(x.startedAt).toLocaleTimeString('zh-CN')}${/pause|end|finish|device/.test(x.boundary||'')?' · 在此暂停':''}</p><audio controls preload="none" src="${x.blob?storyURL(x.blob):au(x.audio)}"></audio></div>`).join('')}</details>` : ''}
  <details class="transcript" id="tx"><summary>查看完整访谈稿（${(s.transcript || s.clips || []).length} 轮，原话不改动）</summary>
  ${(s.transcript?.length ? s.transcript : (s.clips || []).map((c, k) => ({ id: c.id || 'c' + k, question: c.q, raw: c.text, clean: c.text, audio: c.audio || c.src }))).map(t => `<div class="turn" id="${esc(t.id)}"><p class="cq">${esc(t.interviewer || '小忆')}：${esc(t.question)}</p>
    <p class="ca">${t.speaker ? esc(t.speaker) + '：' : ''}“${esc(t.clean || '')}”</p>${t.raw && t.raw !== t.clean ? `<p class="raw">${scripted ? '原始对话稿' : '原始转写'}：${esc(t.raw)}</p>` : ''}
    ${t.audio ? `<audio controls preload="none" src="${au(t.audio)}"></audio>` : ''}
    <p class="meta">${esc(t.id)}${t.nodeId ? ` · ${esc(P.nodeTitle(FW, t.nodeId, s.elder))} · 第${t.depth}层 · ${esc(t.emotion || '')}` : ''}</p></div>`).join('')}</details>
  ${id.startsWith('local') ? '' : `<button class="ghost wide" id="edit">${ic('edit', 16)}修改故事（原话保留，修改留痕）</button>`}
  ${s.edits?.length ? `<details class="edits"><summary>修改记录（${s.edits.length}）</summary>${s.edits.map(x => `<p class="meta">${new Date(x.at).toLocaleString('zh-CN')} · ${esc(x.by)} 改了${x.field === 'title' ? '标题' : '正文'}<br>原来：${esc(x.before.slice(0, 40))}…</p>`).join('')}</details>` : ''}
  <div class="actions"><button class="big" id="share">${ic('share', 18)}分享这个故事</button><button class="ghost" onclick="location.hash='#/library'">我的故事</button></div></main>`;
  const player = storyPlayer = new Audio();
  $app.querySelectorAll('.play').forEach(b => b.onclick = () => { const refs = paras[b.dataset.k].refs.map(clipOf).filter(Boolean), c = refs[0]; if (!c) return;
    const a = au(c.audio || c.src); document.getElementById('tx').open = true; refs.forEach(ref => document.getElementById(ref.id)?.classList.add('hl'));
    if (scripted && !a) { document.getElementById(c.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (a) { player.src = a; player.play().catch(() => speak(c.clean || c.text, { force: true })); } else speak(c.clean || c.text, { force: true }); });
  const ed = document.getElementById('edit'); if (ed) ed.onclick = () => { const art = $app.querySelector('article');
    art.outerHTML = `<form id="ef" class="edit"><input name="title" value="${esc(s.title)}"><textarea name="body" rows="14">${esc(s.body)}</textarea><button class="big">保存修改</button></form>`; ed.remove();
    document.getElementById('ef').onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
      await fetch('/api/stories/' + id, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...f, by: s.elder?.demoInterviewer?.name || '本人' }) }); story(id); }; };
  document.getElementById('share').onclick = () => navigator.share ? navigator.share({ title: s.title, text: s.body, url: location.href }).catch(() => {}) : (navigator.clipboard?.writeText(s.title + '\n\n' + s.body), alert('故事文字已复制，可以发给家人'));
}
async function library() {
  const stories = [...(cache?.stories || []), ...(await listStories()).map(l => ({ ...l, created: l.createdAt, local: true }))];
  const noStory = (cache?.interviews || []).filter(i => i.finished && !stories.some(s => s.interview_id === i.id)).map(i => ({ id: i.id, created: i.created, stage: i.stage, chatOnly: true, n: (i.turns || []).length }));
  const list = [...stories, ...noStory].sort((a, b) => b.created - a.created), groups = {};
  for (const s of list) (groups[Shell.dayLabel(s.created)] ||= []).push(s);
  const row = s => s.chatOnly
    ? `<a class="card hrow" href="#/archive"><b>一次聊天</b><span>${Shell.when(s.created)} · ${esc(s.stage || '')} · ${s.n} 句</span></a>`
    : `<a class="card hrow" href="#/story/${s.id}"><b>${esc(s.title)}</b><span>${Shell.when(s.created)} · ${esc(s.stage || '')} · ${(s.clips || s.answers || []).length} ${s.source === 'demo-scripted' ? '轮访谈文本' : '段原声'}${s.local ? ' · 本机' : ''}</span></a>`;
  $app.innerHTML = `<main class="page history"><h2>我的故事</h2><p class="tip">每次聊天都在这里，点开回看故事和原声，都是留给孩子们的宝藏</p>
  ${list.length ? ['今天', '昨天', '本周', '更早'].filter(k => groups[k]).map(k => `<h3>${k}</h3>${groups[k].map(row).join('')}`).join('') : '<p class="empty">还没有故事。<br>咱们聊第一次吧。</p>'}
  <button class="big" onclick="location.hash='#/interview'">${ic('mic', 18)}再聊一次</button>${back('#/me', '返回')}</main>`;
}
function archive() {
  const a = cache?.archive || {}, p = getProfile() || {}, ivs = (cache?.interviews || []).filter(i => i.finished);
  const sec = (t, arr, f) => `<h3>${t}</h3>${arr?.length ? arr.map(f).join('') : '<p class="tip">还没有记录</p>'}`;
  $app.innerHTML = `<main class="page archive"><h2>${esc(callNameOf(p))}的记忆档案</h2><p class="tip">每次聊完自动整理，小忆下次会接着聊</p>
  ${cache?.archivePending ? `<div class="thinking small" id="archPending"><span class="wave"><i></i><i></i><i></i><i></i><i></i></span><p>小忆正在整理这次的记忆……</p><small>整理好会自动刷新</small></div>` : ''}
  ${a.lastTopic ? `<p class="hint">上次聊到：${esc(a.lastTopic)}</p>` : ''}
  ${sec('人 · 地 · 物', cache?.entities, x => `<div class="ent"><span class="ty">${{ person: ic('user', 12) + '人', place: ic('place', 12) + '地', thing: ic('thing', 12) + '物' }[x.type] || x.type}</span><b>${esc(x.name)}</b>${x.relation ? ` · ${esc(FW.dimensions.relation.values[x.relation] || x.relation)}` : ''}<br><small>来自：${x.sourceNodes.map(id => esc(P.nodeTitle(FW, id, p))).join('、')}${x.sourceTurns?.length ? ` · 出处句子 ${x.sourceTurns.map(esc).join('、')}` : ''}</small>${x.notes?.length ? `<br><small>${esc(x.notes.slice(-2).join('；'))}</small>` : ''}</div>`)}
  ${sec('人物', a.people, x => `<div class="chip"><b>${esc(x.name)}</b> · ${esc(alive(x.relation))}<br><small>${esc(x.note)}</small></div>`)}
  ${sec('地点', a.places, x => `<div class="chip"><b>${esc(x.name)}</b><br><small>${esc(x.note)}</small></div>`)}
  ${sec('事件', a.events, x => `<div class="chip"><b>${esc(x.title)}</b> <small>${esc(x.when)}</small><br><small>${esc(x.detail)}</small></div>`)}
  ${sec('时间线', a.timeline, x => `<div class="tl"><b>${esc(x.when)}</b><span>${esc(x.what)}</span></div>`)}
  ${a.conflicts?.filter(Boolean).length ? sec('前后说法（并列保留）', a.conflicts, x => `<p class="tip">${esc(x)}</p>`) : ''}
  ${sec('访谈记录', ivs, i => `<details class="chip"><summary>${new Date(i.created).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${esc(i.stage)} · ${i.turns.length} 句</summary>${i.turns.map(t => `<p class="cq">${esc(t.interviewer || '小忆')}：${esc(t.q)}</p>${t.audio ? `<audio controls preload="none" src="/api/audio/${t.audio}"></audio>` : ''}<p>${t.speaker ? esc(t.speaker) + ' · ' : ''}整理：${esc(t.clean)}</p><p class="tip">原始：${esc(t.raw)}</p>`).join('')}</details>`)}
  ${back()}</main>`;
  if (cache?.archivePending) setTimeout(async () => { if (!location.hash.startsWith('#/archive')) return; await load(); archive(); }, 3000);
}
Shell.init({ $app, esc, go, startVoiceEntry, FW, setReq, get elderId() { return elderId; }, getProfile, getCache: () => cache, callNameOf });
document.addEventListener('click', e => { if (e.target.closest('a[href="#/interview"]')) { e.preventDefault(); startVoiceEntry(); } });
window.addEventListener('pagehide', () => { voice?.dispose(); playback.dispose(); storyPlayer?.pause(); });
window.addEventListener('storage', e => { if (e.key === 'mb_elder' && e.newValue !== elderId) { voice?.dispose(); stopSpeak(); location.reload(); } });
document.addEventListener('pointerdown', unlockAudio, { once: true }); // 首次点击解锁音频（「开始聊天」也会再解锁一次）
route();
