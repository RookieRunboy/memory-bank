// “我的”区域框架：侧边栏 + 对话式首页 + 历史/资料/设置。使用者是老人本人，没有登录。
// 访谈页不经过这里。没有单独的首页，根路径直接进入这里的对话页。亲友绑定（邀请码）是后续单独模块，见 docs/requirements-tiers.md。
import { ic, wave, brandMark, alive } from './ui.js';
let D = null; // 依赖，由 main.js 注入
const get = (k, d = null) => { try { return JSON.parse(localStorage.getItem(k) ?? 'null') ?? d; } catch { return d; } };
const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
export const MY_ROUTES = new Set(['me', 'profile', 'library', 'archive', 'story', 'account', 'settings']);

const FS = { 1: '标准', 1.12: '大', 1.25: '特大' };
export function applyPrefs() { document.body.style.setProperty('--fs', String(get('mb_fs', 1))); }

export function init(deps) { D = deps; applyPrefs();
  const app = document.getElementById('app'), shell = document.createElement('div'); shell.id = 'shell';
  shell.innerHTML = `<header class="topbar"><button class="icon" id="menu" aria-label="打开菜单">${ic('menu', 22)}</button><b>${brandMark()}记忆银行</b><button class="icon" id="newchat" aria-label="新对话">${ic('plus', 22)}</button></header><div class="scrim" id="scrim"></div><aside class="side" id="side" aria-label="导航"></aside><div class="stage" id="stage"></div>`;
  app.parentNode.insertBefore(shell, app); shell.querySelector('#stage').appendChild(app);
  const open = on => document.body.classList.toggle('side-open', on);
  shell.querySelector('#menu').onclick = () => open(true); shell.querySelector('#scrim').onclick = () => open(false);
  shell.querySelector('#newchat').onclick = () => { open(false); D.go('#/interview'); };
  shell.querySelector('#side').addEventListener('click', e => { if (e.target.closest('a,button')) open(false); }); }

// 每次路由前调用：决定显示不显示框架，并刷新侧边栏（缓存里的历史会变）
export function mount(name) {
  const on = MY_ROUTES.has(name); document.body.classList.toggle('has-shell', on); document.body.classList.remove('side-open');
  if (on) renderSide(name); }

export const dayLabel = t => { const d = new Date(t), n = new Date(), s = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(), diff = Math.round((s(n) - s(d)) / 864e5);
  return diff <= 0 ? '今天' : diff === 1 ? '昨天' : diff < 7 ? '本周' : '更早'; };
export const when = t => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const storyOf = (c, iid) => (c?.stories || []).find(s => s.interview_id === iid);

function renderSide(name) {
  const { esc, getProfile, getCache, callNameOf } = D, p = getProfile(), c = getCache();
  const done = (c?.interviews || []).filter(i => i.finished).slice(0, 6), me = p ? callNameOf(p) : '我';
  const nav = [['me', '对话', '#/me', 'chat'], ['library', '我的故事', '#/library', 'book'], ['archive', '记忆档案', '#/archive', 'vault']];
  document.getElementById('side').innerHTML = `<div class="brand">${brandMark()}<span class="logo-s">记忆银行</span></div>
  <a class="new" href="#/interview">${ic('plus', 18)}新对话</a>
  <nav>${nav.map(([k, t, h, i]) => `<a href="${h}" class="${name === k || (k === 'library' && name === 'story') ? 'on' : ''}">${ic(i)}${t}</a>`).join('')}</nav>
  ${done.length ? `<p class="grp">最近</p><div class="recent">${done.map(i => { const s = storyOf(c, i.id); return `<a href="${s ? '#/story/' + s.id : '#/library'}" title="${esc(s?.title || i.stage || '')}">${esc(s?.title || i.stage || '一次聊天')}<small>${when(i.created)}</small></a>`; }).join('')}</div>` : ''}
  <div class="foot"><a href="#/account" class="who ${name === 'account' ? 'on' : ''}"><span class="av">${esc(me.slice(0, 1))}</span><span>${esc(me)}<small>我的资料</small></span></a>
    <a href="#/settings" class="gear ${name === 'settings' ? 'on' : ''}" aria-label="设置">${ic('gear')}</a></div>`; }

// —— 页面 ——
export function chatHome() {
  const { esc, getProfile, getCache, callNameOf, go, FW, setReq } = D, p = getProfile(), c = getCache(), s0 = c?.stories?.[0], n = (c?.interviews || []).filter(i => i.finished).length;
  const bot = h => `<div class="msg bot"><span class="av">忆</span><div class="bub">${h}</div></div>`;
  const tp = FW.dimensions.trigger.values, TI = { photo: 'photo', song: 'song', food: 'food', object: 'object', festival: 'festival' };
  D.$app.innerHTML = `<main class="page chat"><div class="thread">
  <section class="hero"><p class="eyebrow">MEMORY BANK</p>
    <h1>${p ? `${esc(callNameOf(p))}，今天想存点什么？` : '把一生的声音，存起来'}</h1>
    <p>${p ? '开口说就好。小忆负责提问、录音，并把您讲的写成可以留给后人的故事。' : '先留几句资料，小忆才知道怎么称呼您、从哪儿聊起。'}</p>
    ${p ? `<div class="stats"><div><b>${n}</b><span>次对话</span></div><div><b>${c?.stories?.length || 0}</b><span>篇故事</span></div><div><b>${c?.entities?.length || 0}</b><span>个人·地·物</span></div></div>` : ''}</section>
  ${p && s0 ? `<div class="msg bot"><span class="av">忆</span><a class="bub storycard" href="#/story/${s0.id}"><span class="k">最近的故事 · ${new Date(s0.created).toLocaleDateString('zh-CN')}</span><b>${esc(s0.title)}</b><span class="ex">${esc(String(s0.body || '').replace(/\s+/g, '').slice(0, 44))}……</span>${wave(s0.id)}</a></div>` : ''}
  ${p && c?.archive?.lastTopic ? bot(`上次聊到：${esc(c.archive.lastTopic)}。要接着聊吗？`) : ''}
  ${p ? `<div class="chips">${Object.entries(tp).map(([k, l]) => `<button class="chip-b" data-t="${k}">${ic(TI[k] || 'photo', 16)}想聊${esc(l)}</button>`).join('')}</div>` : ''}
  </div><div class="composer"><button class="pill" id="start">${p ? '说点什么……' : '点这里，写下我的资料……'}</button><button class="send" id="start2">${p ? ic('mic', 18) + '开始对话' : '写资料'}</button></div></main>`;
  const start = () => go(p ? '#/interview' : '#/profile'); document.getElementById('start').onclick = start; document.getElementById('start2').onclick = start;
  D.$app.querySelectorAll('.chip-b').forEach(b => b.onclick = () => { setReq({ trigger: b.dataset.t }); go('#/interview'); }); }

export function account() {
  const { esc, getProfile, callNameOf } = D, p = getProfile();
  D.$app.innerHTML = `<main class="page account"><h2>我的资料</h2>
  ${p ? `<div class="acard"><span class="av big-av">${esc(callNameOf(p).slice(0, 1))}</span><div><b>${esc(callNameOf(p))}</b><br><small>${[p.birthYear && p.birthYear + ' 年生', p.hometown].filter(Boolean).map(esc).join(' · ') || '资料还不完整'}</small>${p.people ? `<br><small>身边的人：${esc(alive(p.people))}</small>` : ''}</div></div>
  <button class="ghost" onclick="location.hash='#/profile'">修改我的资料</button>` : '<p class="tip">还没有资料。</p><button class="big" onclick="location.hash=\'#/profile\'">写下我的资料</button>'}
  <h3>切换演示老人</h3><div class="seg" id="demos"><button data-id="demo-wang" class="${D.elderId === 'demo-wang' ? 'on' : ''}">王女士</button><button data-id="demo-fugui" class="${D.elderId === 'demo-fugui' ? 'on' : ''}">徐先生</button></div><p class="tip">演示数据，内容为虚构。徐先生的人物原型取自《活着》，对话为自编。</p></main>`;
  document.querySelectorAll('#demos button').forEach(b => b.onclick = async () => { const id = b.dataset.id; try { const e = await (await fetch('/api/elders/' + id)).json(); localStorage.setItem('mb_elder', id); localStorage.setItem('mb_profile', JSON.stringify(e.profile)); } catch { return; } location.hash = '#/me'; location.reload(); }); }

export function settings() {
  const { esc, elderId } = D;
  const seg = (name, opts, cur) => `<div class="seg" data-k="${name}">${opts.map(([v, t]) => `<button data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${esc(t)}</button>`).join('')}</div>`;
  D.$app.innerHTML = `<main class="page settings"><h2>设置</h2>
  <section><h3>字号</h3>${seg('fs', Object.entries(FS), get('mb_fs', 1))}</section>
  <section><h3>我的资料</h3><button class="ghost" onclick="location.hash='#/profile'">称呼、出生年份、家乡、身边的人</button></section>
  <section><h3>数据</h3>${elderId ? `<a class="ghost btn" href="/api/elders/${esc(elderId)}/export.zip" download>${ic('down', 18)}打包下载（原声、访谈稿、故事、档案）</a>` : '<p class="tip">写下资料并聊过之后可以下载。</p>'}</section></main>`;
  D.$app.querySelectorAll('.seg').forEach(s => s.querySelectorAll('button').forEach(b => b.onclick = () => { put('mb_fs', +b.dataset.v); applyPrefs(); settings(); })); }
