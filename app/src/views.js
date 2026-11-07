// 记忆册视图：纯模板函数（只拼 HTML，不碰 DOM、不调接口），便于单测「老人看不到内部标签/演示/emoji」
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const svg = (d, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
// 线稿图标（不用 emoji）
export const ICON = {
  radio: svg('<rect x="7" y="16" width="34" height="22" rx="3"/><circle cx="17" cy="27" r="5"/><path d="M27 23h9M27 28h9M27 33h6M14 16l18-8"/>'),
  album: svg('<rect x="9" y="7" width="30" height="34" rx="2"/><path d="M15 7v34M21 16h12M21 22h9"/>'),
  book: svg('<path d="M6 12c6-2 12-2 18 2 6-4 12-4 18-2v26c-6-2-12-2-18 2-6-4-12-4-18-2z"/><path d="M24 14v26"/>'),
  map: svg('<path d="M6 12l11-4 14 4 11-4v28l-11 4-14-4-11 4z"/><path d="M17 8v28M31 12v28"/>'),
  box: svg('<path d="M6 16l18-8 18 8v18l-18 8-18-8z"/><path d="M6 16l18 8 18-8M24 24v18"/>'),
  ear: svg('<path d="M14 34c0 4 3 6 6 6s5-3 6-6c1-4 8-6 8-15a10 10 0 0 0-20 0"/><path d="M19 20a5 5 0 0 1 10 0"/>'),
  play: svg('<path d="M10 18h7l9-8v28l-9-8h-7z"/><path d="M32 18c2 2 2 10 0 12M36 14c4 4 4 16 0 20"/>'),
  photo: svg('<rect x="6" y="10" width="36" height="28" rx="2"/><circle cx="17" cy="20" r="4"/><path d="M6 34l11-9 9 7 6-5 10 8"/>'),
  song: svg('<path d="M18 36V12l20-4v24"/><circle cx="13" cy="36" r="5"/><circle cx="33" cy="32" r="5"/>'),
  food: svg('<path d="M6 24h36c0 9-8 14-18 14S6 33 6 24z"/><path d="M18 18c0-3 3-3 3-6M26 18c0-3 3-3 3-6"/>'),
  object: svg('<circle cx="24" cy="26" r="13"/><path d="M24 19v7l5 3M20 9h8"/>'),
  festival: svg('<path d="M24 6v4M16 12h16l3 6v12l-3 6H16l-3-6V18z"/><path d="M24 36v6"/>'),
};
const NUM = ['一', '二', '三'];
const page = (cls, inner) => `<main class="page ${cls}">${inner}</main>`;
const back = (h = '#/family', t = '返回') => `<a class="back" href="${h}">← ${t}</a>`;
const waiting = (t, sub = '') => `<div class="waiting" role="status"><span class="ink-dots"><i></i><i></i><i></i></span><p>${t}</p>${sub ? `<small>${sub}</small>` : ''}</div>`;
export const loading = (t, sub) => page('center', waiting(t, sub));

// 老人首屏：一个大按钮 + 角落入口
export const elderHome = ({ name }) => page('elder-home', `<a class="corner" id="more" href="#/family">${ICON.album}翻翻我的故事</a>
  <p class="greet">${esc(name)}，<br>今天想聊聊吗？</p>
  <button class="start" id="start"><span class="start-ring">${ICON.radio}<b>开始聊天</b></span></button>
  <p class="motto">爱比遗忘更强大</p>`);

// 家人视角首页（记忆册扉页）
export const familyHome = ({ name, n, latest, cov, total, elderId }) => page('cover', `<p class="poem">趁我还记得，<br>请听我慢慢说。</p>
  <h1 class="logo">记忆银行</h1><p class="sub">陪伴阿尔茨海默病患者</p>
  ${name ? `<p class="hello">${esc(name)}，今天想聊聊吗？${n ? `<small>已经聊过 ${n} 次</small>` : ''}</p><button class="primary" id="start">开始今天的聊天</button>` : `<button class="primary" id="start">开始建档</button>`}
  ${latest ? `<a class="print latest" href="#/story/${esc(latest.id)}"><small>最近的一篇</small><b>${esc(latest.title)}</b><span>${esc(latest.date)}</span></a>` : ''}
  <nav class="shelf">
    <a href="#/library">${ICON.book}<span>记忆库</span></a>
    ${name ? `<a href="#/archive">${ICON.album}<span>记忆档案</span></a><a href="#/map">${ICON.map}<span>人生地图<small>已聊 ${cov}/${total}</small></span></a>` : ''}
    ${name && elderId ? `<a id="zip" href="/api/elders/${esc(elderId)}/export.zip" download>${ICON.box}<span>打包下载<small>原声、访谈稿、故事、档案</small></span></a>` : ''}
  </nav>
  ${name ? `<p class="foot-links"><a href="#/profile">修改档案</a><a href="#/">回到老人首页</a></p>` : ''}`);

// 家人建档（演示档案按钮保持原有行为，只去掉 emoji）
export const profileForm = (p) => page('form', `<h2>老人档案</h2><p class="tip">由家人填写，帮小忆更亲切地提问</p>
  <form id="f"><label>姓名<input name="name" required value="${esc(p.name)}" placeholder="如：王秀兰"></label>
  <label>性别<select name="gender"><option value="">请选择</option><option value="女"${p.gender === '女' ? ' selected' : ''}>女</option><option value="男"${p.gender === '男' ? ' selected' : ''}>男</option></select></label>
  <label>希望怎么称呼<input name="callName" value="${esc(p.callName)}" placeholder="按姓氏和性别自动生成，如：王女士"><small class="tip">默认“姓＋先生/女士”，可以手动改</small></label>
  <input type="hidden" name="callNameManual" value="${p.callNameManual ? '1' : ''}">
  <label>出生年份<input name="birthYear" inputmode="numeric" value="${esc(p.birthYear)}" placeholder="如：1948"></label>
  <label>家乡<input name="hometown" value="${esc(p.hometown)}" placeholder="如：江苏扬州"></label>
  <label>重要的人（可选）<input name="people" value="${esc(p.people)}" placeholder="如：老伴李建国、女儿小梅"></label>
  <button class="primary" type="submit">保存，下一步</button></form>
  <button class="quiet" id="demo">填入演示档案（王女士）</button>${back()}`);

// 家人规划页：只说当前话题，不展示选题理由/note
export const planPage = ({ name, topic, first, ask, lastTopic, triggers, req, reqLabel }) => page('plan', `<h2>今天聊什么</h2><p class="tip">小忆替${esc(name)}挑好了，家人也可以换一个</p>
  <div class="note"><p class="lbl">今天话题</p><p class="topic">${esc(topic)}</p>${first ? `<p class="lbl">先聊</p><p>${esc(first)}</p>` : ''}
  <p class="lbl">小忆会先问</p><p class="q">“${esc(ask)}”</p></div>
  <button class="primary" id="go">就聊这个</button>
  <h3>带了老物件？</h3><p class="tip">老照片、老歌、家乡菜……点一下，小忆用它开场</p>
  <div class="trigs">${triggers.map(([k, l]) => `<button class="trig${req?.trigger === k ? ' on' : ''}" data-t="${esc(k)}">${ICON[k] || ''}<span>${esc(l)}</span></button>`).join('')}</div>
  <a class="quiet" href="#/map">${ICON.map}从人生地图里挑一个</a>
  ${req ? `<p class="hint">已指定：${esc(reqLabel)} <button class="link" id="clr">改回自动</button></p>` : ''}
  ${lastTopic ? `<p class="hint">上次聊到：${esc(lastTopic)}</p>` : ''}${back()}`);

export const lifeMap = ({ name, eras, covs }) => page('map', `<h2>${esc(name)}的人生地图</h2>
  <p class="tip">深色是聊完的，浅色是聊过一些，空白的还没聊。点一个，下次就聊它</p>
  <div class="legend"><span class="node done">聊完</span><span class="node partial">聊过一些</span><span class="node not_started">还没聊</span></div>
  ${eras.map(e => `<section><h3>${esc(e.label)}</h3><div class="nodes">${e.nodes.map(n => `<button class="node ${n.status}${n.sensitive ? ' sens' : ''}" data-n="${esc(n.id)}"><b>${esc(n.title)}</b><span class="d">${[1, 2, 3, 4].map(k => `<i class="${n.depth >= k ? 'on' : ''}"></i>`).join('')}</span>${n.sensitive ? '<small>先放一放</small>' : ''}</button>`).join('')}</div></section>`).join('')}
  ${covs.map(c => `<section><h3>${esc(c.label)}</h3>${c.rows.map(x => `<div class="bar"><span>${esc(x.label)}</span><div class="track"><div class="fill" style="width:${x.total ? 100 * x.chatted / x.total : 0}%"></div></div><small>${x.chatted}/${x.total}</small></div>`).join('')}</section>`).join('')}
  ${back()}`);

// 老人选话题：三张大卡 + 小忆一句口播；换几个/随便聊、直接说都放次级
export const choosePage = ({ heading, say, cards, after }) => page('talk choose', `<p class="kicker">${esc(heading)}</p>
  <div class="letter"><span class="from">小忆</span><p>${esc(say)}</p><p class="speaking hidden" id="speakInd">小忆在说话…</p><button class="link" id="replay">再听一遍</button></div>
  <div class="prints">${cards.map((c, i) => `<button class="print tcard" data-i="${i}"><span class="num">${NUM[i]}</span><b>${esc(c.text)}</b></button>`).join('')}</div>
  ${after ? `<div class="pair"><button class="quiet" data-a="stay">继续聊这个</button><button class="quiet" data-a="end">今天先到这</button></div>` : ''}
  <details class="more"><summary>换几个，或随便聊</summary><div class="pair"><button class="quiet" data-a="more">换几个</button><button class="quiet" data-a="free">您想聊什么都行</button></div></details>
  <button class="say-instead" id="mic">${ICON.ear}<span id="micl">也可以直接说</span></button>
  <p class="live" id="live" data-after="点卡片，或者说出来都行">小忆说完，您点卡片或直接说</p>
  <div class="hidden" id="thinking">${waiting('<span id="thinkt">小忆在听您想聊哪个……</span>')}</div>
  <textarea id="manual" placeholder="（家人可在此打字代说）" class="hidden"></textarea>`);

// 老人访谈中：一句人话做抬头，小忆的话写在信纸上，主按钮纯文字大圆钮
export const talkPage = ({ heading, said, say }) => page('talk', `<p class="kicker">${esc(heading)}</p>
  ${said ? `<p class="said"><span>您刚才说</span>“${esc(said)}”</p>` : ''}
  <div class="letter"><span class="from">小忆</span><p>${esc(say)}</p><p class="speaking hidden" id="speakInd">小忆在说话…</p><button class="link" id="replay">再听一遍</button></div>
  <button class="talk-btn" id="mic"><span id="micl">点一下，开始说</span></button>
  <p class="live" id="live" data-after="该您说了，点一下">慢慢说，不着急，说错了也没关系</p>
  <div class="hidden" id="thinking">${waiting('<span id="thinkt">小忆在认真听……</span>', '不着急，您喝口水歇一歇')}</div>
  <textarea id="manual" placeholder="（家人可在此补记文字）" class="hidden"></textarea>
  <button class="quiet end" id="end">今天先聊到这</button>`);

// 故事页：相册一页。访谈稿不展示句子 id / 层级 / 情绪等内部标注
export const storyPage = ({ id, date, teller, stage, title, paras, quotes, people, timePlace, fullAudio, turns, editable, edits }) => page('story', `<p class="stamp">${esc(date)} · ${esc(teller)} 讲述${stage ? ' · ' + esc(stage) : ''}</p>
  <h1 class="title">${esc(title)}</h1>
  <article class="leaf">${paras.map((x, k) => `<div class="para"><p>${esc(x.text)}</p>${x.refs.length ? `<button class="play" data-k="${k}" aria-label="听原声">${ICON.play}原声</button>` : ''}</div>`).join('')}</article>
  ${quotes ? `<blockquote>${esc(quotes)}</blockquote>` : ''}
  ${people || timePlace ? `<dl class="facts">${people ? `<dt>关键人物</dt><dd>${esc(people)}</dd>` : ''}${timePlace ? `<dt>时间地点</dt><dd>${esc(timePlace)}</dd>` : ''}</dl>` : ''}
  ${fullAudio ? `<section class="tape"><h3>整场录音</h3><audio controls preload="none" src="${esc(fullAudio)}"></audio></section>` : ''}
  <details class="transcript" id="tx"><summary>完整访谈稿（${turns.length} 段，原话不改动）</summary>
  ${turns.map(t => `<div class="turn" id="${esc(t.id)}"><p class="cq">小忆：${esc(t.question)}</p><p class="ca">“${esc(t.clean || '')}”</p>${t.raw && t.raw !== t.clean ? `<p class="raw">原始转写：${esc(t.raw)}</p>` : ''}${t.audio ? `<audio controls preload="none" src="${esc(t.audio)}"></audio>` : ''}</div>`).join('')}</details>
  ${editable ? `<button class="quiet" id="edit">修改故事（原话保留，修改留痕）</button>` : ''}
  ${edits?.length ? `<details class="transcript"><summary>修改记录（${edits.length}）</summary>${edits.map(x => `<p class="meta">${esc(x.at)} · ${esc(x.by)} 改了${x.field === 'title' ? '标题' : '正文'}<br>原来：${esc(String(x.before).slice(0, 40))}…</p>`).join('')}</details>` : ''}
  <button class="primary" id="share">分享给家人</button><a class="quiet" href="#/library">回到记忆库</a>`);

export const libraryPage = ({ list }) => page('library', `<h2>记忆库</h2><p class="tip">每一段，都是留给孩子们的宝藏</p>
  ${list.length ? `<div class="album">${list.map((s, i) => `<a class="print${i % 2 ? ' tilt-r' : ' tilt-l'}" href="#/story/${esc(s.id)}"><b>${esc(s.title)}</b><span>${esc(s.meta)}</span></a>`).join('')}</div>` : '<p class="empty">还没有故事。<br>去和老人聊一聊吧。</p>'}
  <button class="primary" id="again">再聊一次</button>${back('#/family', '首页')}`);

const TY = { person: '人', place: '地', thing: '物' };
export const archivePage = ({ name, pending, lastTopic, entities, a, ivs }) => {
  const sec = (t, arr, f) => `<section><h3>${t}</h3>${arr?.length ? arr.map(f).join('') : '<p class="tip">还没有记录</p>'}</section>`;
  return page('archive', `<h2>${esc(name)}的记忆档案</h2><p class="tip">每次聊完自动整理，小忆下次会接着聊</p>
  ${pending ? waiting('小忆正在整理这次的记忆……', '整理好会自动刷新') : ''}
  ${lastTopic ? `<p class="hint">上次聊到：${esc(lastTopic)}</p>` : ''}
  ${sec('人 · 地 · 物', entities, x => `<div class="slip"><span class="ty">${TY[x.type] || esc(x.type)}</span><b>${esc(x.name)}</b>${x.relation ? ` · ${esc(x.relation)}` : ''}${x.deceased ? ' · 已故' : ''}${x.from ? `<small>来自：${esc(x.from)}</small>` : ''}${x.notes ? `<small>${esc(x.notes)}</small>` : ''}</div>`)}
  ${sec('人物', a.people, x => `<div class="slip"><b>${esc(x.name)}</b> · ${esc(x.relation)}<small>${esc(x.note)}</small></div>`)}
  ${sec('地点', a.places, x => `<div class="slip"><b>${esc(x.name)}</b><small>${esc(x.note)}</small></div>`)}
  ${sec('事件', a.events, x => `<div class="slip"><b>${esc(x.title)}</b> <small class="in">${esc(x.when)}</small><small>${esc(x.detail)}</small></div>`)}
  ${sec('时间线', a.timeline, x => `<div class="tl"><b>${esc(x.when)}</b><span>${esc(x.what)}</span></div>`)}
  ${a.conflicts?.filter(Boolean).length ? sec('前后说法（并列保留）', a.conflicts.filter(Boolean), x => `<p class="tip">${esc(x)}</p>`) : ''}
  ${sec('访谈记录', ivs, i => `<details class="slip"><summary>${esc(i.when)} · ${esc(i.stage)} · ${i.turns.length} 句</summary>${i.turns.map(t => `<p class="cq">小忆：${esc(t.q)}</p>${t.audio ? `<audio controls preload="none" src="/api/audio/${esc(t.audio)}"></audio>` : ''}<p>整理：${esc(t.clean)}</p><p class="tip">原始：${esc(t.raw)}</p>`).join('')}</details>`)}
  ${back()}`);
};
