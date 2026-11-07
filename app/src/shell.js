// “我的”区域框架：侧边栏 + 对话式首页 + 历史/资料/设置。使用者是老人本人，没有登录。
// 老人首屏（#/）和访谈页不经过这里。亲友绑定（邀请码）是后续单独模块，见 docs/requirements-tiers.md。
let D = null; // 依赖，由 main.js 注入
const get = (k, d = null) => { try { return JSON.parse(localStorage.getItem(k) ?? 'null') ?? d; } catch { return d; } };
const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
export const MY_ROUTES = new Set(['me', 'profile', 'stage', 'library', 'archive', 'map', 'story', 'history', 'account', 'settings']);

const FS = { 1: '标准', 1.12: '大', 1.25: '特大' };
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
  const on = MY_ROUTES.has(name); document.body.classList.toggle('has-shell', on); document.body.classList.remove('side-open');
  if (on) renderSide(name); }

const dayLabel = t => { const d = new Date(t), n = new Date(), s = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(), diff = Math.round((s(n) - s(d)) / 864e5);
  return diff <= 0 ? '今天' : diff === 1 ? '昨天' : diff < 7 ? '本周' : '更早'; };
const when = t => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const storyOf = (c, iid) => (c?.stories || []).find(s => s.interview_id === iid);

function renderSide(name) {
  const { esc, getProfile, getCache, callNameOf } = D, p = getProfile(), c = getCache();
  const done = (c?.interviews || []).filter(i => i.finished).slice(0, 6), me = p ? callNameOf(p) : '我';
  const nav = [['me', '对话', '#/me', '💬'], ['history', '历史记录', '#/history', '🕘'], ['library', '我的故事', '#/library', '📚'], ['archive', '记忆档案', '#/archive', '🗂'], ['map', '人生地图', '#/map', '🗺']];
  document.getElementById('side').innerHTML = `<div class="brand"><span class="logo-s">记忆银行</span></div>
  <a class="new" href="#/stage">＋ 新对话</a>
  <nav>${nav.map(([k, t, h, i]) => `<a href="${h}" class="${name === k || (k === 'library' && name === 'story') ? 'on' : ''}"><i>${i}</i>${t}</a>`).join('')}</nav>
  ${done.length ? `<p class="grp">最近</p><div class="recent">${done.map(i => { const s = storyOf(c, i.id); return `<a href="${s ? '#/story/' + s.id : '#/history'}" title="${esc(s?.title || i.stage || '')}">${esc(s?.title || i.stage || '一次聊天')}<small>${when(i.created)}</small></a>`; }).join('')}</div>` : ''}
  <div class="foot"><a href="#/account" class="who ${name === 'account' ? 'on' : ''}"><span class="av">${esc(me.slice(0, 1))}</span><span>${esc(me)}<small>我的资料</small></span></a>
    <a href="#/settings" class="gear ${name === 'settings' ? 'on' : ''}" aria-label="设置">⚙</a></div>
  <a class="homelink" href="#/">‹ 回到首页</a>`; }

// —— 页面 ——
export function chatHome() {
  const { esc, getProfile, getCache, callNameOf, go, FW, setReq } = D, p = getProfile(), c = getCache(), s0 = c?.stories?.[0], n = (c?.interviews || []).filter(i => i.finished).length;
  const bot = h => `<div class="msg bot"><span class="av">忆</span><div class="bub">${h}</div></div>`;
  D.$app.innerHTML = `<main class="page chat"><div class="thread">
  ${p ? bot(`${esc(callNameOf(p))}，今天想聊聊吗？<br><small>点下面的按钮，小忆就陪您聊${n ? `。咱们已经聊过 ${n} 次啦` : ''}。</small>`) : bot('先留几句您的资料吧，小忆才知道怎么称呼您、从哪儿聊起。')}
  ${p && s0 ? `<div class="msg bot"><span class="av">忆</span><a class="bub storycard" href="#/story/${s0.id}"><small>最近的故事 · ${new Date(s0.created).toLocaleDateString('zh-CN')}</small><b>${esc(s0.title)}</b><span>${esc(String(s0.body || '').replace(/\s+/g, '').slice(0, 44))}……</span></a></div>` : ''}
  ${p && c?.archive?.lastTopic ? bot(`上次聊到：${esc(c.archive.lastTopic)}。要接着聊吗？`) : ''}
  ${p ? `<div class="chips">${Object.entries(FW.dimensions.trigger.values).map(([k, l]) => `<button class="chip-b" data-t="${k}">想聊${esc(l)}</button>`).join('')}</div>` : ''}
  </div><div class="composer"><button class="pill" id="start">${p ? '想聊点什么，点这里开始……' : '点这里，写下我的资料……'}</button><button class="send" id="start2">${p ? '🎙 开始对话' : '写资料'}</button></div></main>`;
  const start = () => go(p ? '#/stage' : '#/profile'); document.getElementById('start').onclick = start; document.getElementById('start2').onclick = start;
  D.$app.querySelectorAll('.chip-b').forEach(b => b.onclick = () => { setReq({ trigger: b.dataset.t }); go('#/stage'); }); }

export function history() {
  const { esc, getCache, go } = D, c = getCache(), list = (c?.interviews || []).filter(i => i.finished), groups = {};
  for (const i of list) (groups[dayLabel(i.created)] ||= []).push(i);
  D.$app.innerHTML = `<main class="page history"><h2>🕘 历史记录</h2><p class="tip">每次聊天都在这里，点开可以回看故事和原声</p>
  ${list.length ? ['今天', '昨天', '本周', '更早'].filter(k => groups[k]).map(k => `<h3>${k}</h3>${groups[k].map(i => { const s = storyOf(c, i.id);
    return `<a class="card hrow" href="${s ? '#/story/' + s.id : '#/archive'}"><b>${esc(s?.title || '一次聊天')}</b><span>${when(i.created)} · ${esc(i.stage || '')} · ${(i.turns || []).length} 句</span></a>`; }).join('')}`).join('')
    : '<p class="empty">还没有聊过。<br>咱们聊第一次吧。</p>'}
  <button class="big" id="go">🎙 开始对话</button></main>`; document.getElementById('go').onclick = () => go('#/stage'); }

export function account() {
  const { esc, getProfile, callNameOf } = D, p = getProfile();
  D.$app.innerHTML = `<main class="page account"><h2>我的资料</h2>
  ${p ? `<div class="acard"><span class="av big-av">${esc(callNameOf(p).slice(0, 1))}</span><div><b>${esc(callNameOf(p))}</b><br><small>${[p.birthYear && p.birthYear + ' 年生', p.hometown].filter(Boolean).map(esc).join(' · ') || '资料还不完整'}</small>${p.people ? `<br><small>身边的人：${esc(p.people)}</small>` : ''}</div></div>
  <button class="ghost" onclick="location.hash='#/profile'">修改我的资料</button>` : '<p class="tip">还没有资料。</p><button class="big" onclick="location.hash=\'#/profile\'">写下我的资料</button>'}
  <h3>切换演示老人</h3><div class="seg" id="demos"><button data-id="demo-wang" class="${D.elderId === 'demo-wang' ? 'on' : ''}">王女士</button><button data-id="demo-fugui" class="${D.elderId === 'demo-fugui' ? 'on' : ''}">徐先生</button></div><p class="tip">演示数据，内容为虚构。徐先生的人物原型取自《活着》，对话为自编。</p></main>`;
  document.querySelectorAll('#demos button').forEach(b => b.onclick = async () => { const id = b.dataset.id; try { const e = await (await fetch('/api/elders/' + id)).json(); localStorage.setItem('mb_elder', id); localStorage.setItem('mb_profile', JSON.stringify(e.profile)); } catch { return; } location.hash = '#/me'; location.reload(); }); }

export function settings() {
  const { esc, elderId } = D;
  const seg = (name, opts, cur) => `<div class="seg" data-k="${name}">${opts.map(([v, t]) => `<button data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${esc(t)}</button>`).join('')}</div>`;
  D.$app.innerHTML = `<main class="page settings"><h2>设置</h2>
  <section><h3>字号</h3>${seg('fs', Object.entries(FS), get('mb_fs', 1))}</section>
  <section><h3>我的资料</h3><button class="ghost" onclick="location.hash='#/profile'">称呼、出生年份、家乡、身边的人</button></section>
  <section><h3>数据</h3>${elderId ? `<a class="ghost btn" href="/api/elders/${esc(elderId)}/export.zip" download>📦 打包下载（原声、访谈稿、故事、档案）</a>` : '<p class="tip">写下资料并聊过之后可以下载。</p>'}</section></main>`;
  D.$app.querySelectorAll('.seg').forEach(s => s.querySelectorAll('button').forEach(b => b.onclick = () => { put('mb_fs', +b.dataset.v); applyPrefs(); settings(); })); }
