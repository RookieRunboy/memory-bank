// 家人端框架（T1-1/T1-2）：侧边栏 + 对话式首页 + 登录/历史/账号/设置。老人端首屏与访谈页不经过这里。
// 登录是演示用的：只在本机 localStorage 记一个标记，不发验证码，不连后端（真登录见 docs/requirements-tiers.md T2-1）。
let D = null; // 依赖，由 main.js 注入
const get = (k, d = null) => { try { return JSON.parse(localStorage.getItem(k) ?? 'null') ?? d; } catch { return d; } };
const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
export const getUser = () => get('mb_user');
export const isElderPass = () => { try { return sessionStorage.getItem('mb_role') === 'elder'; } catch { return false; } };
export const canEnter = () => !!getUser() || isElderPass();
export const elderPass = () => { try { sessionStorage.setItem('mb_role', 'elder'); } catch {} };
export const FAMILY_ROUTES = new Set(['family', 'profile', 'stage', 'library', 'archive', 'map', 'story', 'history', 'account', 'settings']);

const FS = { 1: '标准', 1.12: '大', 1.25: '特大' }; // 视觉定为记忆册（2026-11-07），不再提供对话式配色
export function applyPrefs() { document.body.style.setProperty('--fs', String(get('mb_fs', 1))); }

export function init(deps) { D = deps; applyPrefs();
  const app = document.getElementById('app'), shell = document.createElement('div'); shell.id = 'shell';
  shell.innerHTML = `<header class="topbar"><button class="icon" id="menu" aria-label="打开菜单">☰</button><b>记忆银行</b><button class="icon" id="newchat" aria-label="新对话">✎</button></header><div class="scrim" id="scrim"></div><aside class="side" id="side" aria-label="导航"></aside><div class="stage" id="stage"></div>`;
  app.parentNode.insertBefore(shell, app); shell.querySelector('#stage').appendChild(app);
  const open = on => document.body.classList.toggle('side-open', on);
  shell.querySelector('#menu').onclick = () => open(true); shell.querySelector('#scrim').onclick = () => open(false);
  shell.querySelector('#newchat').onclick = () => { open(false); D.go('#/stage'); };
  shell.querySelector('#side').addEventListener('click', e => { if (e.target.closest('a,button')) open(false); }); }

// 每次路由前调用：决定显示不显示框架，并刷新侧边栏（缓存里的历史会变）
export function mount(name) {
  const on = FAMILY_ROUTES.has(name) && canEnter(); document.body.classList.toggle('has-shell', on); document.body.classList.remove('side-open');
  if (on) renderSide(name); }

const dayLabel = t => { const d = new Date(t), n = new Date(), s = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(), diff = Math.round((s(n) - s(d)) / 864e5);
  return diff <= 0 ? '今天' : diff === 1 ? '昨天' : diff < 7 ? '本周' : '更早'; };
const when = t => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const storyOf = (c, iid) => (c?.stories || []).find(s => s.interview_id === iid);

function renderSide(name) {
  const { esc, getProfile, getCache, callNameOf } = D, p = getProfile(), c = getCache(), u = getUser(), elder = isElderPass() && !u;
  const done = (c?.interviews || []).filter(i => i.finished).slice(0, 6);
  const nav = [['family', '对话', '#/family', '💬'], ['history', '历史记录', '#/history', '🕘'], ['library', '记忆库', '#/library', '📚'], ['archive', '记忆档案', '#/archive', '🗂'], ['map', '人生地图', '#/map', '🗺']];
  document.getElementById('side').innerHTML = `<div class="brand"><span class="logo-s">记忆银行</span></div>
  <a class="new" href="#/stage">＋ 新对话</a>
  <nav>${nav.map(([k, t, h, i]) => `<a href="${h}" class="${name === k || (k === 'library' && name === 'story') ? 'on' : ''}"><i>${i}</i>${t}</a>`).join('')}</nav>
  ${done.length ? `<p class="grp">最近</p><div class="recent">${done.map(i => { const s = storyOf(c, i.id); return `<a href="${s ? '#/story/' + s.id : '#/history'}" title="${esc(s?.title || i.stage || '')}">${esc(s?.title || i.stage || '一次聊天')}<small>${when(i.created)}</small></a>`; }).join('')}</div>` : ''}
  <div class="foot">${elder ? `<a href="#/" class="who"><span class="av">‹</span><span>回到老人首页<small>${esc(p ? callNameOf(p) : '')}</small></span></a>`
    : `<a href="#/account" class="who ${name === 'account' ? 'on' : ''}"><span class="av">${esc((u?.name || '家').slice(0, 1))}</span><span>${esc(u?.name || '家人')}<small>${p ? '陪伴 ' + esc(callNameOf(p)) : '还没建档'}</small></span></a>
    <a href="#/settings" class="gear ${name === 'settings' ? 'on' : ''}" aria-label="设置">⚙</a>`}</div>`; }

// —— 页面 ——
export function login() {
  const { esc, go } = D; if (getUser()) return go('#/family');
  D.$app.innerHTML = `<main class="page login"><p class="poem">趁我还记得，<br>请听我慢慢说。</p><h1 class="logo">记忆银行</h1><p class="sub">子女登录后，管理和收听老人的记忆</p>
  <form id="lf"><label>邮箱或手机号<input name="contact" autocomplete="username" placeholder="例如：zhang@example.com" required></label>
  <label>怎么称呼你<input name="name" placeholder="例如：小张" maxlength="12"></label><button class="big" type="submit">进入记忆银行</button></form>
  <button class="ghost" id="demo">用演示账号进入</button>
  <p class="tip">演示版：不会发送验证码，信息只保存在这台设备的浏览器里。</p></main>`;
  const enter = (contact, name) => { put('mb_user', { contact, name: (name || '').trim() || (contact.split('@')[0] || '家人').slice(0, 12) }); go('#/family'); };
  document.getElementById('lf').onsubmit = e => { e.preventDefault(); const f = new FormData(e.target); enter(String(f.get('contact')).trim(), String(f.get('name'))); };
  document.getElementById('demo').onclick = () => enter('demo@memory-bank.local', '小梅'); void esc; }

export function chatHome() {
  const { esc, getProfile, getCache, callNameOf, go, FW, setReq, trigIcon } = D, p = getProfile(), c = getCache(), s0 = c?.stories?.[0], n = (c?.interviews || []).filter(i => i.finished).length;
  const bot = h => `<div class="msg bot"><span class="av">忆</span><div class="bub">${h}</div></div>`;
  D.$app.innerHTML = `<main class="page chat"><div class="thread">
  ${p ? bot(`${esc(callNameOf(p))}今天想聊聊吗？<br><small>点下面的按钮，小忆就开始陪 TA 聊${n ? `。已经聊过 ${n} 次啦` : ''}。</small>`) : bot('先给老人建个档吧，小忆才知道怎么称呼、从哪儿问起。')}
  ${p && s0 ? `<div class="msg bot"><span class="av">忆</span><a class="bub storycard" href="#/story/${s0.id}"><small>最近的故事 · ${new Date(s0.created).toLocaleDateString('zh-CN')}</small><b>${esc(s0.title)}</b><span>${esc(String(s0.body || '').replace(/\s+/g, '').slice(0, 44))}……</span></a></div>` : ''}
  ${p && c?.archive?.lastTopic ? bot(`上次聊到：${esc(c.archive.lastTopic)}。要接着聊吗？`) : ''}
  ${p ? `<div class="chips">${Object.entries(FW.dimensions.trigger.values).map(([k, l]) => `<button class="chip-b" data-t="${k}">${trigIcon[k] || ''} ${esc(l)}开场</button>`).join('')}</div>` : ''}
  </div><div class="composer"><button class="pill" id="start">${p ? '想聊点什么，点这里开始……' : '点这里，开始建档……'}</button><button class="send" id="start2">${p ? '🎙 开始对话' : '开始建档'}</button></div></main>`;
  const start = () => go(p ? '#/stage' : '#/profile'); document.getElementById('start').onclick = start; document.getElementById('start2').onclick = start;
  D.$app.querySelectorAll('.chip-b').forEach(b => b.onclick = () => { setReq({ trigger: b.dataset.t }); go('#/stage'); }); }

export function history() {
  const { esc, getCache, go } = D, c = getCache(), list = (c?.interviews || []).filter(i => i.finished), groups = {};
  for (const i of list) (groups[dayLabel(i.created)] ||= []).push(i);
  D.$app.innerHTML = `<main class="page history"><h2>🕘 历史记录</h2><p class="tip">每次聊天都在这里，点开可以回看故事和原声</p>
  ${list.length ? ['今天', '昨天', '本周', '更早'].filter(k => groups[k]).map(k => `<h3>${k}</h3>${groups[k].map(i => { const s = storyOf(c, i.id);
    return `<a class="card hrow" href="${s ? '#/story/' + s.id : '#/archive'}"><b>${esc(s?.title || '一次聊天')}</b><span>${when(i.created)} · ${esc(i.stage || '')} · ${(i.turns || []).length} 句</span></a>`; }).join('')}`).join('')
    : '<p class="empty">还没有聊过。<br>去和老人聊第一次吧。</p>'}
  <button class="big" id="go">🎙 开始对话</button></main>`; document.getElementById('go').onclick = () => go('#/stage'); }

export function account() {
  const { esc, getProfile, callNameOf, go } = D, u = getUser(), p = getProfile();
  if (!u) return go('#/family');
  D.$app.innerHTML = `<main class="page account"><h2>个人信息</h2>
  <div class="acard"><span class="av big-av">${esc(u.name.slice(0, 1))}</span><div><b>${esc(u.name)}</b><br><small>${esc(u.contact)}</small></div></div>
  <h3>陪伴的老人</h3>${p ? `<div class="acard col"><b>${esc(callNameOf(p))}</b><small>${[p.birthYear && p.birthYear + ' 年生', p.hometown].filter(Boolean).map(esc).join(' · ') || '资料还不完整'}</small><button class="link" onclick="location.hash='#/profile'">修改档案</button></div>` : '<p class="tip">还没有建档。</p><button class="ghost" onclick="location.hash=\'#/profile\'">去建档</button>'}
  <button class="ghost" id="out">退出登录</button><p class="tip">演示登录：信息只存在这台设备上，退出只是清除这个标记，老人的故事不会被删除。</p></main>`;
  document.getElementById('out').onclick = () => { try { localStorage.removeItem('mb_user'); } catch {} go('#/family'); }; }

export function settings() {
  const { esc, go, elderId } = D, u = getUser(); if (!u) return go('#/family');
  const seg = (name, opts, cur) => `<div class="seg" data-k="${name}">${opts.map(([v, t]) => `<button data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${esc(t)}</button>`).join('')}</div>`;
  D.$app.innerHTML = `<main class="page settings"><h2>设置</h2>
  <section><h3>字号</h3>${seg('fs', Object.entries(FS), get('mb_fs', 1))}</section>
  <section><h3>老人档案</h3><button class="ghost" onclick="location.hash='#/profile'">称呼、出生年份、家乡、重要的人</button></section>
  <section><h3>数据</h3>${elderId ? `<a class="ghost btn" href="/api/elders/${esc(elderId)}/export.zip" download>📦 打包下载（原声、访谈稿、故事、档案）</a>` : '<p class="tip">建档并聊过之后可以下载。</p>'}
  <button class="ghost" id="wipe">清除这台设备上的本地设置</button></section></main>`;
  D.$app.querySelectorAll('.seg').forEach(s => s.querySelectorAll('button').forEach(b => b.onclick = () => { put('mb_fs', +b.dataset.v); applyPrefs(); settings(); }));
  document.getElementById('wipe').onclick = () => { if (confirm('清除本设备的登录和字号设置？老人的故事和录音不会被删除。')) { for (const k of ['mb_user', 'mb_fs']) try { localStorage.removeItem(k); } catch {} applyPrefs(); go('#/family'); } }; }
