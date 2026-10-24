// 人生访谈框架 v2 的运行逻辑（前后端共用，纯函数）。数据：src/framework.json；规则：docs/interview-framework.md
// FW 由调用方传入：前端 import JSON，后端 fs 读取。
import { fill } from './questions.js';

export const LAYER_LABEL = { 1: '事实', 2: '场景细节', 3: '感受', 4: '想对后辈说的话' };
export const emptyState = id => ({ nodeId: id, status: 'not_started', depth: 0, turns: 0, notes: [], sensitive: false, shortRun: 0, lastSessionId: null, updatedAt: 0 });
export const st = (states, id) => states?.[id] || emptyState(id);
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
const status = (ctx, id) => ctx.assumeDone?.includes(id) ? 'done' : st(ctx.states, id).status;
// 避免连续同维度：relation 和 domain 都不同 > 至少一个不同 > 同维度；同档按 nodes 顺序
function diverse(cands, prev) {
  if (!prev || cands.length < 2) return cands[0];
  const score = n => (n.tags.relation !== prev.relation ? 1 : 0) + (n.tags.domain !== prev.domain ? 1 : 0);
  return [...cands].sort((a, b) => score(b) - score(a))[0];
}
function matchEntity(n, e) {
  const names = [e.name, ...(e.aliases || [])].filter(Boolean), hint = n.entity_hints.some(h => names.some(x => x.includes(h) || h.includes(x)));
  if (e.type === 'person') return (e.relation && n.tags.relation === e.relation) || hint;
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
    const c = N.filter(n => n.tags.trigger.includes(req.trigger) && status(ctx, n.id) !== 'done' && eligible(FW, ctx, n, { allowSensitive: true }));
    const n = diverse(c, prev); if (n) return { nodeId: n.id, reason: 'family_trigger', trigger: req.trigger, startDepth: Math.min(4, st(ctx.states, n.id).depth + 1) };
  }
  // 2 顺藤摸瓜
  const TY = { person: 0, thing: 1, place: 2 }; // 顺藤摸瓜先跟人，再跟物、地
  const recentEnts = (ctx.entities || []).filter(e => ctx.lastSessionId && e.lastSessionId === ctx.lastSessionId).sort((a, b) => (TY[a.type] ?? 3) - (TY[b.type] ?? 3));
  for (const e of recentEnts) {
    const c = N.filter(n => status(ctx, n.id) === 'not_started' && eligible(FW, ctx, n) && matchEntity(n, e));
    const n = diverse(c, prev); if (n) return { nodeId: n.id, reason: 'follow_entity', entity: e.id, startDepth: 1 };
  }
  // 3 加深
  const part = N.filter(n => status(ctx, n.id) === 'partial' && st(ctx.states, n.id).depth < 4 && eligible(FW, ctx, n))
    .sort((a, b) => st(ctx.states, b.id).updatedAt - st(ctx.states, a.id).updatedAt);
  if (part.length) { const top = part.filter(n => st(ctx.states, n.id).updatedAt === st(ctx.states, part[0].id).updatedAt); const n = diverse(top, prev);
    return { nodeId: n.id, reason: 'deepen', startDepth: st(ctx.states, n.id).depth + 1 }; }
  // 4 兜底补覆盖
  const chatted = N.filter(n => ['partial', 'done'].includes(status(ctx, n.id)));
  const order = [];
  for (const dim of ['relation', 'domain', 'time']) for (const v of Object.keys(FW.dimensions[dim].values))
    order.push({ dim, v, count: chatted.filter(n => n.tags[dim] === v).length });
  const pool = N.filter(n => status(ctx, n.id) === 'not_started' && eligible(FW, ctx, n));
  for (const o of [...order].sort((a, b) => a.count - b.count)) { // sort 稳定：同样少时保持维度与取值顺序
    const c = pool.filter(n => n.tags[o.dim] === o.v); const n = diverse(c, prev);
    if (n) return { nodeId: n.id, reason: 'coverage', dim: o.dim, value: o.v, startDepth: 1 };
  }
  // 全部聊完：回到 notes 最多的节点再聊一层
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
  const nx = selectNode(FW, { ...base, exclude: nodes.map(x => x.nodeId), assumeDone: nodes.map(x => x.nodeId), prev: tagsOf(b.nodeId) });
  return { sessionId, requestedBy: request?.nodeId || request?.trigger ? 'family' : 'auto', request, previousNode: prevNodeId ? { nodeId: prevNodeId, tags: tagsOf(prevNodeId) } : null,
    nodes, currentNodeIndex: 0, ask: { nodeId: a.nodeId, depth: a.startDepth, trigger: a.trigger || null }, nextNodePreview: { nodeId: nx.nodeId, reason: nx.reason, entity: nx.entity || null }, createdAt: Date.now() };
}
const DIMV = (FW, dim, v) => FW.dimensions[dim]?.values[v] || v;
export function reasonText(FW, x, entities = [], p) {
  const e = entities.find(e => e.id === x.entity);
  return { family: '家人指定', family_trigger: `家人带来了${DIMV(FW, 'trigger', x.trigger)}`, follow_entity: `顺着上次提到的「${e?.name || ''}」`,
    deepen: `上次聊到第${x.startDepth - 1}层，这次从第${x.startDepth}层（${LAYER_LABEL[x.startDepth]}）接着聊`, coverage: `「${DIMV(FW, x.dim, x.value)}」这方面聊得最少，补一补`,
    revisit: '都聊过了，回到讲得最开心的话题再聊一层', safe: '轻松安全的话题' }[x.reason] || '';
}
// 当前问题：节点某一层的问题，或触发物开场
export function questionFor(FW, nodeId, depth, p, trigger) {
  const n = nodeById(FW, nodeId); if (!n) return '';
  if (trigger && depth <= 1 && n.trigger_openers?.[trigger]) return fill(n.trigger_openers[trigger], p);
  const L = n.layers.find(l => l.depth === Math.max(1, Math.min(4, depth))) || n.layers[0];
  return fill(L.question, p);
}
// 新变量 {今天话题}{当前话题}{当前层次}{当前话题入场问题}{顺藤线索}{已聊要点}{下次话题}{上一个话题}
export function planVars(FW, plan, { profile: p = {}, states = {}, entities = [], recentNote = '' } = {}) {
  if (!plan) return {};
  const ask = plan.ask || {}, titles = plan.nodes.map(x => nodeTitle(FW, x.nodeId, p));
  const ent = entities.find(e => plan.nodes.some(x => x.entity === e.id)) || entities.filter(e => e.lastSessionId && e.lastSessionId === plan.lastSessionId)[0];
  const notes = FW.nodes.map(n => st(states, n.id)).filter(s => s.notes.length).sort((a, b) => b.updatedAt - a.updatedAt).flatMap(s => s.notes).slice(0, 4);
  if (!notes.length && recentNote) notes.push(recentNote);
  const prevS = plan.previousNode && st(states, plan.previousNode.nodeId);
  return {
    今天话题: titles.length > 1 ? `${titles[0]}，还有${titles[1]}` : titles[0] || '',
    当前话题: nodeTitle(FW, ask.nodeId, p),
    当前层次: ask.depth ? `第${ask.depth}层，${LAYER_LABEL[ask.depth]}` : '',
    当前话题入场问题: questionFor(FW, ask.nodeId, ask.depth, p, ask.trigger),
    顺藤线索: ent ? `${ent.name}${ent.notes?.[0] ? '，' + ent.notes[0] : ''}` : '',
    已聊要点: notes.join('；'),
    下次话题: nodeTitle(FW, plan.nextNodePreview?.nodeId, p),
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
  const v = planVars(FW, plan, ctx), p = ctx.profile;
  const head = isReturn && (v.顺藤线索 || v.已聊要点)
    ? `{称呼}，您好呀，我是小忆。上次您说到${(v.顺藤线索 || v.已聊要点.split('；')[0]).replace(/[。.！!]+$/, '')}，我一直记着呢。今天想听您讲讲{今天话题}。`
    : '{称呼}，您好呀。我是记忆银行的小忆。今天想听您讲讲{今天话题}。咱们慢慢聊，想到哪儿说到哪儿。';
  return assertNoVars(fillAll(head, p, v) + v.当前话题入场问题, '开场');
}
export function closingText(FW, plan, ctx) {
  const v = planVars(FW, plan, ctx);
  const t = '{称呼}，今天听您讲了这么多，真开心。这些故事我都好好收起来了，会留给您的家人听。' + (v.下次话题 ? '下次咱们聊聊{下次话题}，好吗？您先歇一歇。' : '您歇一歇，下次再接着聊，好吗？');
  return assertNoVars(fillAll(t, ctx.profile, v), '结束');
}

// 节点状态更新（只前进不后退）。r: { nodeId, depth, note, emotion, short }
export function applyAnswer(FW, states, r, sessionId) {
  if (!nodeById(FW, r.nodeId)) return states;
  const s = { ...st(states, r.nodeId) }; s.notes = [...s.notes];
  s.turns++; s.depth = Math.max(s.depth, Math.max(0, Math.min(4, r.short ? 0 : (r.depth | 0))));
  if (r.note) s.notes.push(r.note);
  s.shortRun = r.short ? (s.shortRun || 0) + 1 : 0;
  if (s.depth > 0 && s.status === 'not_started') s.status = 'partial';
  const upset = /难过|困惑/.test(r.emotion || '') && r.leave === 'upset', tired = /累|烦躁/.test(r.emotion || '') || r.leave === 'tired';
  let leave = null;
  if (s.depth >= 4) leave = 'deep'; else if (s.turns >= 8) leave = 'max_turns'; else if (upset) leave = 'upset'; else if (tired) leave = 'tired'; else if (s.shortRun >= 2) leave = 'short_replies';
  if (leave === 'deep' || leave === 'max_turns') s.status = 'done';
  if ((leave === 'tired' || leave === 'short_replies') && s.depth >= 3) s.status = 'done';
  if (leave === 'upset') s.sensitive = true;
  if (s.status === 'not_started' && s.turns) s.status = s.depth ? 'partial' : 'not_started';
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
  if (leave === 'upset') { const safe = FW.planning.fallback_safe_nodes.find(id => st(states, id).status !== 'done' && !plan.nodes.some(x => x.nodeId === id)); // 情绪不稳：转安全话题
    if (safe) return { ...plan, nodes: [...plan.nodes.slice(0, k), { nodeId: safe, reason: 'safe', startDepth: 1, note: '情绪波动，换个轻松话题' }], currentNodeIndex: k, ask: { nodeId: safe, depth: 1 } }; }
  if (!nx) return { ...plan, done: true };
  return { ...plan, currentNodeIndex: k, ask: { nodeId: nx.nodeId, depth: Math.max(nx.startDepth || 1, st(states, nx.nodeId).depth + 1) } };
}
// 人生地图统计：每个维度每个取值 聊过/总数
export function coverage(FW, states = {}) {
  const out = {};
  for (const [dim, d] of Object.entries(FW.dimensions)) out[dim] = Object.entries(d.values).map(([v, label]) => {
    const ns = FW.nodes.filter(n => dim === 'trigger' ? n.tags.trigger.includes(v) : n.tags[dim] === v);
    return { v, label, total: ns.length, chatted: ns.filter(n => st(states, n.id).status !== 'not_started').length, done: ns.filter(n => st(states, n.id).status === 'done').length };
  });
  return out;
}
// 离线兜底题目：规划第一个节点四层 + 第二个节点第一层，共 5 题
export function offlineQuestions(FW, p, request) {
  const plan = planSession(FW, { profile: p, request });
  const a = plan.nodes[0], b = plan.nodes[1];
  const qs = [1, 2, 3, 4].map(d => ({ nodeId: a.nodeId, depth: d, text: questionFor(FW, a.nodeId, d, p, d === 1 ? a.trigger : null) }));
  qs.push({ nodeId: b.nodeId, depth: 1, text: questionFor(FW, b.nodeId, 1, p) });
  qs[0].text = openingText(FW, plan, { profile: p }, false);
  return { plan, qs };
}
