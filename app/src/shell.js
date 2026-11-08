// “我的”区域框架：侧边栏 + 对话式首页 + 历史/资料/设置。使用者是老人本人，没有登录。
// 访谈页不经过这里。没有单独的首页，根路径直接进入这里的对话页。亲友绑定（邀请码）是后续单独模块，见 docs/requirements-tiers.md。
import { ic, brandMark, alive } from './ui.js';
let D = null; // 依赖，由 main.js 注入
const get = (k, d = null) => { try { return JSON.parse(localStorage.getItem(k) ?? 'null') ?? d; } catch { return d; } };
const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
export const MY_ROUTES = new Set(['me', 'profile', 'library', 'archive', 'story', 'account', 'settings']);

const FS = { 1: '标准', 1.2: '大', 1.4: '特大' };
export function applyPrefs() { document.documentElement.style.setProperty('--fs', String(get('mb_fs', 1))); }

export function init(deps) { D = deps; applyPrefs();
  const app = document.getElementById('app'), shell = document.createElement('div'); shell.id = 'shell';
  shell.innerHTML = `<header class="topbar"><button class="icon" id="menu" aria-label="打开菜单">${ic('menu', 24)}</button><b>记忆银行</b><button class="icon" id="newchat" aria-label="开始说">${ic('mic', 24)}</button></header><div class="scrim" id="scrim"></div><aside class="side" id="side" aria-label="导航"></aside><div class="stage" id="stage"></div>`;
  app.parentNode.insertBefore(shell, app); shell.querySelector('#stage').appendChild(app);
  const open = on => document.body.classList.toggle('side-open', on);
  shell.querySelector('#menu').onclick = () => open(true); shell.querySelector('#scrim').onclick = () => open(false);
  shell.querySelector('#newchat').onclick = () => { open(false); D.startVoiceEntry(); };
  shell.querySelector('#side').addEventListener('click', e => { if (e.target.closest('a,button')) open(false); }); }

// 每次路由前调用：决定显示不显示框架，并刷新侧边栏（缓存里的历史会变）
export function mount(name) {
  const on = MY_ROUTES.has(name); document.body.classList.toggle('has-shell', on); document.body.classList.remove('side-open');
  let notice = document.getElementById('demo-notice');
  if (!notice) { notice = document.createElement('p'); notice.id = 'demo-notice'; notice.className = 'tip'; document.getElementById('stage').prepend(notice); }
  notice.textContent = D.getProfile()?.demoNotice || ''; notice.hidden = !on || !notice.textContent;
  if (on) renderSide(name); }

export const dayLabel = t => { const d = new Date(t), n = new Date(), s = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(), diff = Math.round((s(n) - s(d)) / 864e5);
  return diff <= 0 ? '今天' : diff === 1 ? '昨天' : diff < 7 ? '本周' : '更早'; };
export const when = t => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const storyOf = (c, iid) => (c?.stories || []).find(s => s.interview_id === iid);

function renderSide(name) {
  const { esc, getProfile, getCache, callNameOf } = D, p = getProfile(), c = getCache();
  const done = (c?.interviews || []).filter(i => i.finished).slice(0, 6), me = p?.demoInterviewer?.name || (p ? callNameOf(p) : '我');
  const nav = [['me', '首页', '#/me', 'chat'], ['library', '我的故事', '#/library', 'book'], ['archive', '记忆档案', '#/archive', 'vault']];
  document.getElementById('side').innerHTML = `<div class="brand">${brandMark()}<span class="logo-s">记忆银行</span></div>
  <a class="new" href="#/interview">${ic('mic', 20)}开始说</a>
  <nav>${nav.map(([k, t, h, i]) => `<a href="${h}" class="${name === k || (k === 'library' && name === 'story') ? 'on' : ''}">${ic(i)}${t}</a>`).join('')}</nav>
  ${done.length ? `<p class="grp">最近</p><div class="recent">${done.map(i => { const s = storyOf(c, i.id); return `<a href="${s ? '#/story/' + s.id : '#/library'}" title="${esc(s?.title || i.stage || '')}">${esc(s?.title || i.stage || '一次聊天')}<small>${when(i.created)}</small></a>`; }).join('')}</div>` : ''}
  <div class="foot"><a href="#/account" class="who ${name === 'account' ? 'on' : ''}"><span class="seal">${esc(me.slice(0, 1))}</span><span>${esc(me)}<small>我的资料</small></span></a>
    <a href="#/settings" class="gear ${name === 'settings' ? 'on' : ''}" aria-label="设置">${ic('gear')}</a></div>`; }

// —— 页面 ——
// 首页像一封信：问候、一个红色动作、上次聊到哪、最近的故事。没有气泡、头像、数据面板。
// 老照片、老歌、家乡菜等话头收进折叠的“手边有东西想聊？”，默认不占位。
export function chatHome() {
  const { esc, getProfile, getCache, callNameOf, go, FW, setReq } = D, p = getProfile(), c = getCache(), s0 = c?.stories?.[0], n = (c?.interviews || []).filter(i => i.finished).length;
  const tp = FW.dimensions.trigger.values, last = c?.archive?.lastTopic;
  const d = new Date(), today = d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  D.$app.innerHTML = `<main class="page home"><p class="lab">${today}</p>
  <h1 class="hello">${p?.demoInterviewer ? `${esc(p.demoInterviewer.name)}，<br>采访资料在这里` : p ? `${esc(callNameOf(p))}，<br>今天想聊聊吗？` : '把一生的声音，<br>存起来'}</h1>
  <p class="sub">${p?.demoInterviewer ? `${esc(p.name)}的 ${n} 次访谈，可以随时回看。` : p ? '您说，我听着。' : '先留几句资料，小忆才知道怎么称呼您。'}</p>
  <div class="acts"><button class="big" id="start">${p ? ic('mic', 24) + '开始语音访谈' : '写下我的资料'}</button>
  ${p && last ? `<button class="ghost" id="cont">接着上次聊</button>` : ''}</div>
  ${p && last ? `<section class="blk"><p class="lab">上次聊到</p><p class="q">${esc(last)}</p></section>` : ''}
  ${p && s0 ? `<section class="blk"><p class="lab">最近的故事 · ${new Date(s0.created).toLocaleDateString('zh-CN')}</p><h3>${esc(s0.title)}</h3><p class="ex">${esc(String(s0.body || '').replace(/\s+/g, '').slice(0, 44))}……</p><a class="more" href="#/story/${s0.id}">读全文 ›</a></section>` : ''}
  ${p ? `<details class="help"><summary>手边有老照片、老歌想聊？</summary><div class="opts">${Object.entries(tp).map(([k, l]) => `<button data-t="${k}">想聊${esc(l)}</button>`).join('')}</div></details>` : ''}
  ${p && n ? `<p class="count">已经聊过 ${n} 次</p>` : ''}</main>`;
  const start = () => p ? D.startVoiceEntry() : go('#/profile'); document.getElementById('start').onclick = start;
  document.getElementById('cont')?.addEventListener('click', start);
  D.$app.querySelectorAll('.help [data-t]').forEach(b => b.onclick = () => { setReq({ trigger: b.dataset.t }); D.startVoiceEntry(); }); }

export function account() {
  const { esc, getProfile, callNameOf } = D, p = getProfile();
  D.$app.innerHTML = `<main class="page account"><h2>我的资料</h2>
  ${p ? `<div class="acard"><span class="seal lg">${esc(callNameOf(p).slice(0, 1))}</span><div><b>${esc(callNameOf(p))}</b><br><small>${[p.birthYear && p.birthYear + ' 年生', p.hometown].filter(Boolean).map(esc).join(' · ') || '资料还不完整'}</small>${p.people ? `<br><small>身边的人：${esc(alive(p.people))}</small>` : ''}</div></div>
  <button class="ghost" onclick="location.hash='#/profile'">修改我的资料</button>` : '<p class="tip">还没有资料。</p><button class="big" onclick="location.hash=\'#/profile\'">写下我的资料</button>'}
  <h3>切换演示资料</h3><div class="seg" id="demos"><button data-id="demo-wang" class="${D.elderId === 'demo-wang' ? 'on' : ''}">王女士</button><button data-id="demo-fugui" class="${D.elderId === 'demo-fugui' ? 'on' : ''}">徐先生</button><button data-id="demo-hanchun" class="${D.elderId === 'demo-hanchun' ? 'on' : ''}">范成采访 · 寒春</button></div><p class="tip">演示数据，内容为虚构。徐先生原型取自《活着》；范成采访寒春的问答依据公开生平创作，并非真实访谈。</p></main>`;
  document.querySelectorAll('#demos button').forEach(b => b.onclick = async () => { const id = b.dataset.id; try { const e = await (await fetch('/api/elders/' + id)).json(); localStorage.setItem('mb_elder', id); localStorage.setItem('mb_profile', JSON.stringify(e.profile)); } catch { return; } location.hash = '#/me'; location.reload(); }); }

export function settings() {
  const { esc, elderId } = D;
  const seg = (name, opts, cur) => `<div class="seg" data-k="${name}">${opts.map(([v, t]) => `<button data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${esc(t)}</button>`).join('')}</div>`;
  D.$app.innerHTML = `<main class="page settings"><h2>设置</h2>
  <section><h3>字号</h3>${seg('fs', Object.entries(FS), get('mb_fs', 1))}</section>
  <section><h3>我的资料</h3><button class="ghost" onclick="location.hash='#/profile'">称呼、出生年份、家乡、身边的人</button></section>
  <section><h3>数据</h3>${elderId ? `<a class="ghost btn" href="/api/elders/${esc(elderId)}/export.zip" download>${ic('down', 18)}打包下载（原声、访谈稿、故事、档案）</a>` : '<p class="tip">写下资料并聊过之后可以下载。</p>'}</section></main>`;
  D.$app.querySelectorAll('.seg').forEach(s => s.querySelectorAll('button').forEach(b => b.onclick = () => { put('mb_fs', +b.dataset.v); applyPrefs(); settings(); })); }
