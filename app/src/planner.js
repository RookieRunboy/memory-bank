// 访谈问题库的运行逻辑（前后端共用，纯函数）。数据：src/framework.json；规则：docs/interview-framework.md
// FW 由调用方传入：前端 import JSON，后端 fs 读取。
import { fill } from './questions.js';

export const LAYER_LABEL = { 1: '事实', 2: '场景细节', 3: '感受', 4: '意义与寄语' };
export const emptyState = id => ({ nodeId: id, enough: false, depth: 0, turns: 0, notes: [], sensitive: false, shortRun: 0, lastSessionId: null, updatedAt: 0 });
// 只记老人讲到哪：depth 0 = 没讲过；enough = 这个话题聊够了。不再有“未聊/聊完”的完成度（旧数据里的 status:'done' 按聊够处理）
export const st = (states, id) => { const s = states?.[id]; return s ? { ...s, enough: s.enough ?? s.status === 'done' } : emptyState(id); };
const told = s => s.depth > 0;
export const nodeById = (FW, id) => FW.nodes.find(n => n.id === id);
export const nodeTitle = (FW, id, p) => { const n = nodeById(FW, id); return n ? fill(n.title, p) : ''; };
const hasSpouse = p => /老伴|爱人|丈夫|妻子|老公|老婆|对象/.test(p?.people || '');
const hasChildren = p => /女儿|儿子|孩子|闺女|孙|子女/.test(p?.people || '');

// 每一步都先排除：敏感、needs_calm、缺前提（家人指定时不排除敏感）
function eligible(FW, ctx, n, { allowSensitive = false } = {}) {
  const s = st(ctx.states, n.id);
  if (ctx.exclude?.includes(n.id)) return false;
  if (!allowSensitive && s.sensitive) return false;
  if (!allowSensitive && (n.needs_calm || FW.planning.needs_calm.includes(n.id))) return false;
  if (n.tags.relation === 'spouse' && !hasSpouse(ctx.profile)) return false;
  if (n.tags.relation === 'children' && !hasChildren(ctx.profile)) return false;
  return true;
}
const fresh = (ctx, id) => !ctx.assumeDone?.includes(id) && !told(st(ctx.states, id));
const enough = (ctx, id) => ctx.assumeDone?.includes(id) || st(ctx.states, id).enough;
// 避免连续同维度：relation 和 domain 都不同 > 至少一个不同 > 同维度；同档按 nodes 顺序
function diverse(cands, prev) {
  if (!prev || cands.length < 2) return cands[0];
  const score = n => (n.tags.relation !== prev.relation ? 1 : 0) + (n.tags.domain !== prev.domain ? 1 : 0);
  return [...cands].sort((a, b) => score(b) - score(a))[0];
}
function matchEntity(n, e) {
  const names = [e.name, ...(e.aliases || [])].filter(Boolean), hint = n.entity_hints.some(h => names.some(x => x.includes(h) || h.includes(x)));
  if (e.type === 'person') return e.relation ? n.tags.relation === e.relation : hint; // 已知关系就只按关系跟（避免别名“李先生”误配“先生=老师”）
  if (e.type === 'place') return n.tags.domain === 'places' || hint;
  return (e.trigger && n.tags.trigger.includes(e.trigger)) || hint;
}
// 选题算法：返回 { nodeId, reason, startDepth, entity?, trigger? }
export function selectNode(FW, ctx) {
  const prev = ctx.prev, N = FW.nodes, req = ctx.request || {};
  // 1 家人指定
  if (req.nodeId && nodeById(FW, req.nodeId) && !ctx.exclude?.includes(req.nodeId)) {
    const s = st(ctx.states, req.nodeId); return { nodeId: req.nodeId, reason: 'family', startDepth: Math.min(4, s.depth + 1), trigger: req.trigger || null }; }
  if (req.trigger) {
    const c = N.filter(n => n.tags.trigger.includes(req.trigger) && !enough(ctx, n.id) && eligible(FW, ctx, n, { allowSensitive: true }));
    const n = diverse(c, prev); if (n) return { nodeId: n.id, reason: 'family_trigger', trigger: req.trigger, startDepth: Math.min(4, st(ctx.states, n.id).depth + 1) };
  }
  // 2 顺藤摸瓜
  const TY = { person: 0, thing: 1, place: 2 }; // 顺藤摸瓜先跟人，再跟物、地
  const recentEnts = (ctx.entities || []).filter(e => ctx.lastSessionId && e.lastSessionId === ctx.lastSessionId).sort((a, b) => (TY[a.type] ?? 3) - (TY[b.type] ?? 3));
  for (const e of recentEnts) {
    const c0 = N.filter(n => fresh(ctx, n.id) && eligible(FW, ctx, n) && matchEntity(n, e));
    const c = c0; const n = diverse(c, prev); if (n) return { nodeId: n.id, reason: 'follow_entity', entity: e.id, startDepth: 1 };
  }
  // 3 加深
  const part = N.filter(n => told(st(ctx.states, n.id)) && !enough(ctx, n.id) && st(ctx.states, n.id).depth < 4 && eligible(FW, ctx, n))
    .sort((a, b) => st(ctx.states, b.id).updatedAt - st(ctx.states, a.id).updatedAt);
  if (part.length) { const top = part.filter(n => st(ctx.states, n.id).updatedAt === st(ctx.states, part[0].id).updatedAt); const n = diverse(top, prev);
    return { nodeId: n.id, reason: 'deepen', startDepth: st(ctx.states, n.id).depth + 1 }; }
  // 4 没有线索可跟：不去补哪个年龄段、哪类关系还空着，只用轻松的话题（吃食、老歌、节日）起个头
  const light = FW.planning.fallback_safe_nodes.map(id => nodeById(FW, id)).filter(n => n && fresh(ctx, n.id) && eligible(FW, ctx, n));
  const l = diverse(light, prev); if (l) return { nodeId: l.id, reason: 'light', startDepth: 1 };
  // 轻松话题也聊过了：回到 notes 最多的节点再聊一层
  const best = N.filter(n => eligible(FW, ctx, n)).sort((a, b) => st(ctx.states, b.id).notes.length - st(ctx.states, a.id).notes.length)[0];
  return best ? { nodeId: best.id, reason: 'revisit', startDepth: 4 } : { nodeId: FW.planning.fallback_safe_nodes[0], reason: 'safe', startDepth: 1 };
}

// 会话规划：默认 2 个节点（第 1 个走深，聊够了再进第 2 个）+ 下次预告
export function planSession(FW, { profile, states = {}, entities = [], lastSessionId = null, prevNodeId = null, request = null, sessionId = null }) {
  const tagsOf = id => { const n = nodeById(FW, id); return n && { relation: n.tags.relation, domain: n.tags.domain }; };
  const base = { profile, states, entities, lastSessionId };
  const a = selectNode(FW, { ...base, request, prev: tagsOf(prevNodeId) });
  const b = selectNode(FW, { ...base, exclude: [a.nodeId], assumeDone: [a.nodeId], prev: tagsOf(a.nodeId) }); // 同一次访谈的两个节点也错开维度
  const nodes = [a, b].map(x => ({ ...x, note: reasonText(FW, x, entities, profile) }));
  return { sessionId, requestedBy: request?.nodeId || request?.trigger ? 'family' : 'auto', request, previousNode: prevNodeId ? { nodeId: prevNodeId, tags: tagsOf(prevNodeId) } : null,
    nodes, currentNodeIndex: 0, ask: { nodeId: a.nodeId, depth: a.startDepth, trigger: a.trigger || null }, createdAt: Date.now() };
}
const DIMV = (FW, dim, v) => FW.dimensions[dim]?.values[v] || v;
export function reasonText(FW, x, entities = [], p) {
  const e = entities.find(e => e.id === x.entity);
  return { family: '家人指定', family_trigger: `家人带来了${DIMV(FW, 'trigger', x.trigger)}`, follow_entity: `顺着上次提到的「${e?.name || ''}」`,
    deepen: `上次聊到第${x.startDepth - 1}层，这次从第${x.startDepth}层（${LAYER_LABEL[x.startDepth]}）接着聊`,
    revisit: '回到讲得最开心的话题再聊一层', safe: '轻松安全的话题', light: '轻松话题' }[x.reason] || '';
}
// 当前问题：节点某一层的问题，或触发物开场
export function questionFor(FW, nodeId, depth, p, trigger) {
  const n = nodeById(FW, nodeId); if (!n) return '';
  if (trigger && depth <= 1 && n.trigger_openers?.[trigger]) return fill(n.trigger_openers[trigger], p);
  const L = n.layers.find(l => l.depth === Math.max(1, Math.min(4, depth))) || n.layers[0];
  return fill(L.question, p);
}
// 每轮只取当前话题的参考问题，来源目录保留在问题库中供核查。
export function questionGuide(FW, nodeId, profile) {
  const node = nodeById(FW, nodeId);
  if (!node) return null;
  return {
    entryCondition: node.entry_condition || '',
    questions: node.layers.map(layer => fillAll(layer.question, profile)),
    gentleQuestion: fillAll(node.gentle_question || node.layers[0].question, profile),
    precautions: (node.sensitive || []).map(item => item.note),
  };
}
// 新变量 {今天话题}{当前话题}{当前层次}{当前话题入场问题}{顺藤线索}{已聊要点}{上一个话题}
export function planVars(FW, plan, { profile: p = {}, states = {}, entities = [], recentNote = '' } = {}) {
  if (!plan) return {};
  const ask = plan.ask || {}, titles = plan.nodes.map(x => nodeTitle(FW, x.nodeId, p));
  const ent = entities.find(e => plan.nodes.some(x => x.entity === e.id)) || entities.filter(e => e.lastSessionId && e.lastSessionId === plan.lastSessionId)[0];
  const notes = FW.nodes.map(n => st(states, n.id)).filter(s => s.notes.length).sort((a, b) => b.updatedAt - a.updatedAt).flatMap(s => s.notes).slice(0, 4);
  if (!notes.length && recentNote) notes.push(recentNote);
  const prevS = plan.previousNode && st(states, plan.previousNode.nodeId);
  return {
    今天话题: nodeTitle(FW, ask.nodeId, p) || titles[plan.currentNodeIndex || 0] || titles[0] || '',
    当前话题: nodeTitle(FW, ask.nodeId, p),
    当前层次: ask.depth ? `第${ask.depth}层，${LAYER_LABEL[ask.depth]}` : '',
    当前话题入场问题: questionFor(FW, ask.nodeId, ask.depth, p, ask.trigger),
    顺藤线索: ent ? `${ent.name}${ent.notes?.[0] ? '，' + ent.notes[0] : ''}` : '',
    已聊要点: notes.join('；'),
    上一个话题: prevS?.notes?.at(-1) || nodeTitle(FW, plan.previousNode?.nodeId, p),
  };
}
// 变量替换 + 校验：发给模型和朗读的文本绝不能含未替换的 {变量}
const VAR_RE = /\{[\u4e00-\u9fa5A-Za-z_]{1,12}\}/g;
export const fillAll = (t, p = {}, v = {}) => fill(String(t).replace(VAR_RE, m => { const k = m.slice(1, -1); return k in v ? (v[k] ?? '') : m; }), p);
export function leftoverVars(t) { return String(t).match(VAR_RE) || []; }
export function assertNoVars(t, where = '') { const l = leftoverVars(t); if (l.length) throw new Error(`未替换的变量${where ? '（' + where + '）' : ''}：${l.join(' ')}`); return t; }
// 朗读前兜底清理：去掉残留变量并清理由此产生的空标点
export const speakable = t => String(t).replace(VAR_RE, '').replace(/讲讲[，。]/g, '讲讲以前的事。').replace(/聊聊[，,]?好吗/g, '接着聊，好吗').replace(/([，。])\1+/g, '$1');

// 兜底话术（文案取自 docs/interview.md【开场】【结束】）
export function openingText(FW, plan, ctx, isReturn) {
  const v = planVars(FW, plan, ctx);
  return assertNoVars(greetText(FW, plan, ctx, isReturn) + v.当前话题入场问题, '开场');
}
// 约定的固定开场：称呼可变，不自动朗读候选菜单。
export function greetText(FW, plan, ctx, isReturn) {
  const head = '{称呼}，这次打算往记忆银行里边存点什么？';
  return assertNoVars(fillAll(head, ctx.profile), '问候');
}
export const OPENING_NUDGE = '一件小事，或一个刚想起的人，都行。';
export function closingText(FW, plan, ctx) {
  return '好，今天先聊到这儿，您歇一歇。';
}

// 节点状态更新（只前进不后退）。r: { nodeId, depth, note, emotion, short }
export function applyAnswer(FW, states, r, sessionId) {
  if (!nodeById(FW, r.nodeId)) return states;
  const s = { ...st(states, r.nodeId) }; s.notes = [...s.notes];
  s.turns++; s.depth = Math.max(s.depth, Math.max(0, Math.min(4, r.short ? 0 : (r.depth | 0))));
  if (r.note) s.notes.push(r.note);
  s.shortRun = r.short ? (s.shortRun || 0) + 1 : 0;
  const upset = /难过|困惑/.test(r.emotion || '') && r.leave === 'upset', tired = /累|烦躁/.test(r.emotion || '') || r.leave === 'tired';
  let leave = null;
  if (s.depth >= 4) leave = 'deep'; else if (s.turns >= 8) leave = 'max_turns'; else if (upset) leave = 'upset'; else if (tired) leave = 'tired'; else if (s.shortRun >= 3) leave = 'short_replies';
  if (leave === 'deep' || leave === 'max_turns') s.enough = true;
  if ((leave === 'tired' || leave === 'short_replies') && s.depth >= 3) s.enough = true;
  if (leave === 'upset') s.sensitive = true;
  s.lastSessionId = sessionId; s.updatedAt = Date.now();
  return { states: { ...states, [r.nodeId]: s }, leave, state: s };
}
// 实体表合并：按名字/别名去重，记来源节点
export function mergeEntities(entities = [], found = [], nodeId, sessionId) {
  const out = entities.map(e => ({ ...e, sourceNodes: [...(e.sourceNodes || [])], notes: [...(e.notes || [])], aliases: [...(e.aliases || [])] }));
  for (const f of found) { if (!f?.name) continue;
    const names = [f.name, ...(f.aliases || [])];
    let e = out.find(e => [e.name, ...e.aliases].some(x => names.includes(x)));
    if (!e) { e = { id: `${{ person: 'p', place: 'pl', thing: 't' }[f.type] || 't'}-${f.name}`, type: ['person', 'place', 'thing'].includes(f.type) ? f.type : 'thing', name: f.name, aliases: [], relation: f.relation || null, deceased: !!f.deceased, trigger: f.trigger || null, sourceNodes: [], firstSessionId: sessionId, lastSessionId: sessionId, notes: [] }; out.push(e); }
    for (const a of f.aliases || []) if (a !== e.name && !e.aliases.includes(a)) e.aliases.push(a);
    if (f.relation && !e.relation) e.relation = f.relation; if (f.deceased) e.deceased = true; if (f.trigger && !e.trigger) e.trigger = f.trigger;
    if (nodeId && !e.sourceNodes.includes(nodeId)) e.sourceNodes.push(nodeId);
    if (f.note && !e.notes.includes(f.note)) e.notes.push(f.note);
    e.lastSessionId = sessionId;
  }
  return out;
}
// 无网/无模型兜底：规则判断归属节点、层次、实体
export function ruleAnalyze(FW, text, ask, profile = {}) {
  const t = text || '', short = t.replace(/[\s，。,.！!？?…、]/g, '').length < 8 || /不知道|忘了|想不起/.test(t);
  let nodeId = ask?.nodeId; // 跑题：命中别的节点更多 entity_hints 时归到那个节点
  const hit = n => n.entity_hints.filter(h => h.length > 1 && t.includes(h)).length;
  const cur = nodeById(FW, nodeId), best = [...FW.nodes].sort((a, b) => hit(b) - hit(a))[0];
  if (best && hit(best) > (cur ? hit(cur) : 0) && hit(best) >= 1) nodeId = best.id;
  const depth = nodeId === ask?.nodeId ? (ask?.depth || 1) : 1;
  const sad = /走了|去世|想他|想她|难过|哭/.test(t), tired = /累了|不想说|歇会/.test(t);
  const ents = [];
  for (const raw of (profile.people || '').split(/[、，,；;\s]+/).filter(Boolean)) {
    const name = raw.replace(/[（(].*?[)）]/g, '').replace(/^(老伴|爱人|丈夫|妻子|老公|老婆|女儿|儿子|孙子|孙女|闺女)/, '');
    const rel = /老伴|爱人|丈夫|妻子|老公|老婆/.test(raw) ? 'spouse' : /女儿|儿子|孙|闺女/.test(raw) ? 'children' : null;
    if (name && (t.includes(name) || (rel === 'spouse' && /他|老李|老伴/.test(t) && ask && nodeById(FW, ask.nodeId)?.tags.relation === 'spouse')))
      ents.push({ type: 'person', name, relation: rel, deceased: /已故|去世/.test(raw), note: '' });
  }
  for (const [w, type, trig] of [['瘦西湖', 'place', null], ['纺织厂', 'place', null], ['扬州', 'place', null], ['食堂', 'place', null], ['桂花糕', 'thing', 'food'], ['自行车', 'thing', 'object'], ['手表', 'thing', 'object'], ['照片', 'thing', 'photo']])
    if (t.includes(w)) ents.push({ type, name: w, trigger: trig, note: t.slice(0, 30) });
  return { nodeId, depth: short ? 0 : depth, short, note: short ? '' : t.replace(/\s+/g, '').slice(0, 30), emotion: sad ? '难过' : tired ? '累了' : short ? '卡壳' : '平静', entities: ents };
}
// 兜底下一问：当前节点下一层；聊够了进规划里的下一个节点；都完了收尾
export function nextAsk(FW, plan, states, leave) {
  const cur = plan.nodes[plan.currentNodeIndex], s = st(states, plan.ask.nodeId);
  if (!leave && plan.ask.depth < 4 && !(s.depth >= 4)) return { ...plan, ask: { nodeId: plan.ask.nodeId, depth: Math.max(plan.ask.depth, s.depth) + 1 } };
  const k = plan.currentNodeIndex + 1, nx = plan.nodes[k];
  if (leave === 'tired') return { ...plan, done: true };
  if (leave === 'upset') { const safe = FW.planning.fallback_safe_nodes.find(id => !st(states, id).enough && !plan.nodes.some(x => x.nodeId === id)); // 情绪不稳：转安全话题
    if (safe) return { ...plan, nodes: [...plan.nodes.slice(0, k), { nodeId: safe, reason: 'safe', startDepth: 1, note: '情绪波动，换个轻松话题' }], currentNodeIndex: k, ask: { nodeId: safe, depth: 1 } }; }
  if (!nx) return { ...plan, done: true };
  return { ...plan, currentNodeIndex: k, ask: { nodeId: nx.nodeId, depth: Math.max(nx.startDepth || 1, st(states, nx.nodeId).depth + 1) } };
}
// 离线兜底题目：规划第一个节点四层 + 第二个节点第一层，共 5 题
export function offlineQuestions(FW, p, request) {
  const plan = planSession(FW, { profile: p, request });
  const a = plan.nodes[0], b = plan.nodes[1];
  const qs = [1, 2, 3, 4].map(d => ({ nodeId: a.nodeId, depth: d, text: questionFor(FW, a.nodeId, d, p, d === 1 ? a.trigger : null) }));
  qs.push({ nodeId: b.nodeId, depth: 1, text: questionFor(FW, b.nodeId, 1, p) });
  // 选好话题后直接问这个话题，不再重复初始开场。
  return { plan, qs };
}

// ===== 老人自己选话题（2026-10-24）：3 个候选卡片 + 换几个 + 想聊什么都行 =====
export const cardText = (FW, id, p) => { const n = nodeById(FW, id); return n ? fill(n.card || n.title, p) : ''; };
const LIGHT = ['food', 'song', 'festival'];
// 候选：家人指定放第一；① 顺藤/加深 ② 轻松触发物优先（可多张）③ 覆盖补位权重降低；避开敏感/需平静/缺前提；维度错开；exclude 不再出
export function candidates(FW, { profile, states = {}, entities = [], lastSessionId = null, prevNodeId = null, request = null, exclude = [], count = 3 } = {}) {
  const out = [], base = { profile, states, entities, lastSessionId, prev: prevNodeId && nodeById(FW, prevNodeId) ? { relation: nodeById(FW, prevNodeId).tags.relation, domain: nodeById(FW, prevNodeId).tags.domain } : undefined };
  const ex = () => [...exclude, ...out.map(x => x.nodeId)];
  const tags = () => out.map(x => nodeById(FW, x.nodeId).tags);
  const ok = n => eligible(FW, { ...base, exclude: ex() }, n) && !st(states, n.id).enough;
  const div = list => [...list].sort((a, b) => sc(b) - sc(a))[0];
  const sc = n => tags().reduce((s, t) => s + (t.relation !== n.tags.relation) + (t.domain !== n.tags.domain), 0);
  const add = (x, kind) => { if (x && !ex().includes(x.nodeId) && nodeById(FW, x.nodeId)) out.push({ ...x, kind, text: cardText(FW, x.nodeId, profile), note: reasonText(FW, x, entities, profile) }); };
  const addLight = () => {
    const safe = FW.planning.fallback_safe_nodes.map(id => nodeById(FW, id));
    const lightPool = [...safe, ...FW.nodes.filter(n => !safe.includes(n))].filter(n => n.tags.trigger.some(t => LIGHT.includes(t)) && ok(n));
    const notStartedLight = lightPool.filter(n => !told(st(states, n.id)));
    const l = div(notStartedLight.length ? notStartedLight : lightPool);
    if (!l) return false;
    const tr = l.tags.trigger.find(t => LIGHT.includes(t));
    add({ nodeId: l.id, reason: 'light', trigger: null, light: tr, startDepth: Math.min(4, st(states, l.id).depth + 1) }, 'light');
    return true;
  };
  if (request?.nodeId || request?.trigger) { const f = selectNode(FW, { ...base, request, exclude: ex() }); if (['family', 'family_trigger'].includes(f.reason)) add(f, 'family'); }
  // ① 顺藤 / 加深
  const f1 = selectNode(FW, { ...base, exclude: ex() }); if (['follow_entity', 'deepen'].includes(f1.reason)) add(f1, 'follow');
  // ② 至少一张轻松触发物
  if (out.length < count) addLight();
  // ②b 无顺藤时再补一张轻松的
  if (out.length < count && !out.some(x => x.kind === 'follow')) addLight();
  // ③ 不够就继续补轻松话题（吃食、老歌、节日），不为了“补空白”去推老人没提过的人生阶段
  for (let i = 0; out.length < count && i < 10; i++) if (!addLight()) break;
  if (out.length < count && exclude.length) return [...out, ...candidates(FW, { profile, states, entities, lastSessionId, prevNodeId, exclude: out.map(x => x.nodeId), count: count - out.length })].slice(0, count);
  return out.slice(0, count);
}
const NUM = ['一', '二', '三', '四', '五'];
// 念出候选：“今天想聊哪个？第一个，…；第二个，…；第三个，…。”
export function choiceText(cards, { after = false } = {}) {
  const list = cards.map((c, i) => `第${NUM[i]}个，${c.text}`).join('；');
  return after ? `接下来想聊哪个？${list}。也可以接着聊这个，或者今天先到这。` : `今天想聊哪个？${list}。您点一下，或者直接跟我说。`;
}
// 只把明确的整句操作当成选题。其余原话交给主持人讨论，不从叙述里截词或默认第一张。
// discuss 不附带 nodeId/index；调用方必须把完整原话送入聊天上下文。
export function parseChoice(FW, text = '', cards = [], p = {}, { after = false } = {}) {
  const t = String(text).replace(/\s/g, '');
  if (!t) return { action: 'help', sure: true };
  if (!after && /^(我)?(现在|一时|暂时|还)?(不知道|想不到|想不起来?|没想好)(要|该|能|先)?(存|说|讲|聊)?(点|些)?(什么|啥)?(事|故事|内容)?(好)?[了呢呀啊吧。？！?！…]*$/.test(t)) return { action: 'help', sure: true };
  const command = t.replace(/[。！？?!，,、；;…]+$/g, '').replace(/^(?:好[，,]?|那[，,]?)/, '').replace(/[吧呀啊呢啦嘛]+$/, '');
  if (/^(?:(?:再)?换(?:(?:几个|一批|一组)(?:话题)?|别的|个别的|一下|个话题|一个话题)?|都不想(?:聊)?|别的(?:话题)?|有没有别的(?:话题)?)$/.test(command)) return { action: 'more', sure: true };
  if (after && /^(?:(?:今天)?(?:就|先)?(?:到这|聊到这)(?:儿)?|不聊了|歇(?:一会儿?)?|累了|下次再(?:聊|说)?|(?:我)?(?:想|要)休息(?:了)?)$/.test(command)) return { action: 'end', sure: true };
  if (after && /^(?:(?:继续|接着|还)(?:聊|说)?(?:这个|刚才(?:的)?)|(?:我)?(?:还)?没说完)$/.test(command)) return { action: 'stay', sure: true };
  if (/^(?:想聊什么都行|(?:我)?自己(?:说|讲|聊)|(?:我)?想自己(?:说|讲|聊)|随便(?:聊聊|聊|说说)|自由(?:聊|聊聊))$/.test(command)) return { action: 'free', sure: true };
  if (/^(?:随便|都行|都可以|你定|您定|都好|听你的|无所谓)$/.test(command) && cards.length) return { action: 'pick', index: 0, sure: true };
  const topic = command.replace(/^(?:我)?(?:想|要)?(?:就)?(?:选择|选|聊聊|说说|讲讲|聊|说|讲)/, '');
  const ord = topic.match(/^(?:第([一二三123])个|([一二三123])号|头一个|最后一个|中间那个)$/);
  if (ord) { const m = ord[0]; const i = /头一个/.test(m) ? 0 : /最后/.test(m) ? cards.length - 1 : /中间/.test(m) ? 1 : '一二三'.indexOf(ord[1] || ord[2]) >= 0 ? '一二三'.indexOf(ord[1] || ord[2]) : (+(ord[1] || ord[2]) - 1);
    if (cards[i]) return { action: 'pick', index: i, sure: true }; }
  // 全名匹配允许直接选已知话题；实体提示词必须完整且只属于一个节点。
  // “东西”等泛词、故事中的“过年/结婚”等子串不能决定话题。
  const exact = (words) => words.filter(Boolean).some(word => word.length >= 2 && topic === word);
  const index = cards.findIndex(c => exact([c.text, nodeTitle(FW, c.nodeId, p)]));
  if (index >= 0) return { action: 'pick', index, sure: true };
  const named = FW.nodes.filter(n => exact([fill(n.card || '', p), nodeTitle(FW, n.id, p)]));
  const hinted = named.length ? named : FW.nodes.filter(n => exact(n.entity_hints || []));
  if (hinted.length === 1) {
    const nodeId = hinted[0].id, i = cards.findIndex(c => c.nodeId === nodeId);
    return i >= 0 ? { action: 'pick', index: i, sure: true } : { action: 'pick', nodeId, sure: true };
  }
  return { action: 'discuss', sure: true };
}
