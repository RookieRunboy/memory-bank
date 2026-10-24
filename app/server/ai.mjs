import { parseStory as parse } from '../src/parseStory.js';
// 访谈 Agent / 转写整理 / 故事 / 记忆档案。每个函数先走 Gemini，失败回退规则+演示数据。
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { gemini } from './gemini.mjs';
import { SCRIPT, DEMO_ANSWERS, fill } from '../src/questions.js';
import * as P from '../src/planner.js';
import { detectCallName } from '../src/callname.js';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FW = JSON.parse(fs.readFileSync(path.join(root, 'src/framework.json'), 'utf8')); // 人生访谈框架 v2
const md = fs.readFileSync(path.join(root, '../docs/interview.md'), 'utf8');
const blocks = [...md.matchAll(/```\n([\s\S]*?)```/g)].map(m => m[1]);
export const HOST_PROMPT = blocks[0], STORY_PROMPT = blocks[1]; // interview.md 主持人提示词全文 / 故事提示词全文
// 系统提示词：{重要人物} 给完整人物列表，其余档案变量 + 会话规划变量全部替换，并校验没有残留花括号变量
const vars = (t, p, v = {}) => P.assertNoVars(P.fillAll(t.replace(/\{重要人物\}/g, p.people || ''), p, v), '提示词');
const say = t => P.assertNoVars(P.speakable(t), '朗读');
const archText = a => JSON.stringify({ 人物: a.people, 地点: a.places, 事件: a.events, 时间线: a.timeline, 上次聊到: a.lastTopic, 已问过: (a.asked || []).slice(-30) }, null, 0);
const histText = turns => turns.map(t => `小忆：${t.q}\n老人：${t.clean || t.raw || '（没说话）'}`).join('\n');
const isDemo = turns => turns.some(t => DEMO_ANSWERS.includes(t.clean || t.raw));

const NODE_LIST = FW.nodes.map(n => `${n.id}:${n.title}`).join('，');
const ctxText = (c, p) => { const s = c.plan && P.st(c.states, c.plan.ask.nodeId);
  return `【记忆档案（以往访谈积累）】${archText(c.archive || {})}\n【实体表】${JSON.stringify((c.entities || []).map(e => ({ 名称: e.name, 类型: e.type, 关系: e.relation, 已故: e.deceased || undefined, 要点: e.notes?.slice(-2) })))}\n` +
    (s ? `【当前节点状态】${c.plan.ask.nodeId} 已到第${s.depth}层，本节点已聊${s.turns}轮，连续简短回答${s.shortRun || 0}次\n` : ''); };

export async function opening(p, c, isReturn, recent = []) { // c: { archive, states, entities, plan }；recent：档案还没整理进去的上次访谈记录（兜底）
  const v = P.planVars(FW, c.plan, c);
  try {
    const r = await gemini([{ text: `${ctxText(c, p)}${recent.length ? `【上次访谈原话（档案还在整理中，以此为准）】\n${histText(recent)}\n` : ''}${isReturn ? '这是第二次及以后的访谈：按【开场】“以后的访谈”说，先提一个已聊要点或顺藤线索里的具体细节，再说今天聊什么。' : '这是第一次访谈，按【开场】“第一次访谈”说。'}只说问候，最多两句，不要提问，也不要说今天聊什么（今天的候选话题由系统紧接着念出来让老人自己选）。\n只输出 JSON：{"say":"要朗读的问候"}` }], { system: vars(HOST_PROMPT, p, v), json: true });
    if (r.say) return { say: say(r.say), ask: c.plan.ask, source: 'gemini' };
  } catch (e) { if (/未替换的变量/.test(e.message)) console.warn('[vars]', e.message); }
  let cc = c;
  if (isReturn && recent.length && !v.顺藤线索 && !v.已聊要点) { const said = recent.map(t => t.clean).filter(Boolean).sort((x, y) => y.length - x.length)[0];
    if (said) cc = { ...c, recentNote: `“${said.slice(0, 24).replace(/[。.，,！!…]+$/, '')}”这些事` }; }
  return { say: P.greetText(FW, c.plan, { ...cc, profile: p }, isReturn), ask: c.plan.ask, source: 'fallback' };
}
// 老人选话题：本地规则先判（序号/关键词/换几个…），拿不准再问 Gemini，失败就用规则（含糊默认第一个）
export async function chooseTopic(p, cards, text, { after = false } = {}) {
  const rule = P.parseChoice(FW, text, cards, p, { after });
  if (rule.sure || !String(text || '').trim()) return { ...rule, source: 'rule' };
  try {
    const r = await gemini([{ text: `小忆刚给老人念了几个话题让他选：${cards.map((c, i) => `${i + 1}. ${c.text}（${c.nodeId}）`).join('；')}${after ? '；也可以继续聊刚才的话题，或者今天先到这' : ''}。\n老人说：“${text}”\n判断老人的选择。action：pick 选了某个（index 为 0 起的序号；如果老人说的是别的具体话题，index 填 -1 并在 nodeId 填最接近的节点 id，节点：${NODE_LIST}）；more 想换几个；free 想自由聊别的、没有明确话题；${after ? 'stay 继续聊刚才的；end 今天先到这；' : ''}含糊或都行就 pick 0。\n只输出 JSON：{"action":"pick|more|free${after ? '|stay|end' : ''}","index":0,"nodeId":null}` }], { json: true, timeout: 6000 });
    const ok = ['pick', 'more', 'free', ...(after ? ['stay', 'end'] : [])];
    if (ok.includes(r?.action)) { if (r.action !== 'pick') return { action: r.action, source: 'gemini' };
      if (cards[r.index]) return { action: 'pick', index: +r.index, source: 'gemini' };
      if (r.nodeId && validNode(r.nodeId)) return { action: 'pick', nodeId: r.nodeId, source: 'gemini' };
      return { action: 'pick', index: 0, source: 'gemini' }; }
  } catch {}
  return { ...rule, source: 'rule' };
}
export const closing = (p, c) => P.closingText(FW, c.plan, { ...c, profile: p });

export async function transcribe(audio, mime, hint) { // Gemini 直接听音频
  if (audio?.length > 1000) try {
    const r = await gemini([{ inlineData: { mimeType: (mime || 'audio/webm').split(';')[0], data: audio.toString('base64') } },
      { text: '先判断：这段录音里是否有清晰可辨的人声在说中文？如果只有静音、噪音、蜂鸣/提示音或听不清，必须输出 {"speech":false,"raw":"","clean":""}，绝对不要猜测或编写任何内容。若有人声：这是一位中国老人讲述往事的录音（可能带方言）。输出 JSON：{"speech":true,...}，字段：{"raw":"逐字原始转写，保留嗯啊重复","clean":"整理后文本：去掉口头禅、重复和停顿，按意思分段（用\\n分隔），保留老人原话的味道和方言词，绝不编造或补充"}。听不清就 raw 和 clean 都给空字符串。' }], { json: true, temperature: 0 });
    if (r.speech !== false && (r.raw || r.clean)) return { raw: r.raw || '', clean: r.clean || r.raw, source: 'gemini' };
    if (r.speech === false) return { raw: '', clean: (hint || '').trim(), source: 'gemini-nospeech' };
  } catch {}
  const t = (hint || '').trim();
  return { raw: t, clean: t.replace(/(嗯+|啊+|那个|就是说)[，,、]?/g, '').trim() || t, source: 'fallback' };
}

async function nextGemini(p, c, turns, audio) {
  const MAX = 10;
    const v = P.planVars(FW, c.plan, { ...c, profile: p });
    return await gemini([{ text:  `${ctxText(c, p)}【本次对话】\n${histText(turns)}\n\n【话题网节点】${NODE_LIST}\n` +
      (c.plan.free ? '老人选了“想聊什么都行”：顺着老人自己说的内容聊，不要拉回任何指定话题，ask.nodeId 填老人正在讲的节点。\n'
        : '当前话题聊够了（到了第4层，或老人连着几句没什么可说），不要自己开新话题：ask.nodeId 填 "switch"，say 只用一句话谢谢老人讲的这个故事、复述一个细节，不要提问，系统会接着念几个候选话题让老人自己选。\n') +
      `请按【说话方式】【必须遵守】【话题内引导】【过渡到下一个话题】决定下一句。已经聊了${turns.length}轮，满${MAX}轮或老人累了就按【结束】收尾。\n` +
      `同时分析老人刚才这一句：属于哪个节点（跑题就填它真正讲到的节点 id，找不到就填最接近的）、到达第几层（0 没有实质内容，1 事实，2 场景细节，3 感受，4 想对后辈说的话）、一句要点、提到的人地物。\n` +
      `只输出 JSON：{${audio ? `"speech":true,"raw":"","clean":"",` : ""}"answer":{"nodeId":"","depth":0,"note":"","entities":[{"type":"person|place|thing","name":"","aliases":[],"relation":"parents|siblings|spouse|children|friends|teachers|colleagues|null","deceased":false,"trigger":"photo|song|food|object|festival|null","note":""}]},"emotion":"开心|平静|卡壳|难过|困惑|累了|烦躁","leave":null,"ask":{"nodeId":"下一句问的是哪个节点","depth":1},"action":"追问细节|给台阶|安抚|换话题|过渡|收尾","callName":null,"say":"要朗读的话","done":false}。leave 只在老人难过且安抚后仍未恢复时填 "upset"，累了填 "tired"。callName 只在老人刚才明确要求换个叫法时填新称呼（如老人说“叫我老王就行”就填 "老王"），并且 say 里当场用新称呼；否则填 null。${FIRST_RULE}${SHORT_RULE}` }, ...(audio ? [{ text: '【老人刚才这一句的录音】见下面的音频。' + '附带的录音是老人刚才这一句的回答（中国老人，可能带方言）。先听清它：没有清晰人声（静音、噪音、提示音）就输出 {"speech":false}，绝不猜测编写。有人声就在 JSON 里同时给出 "speech":true、"raw"（逐字原始转写，保留嗯啊重复）、"clean"（去掉口头禅重复停顿、按意思分段用\\n、保留原话味道和方言词、绝不编造），raw 和 clean 只能是录音里真的说出来的话，一个字也不能从上下文、档案或前面的对话里补；录音只有几个字，clean 就只有那几个字。然后把它当作老人这一句来分析和回复。\n' + '输出 JSON 时把 "speech"、"raw"、"clean" 放在最前面：先只凭音频写完转写，再写回复。' }, { inlineData: { mimeType: (audio.mime || 'audio/webm').split(';')[0], data: audio.buf.toString('base64') } }] : [])],
      { system: vars(HOST_PROMPT, p, v), json: true, ...(audio && { timeout: +(process.env.GEMINI_FUSED_TIMEOUT_MS || 10000) }) });
}

const validNode = id => !!P.nodeById(FW, id);
// 每轮：模型同时输出 回答归属节点/层次/要点/实体/情绪 + 下一问的节点/层次 + 要朗读的话；据此更新节点状态、实体表、会话规划
// 合并调用：音频 + 上下文一次给模型，同时输出 raw/clean 转写和下一句（省掉一次往返）；失败抛 FUSED，调用方回退两步流程
export const FUSED_FAIL = 'fused-failed';
// 合并调用偶尔会把上下文“补”进转写：按录音时长估一个字数上限（老人语速一般 ≤ 6 字/秒），超了就不信，回退两步
export const plausible = (text, durMs) => !durMs || String(text || '').replace(/[\s，。,.！!？?…、；;：:"“”]/g, '').length <= durMs / 1000 * 6 + 6;
const FIRST_RULE = '老人刚说完时前端已经播了一句“嗯，我听着呢 / 哦，是这样啊”之类的短回应，say 不要再重复这类意思（不要以“嗯”“哦”“我听着呢”“明白了”开头）。say 的第一句要很短（8–10 个字以内，用“。”或“，”断开），接得上那句短回应，比如“原来是筒子楼啊。”，然后再说其余的话。';
const SHORT_RULE = '如果老人这一句很短（几个字，如“挺好的”“嗯”）或说记不清/忘了/不知道：只接住这一句本身（比如“挺好的，听着就踏实。”或“没关系，想不起来就不想了。”），不要重复上一轮已经说过的内容，不要跳到别的大问题，接着问一个同一场景里具体、好答的小问题（比如“冬天屋里冷不冷呀？”）。say 里一次只问一个问题，也不要把老人刚刚回答过的意思再问一遍；【本次对话】里你上一轮已经问过的问题不要原样再问，要顺着老人这一句换一个新的小问题。';
export const FORGOT_RE = /记不(太)?清|想不起|忘了|不记得|不知道/;
// 服务端兜底：一次只问一个问题（第二个问号之后全截掉）
export const oneQuestion = t => { const m = String(t || '').match(/^[^？?]*[？?]/); return m ? m[0] : String(t || ''); };
// 记不清：模型没安抚就补固定安抚话术
export const soothe = (t, said) => FORGOT_RE.test(said || '') && !/没关系|不要紧|不着急/.test(t || '') ? '没关系，想不起来就不想了。' + String(t || '').replace(/^[^，。]*(记不清|想不起)[^。]*。/, '') : t;
// 换话题这一轮：只留模型“接住”的部分，候选由服务端念（与卡片一致）
export const keepAck = t => String(t || '').replace(/(接下来|咱们聊聊哪|您想聊哪|想聊哪|下面|第一个[，,])[\s\S]*$/, '').replace(/[^。！!]*[？?]\s*$/, '').trim();
export async function nextTurn(p, c, turns, sessionId, { audio } = {}) {
  const MAX = 10, last = turns.at(-1), ask = c.plan.ask;
  let r0 = null;
  if (audio) { const real = last.clean; last.clean = '（见附带的录音）';
    try { r0 = await nextGemini(p, c, turns, audio); } catch (e) { r0 = null; } last.clean = real;
    if (!r0 || r0.speech === false || !(r0.clean || r0.raw) || !r0.say || !plausible(r0.raw || r0.clean, audio.durMs)) throw new Error(FUSED_FAIL);
    last.raw = r0.raw || r0.clean; last.clean = r0.clean || r0.raw; }
  const short = (last?.clean || '').replace(/[\s，。,.！!？?…、]/g, '').length < 8 || /不知道|忘了|想不起/.test(last?.clean || '');
  const second = c.plan.nodes[c.plan.currentNodeIndex + 1];
  let r = r0, source = r0 ? 'gemini-fused' : 'gemini';
  if (!r) try {
    r = await nextGemini(p, c, turns);
    if (!r?.say) throw new Error('empty');
  } catch (e) { if (/未替换的变量/.test(e.message)) console.warn('[vars]', e.message); r = null; source = 'fallback'; }
  // 0) 改口：老人主动要求别的叫法（模型给 callName，或规则从原话识别），当场生效
  const newCall = (typeof r?.callName === 'string' && r.callName.trim() && r.callName.trim() !== p.callName ? r.callName.trim().slice(0, 8) : null) || (() => { const c = detectCallName(last?.clean); return c && c !== p.callName ? c : null; })();
  if (newCall) p = { ...p, callName: newCall, callNameBy: 'elder' };
  // 1) 回答归属与状态
  const rule = P.ruleAnalyze(FW, last?.clean || '', ask, p);
  const an = r?.answer && validNode(r.answer.nodeId) ? { ...r.answer, depth: Math.max(0, Math.min(4, +r.answer.depth || 0)) } : rule;
  const emotion = r?.emotion || rule.emotion;
  const upd = P.applyAnswer(FW, c.states, { nodeId: an.nodeId, depth: an.depth, note: an.note, short, emotion, leave: r?.leave || null }, sessionId);
  let states = upd.states; const entities = P.mergeEntities(c.entities, an.entities || [], an.nodeId, sessionId);
  // 当前节点是否聊够（跑题时当前节点也可能因连续简短等聊够）
  const curS = P.st(states, ask.nodeId), leave = an.nodeId === ask.nodeId ? upd.leave : (curS.depth >= 4 ? 'deep' : null);
  // 2) 规划推进
  let plan = { ...c.plan }, text, done;
  let sw = false;
  if (r && r.ask?.nodeId === 'switch' && !c.plan.free) { sw = true; text = say(r.say); done = turns.length >= MAX; }
  else if (r) {
    const nA = r.ask && validNode(r.ask.nodeId) ? { nodeId: r.ask.nodeId, depth: Math.max(1, Math.min(4, +r.ask.depth || 1)) } : ask;
    if (!c.plan.free && nA.nodeId !== ask.nodeId && nA.nodeId !== an.nodeId && leave !== 'upset' && !r.done && turns.length < MAX) { // 模型想换话题：不直接跳，交给老人选
      sw = true; text = say(r.say); done = false;
    } else {
    const k = plan.nodes.findIndex(x => x.nodeId === nA.nodeId);
    if (k > plan.currentNodeIndex) plan.currentNodeIndex = k;
    plan.ask = nA; text = say(r.say); done = !!r.done || turns.length >= MAX;
    }
  } else {
    const nx = P.nextAsk(FW, plan, states, leave);
    if (leave !== 'upset' && leave !== 'tired' && turns.length < 5 && (nx.currentNodeIndex !== plan.currentNodeIndex || nx.done)) sw = true; // 聊够了：让老人自己选下一个
    else plan = nx;
    done = !sw && (plan.done || turns.length >= 5);
    const sad = emotion === '难过', forgot = /卡壳/.test(emotion);
    // 先接住：用老人自己的话点一句（小结），只答几个字就短短回应
    const clip = (last?.clean || '').split(/[，。,.！!？?…；;]/).map(x => x.trim()).find(x => x.length >= 4 && x.length <= 14);
    const pre = sad ? '说起他，您心里肯定还惦记着。' : forgot ? '没关系，想不起来就不想了。' : short ? '嗯，是这样。' : clip ? `原来是${clip.replace(/^(我|那时候|那会儿)/, '')}。` : fill(SCRIPT.acks[turns.length % 3], p);
    text = done ? null : sw ? say(sad ? '说起他，您心里肯定还惦记着。' : clip ? `${clip}，这些我都记下了。` : '这段我都好好记下了。') : say(pre + P.questionFor(FW, plan.ask.nodeId, plan.ask.depth, p));
  }
  if (r && text && !done) text = sw ? keepAck(text) : oneQuestion(soothe(text, last?.clean));
  if (done) { plan.done = true; if (!r) text = closing(p, { ...c, states, entities, plan }); }
  return { emotion, action: r?.action || (done ? '收尾' : leave ? '过渡' : '追问细节'), say: text, done, source, analysis: { ...an, short, leave }, plan, states, entities, callName: newCall, switch: sw && !done };
}

export const DEMO_STORY = { title: '他说我跟桂花糕一样甜', body: '我是在纺织厂认识老李的。他是修机器的，一身机油味。\n\n头一回见他，傻乎乎的，脸一红就不会说话了。哈哈。\n\n那时候谈对象，我们去瘦西湖，他骑自行车带我。那是哪一年来着，我想不起来了。只记得是春天，柳树都绿了。\n\n他给我买过一包桂花糕，说扬州最甜的就是这个，跟我一样甜。\n\n他走了好多年了。这些事，我讲给小梅听，也讲给孙子听。', people: '李建国（老伴）；小梅（女儿）', timePlace: '江苏扬州，纺织厂、瘦西湖', quotes: '“他说扬州最甜的就是这个，跟我一样甜。”' };
export async function story(p, turns) {
  try { const t = await gemini([{ text: vars(STORY_PROMPT.replace('{转录文本}', () => histText(turns)), p) }], { tier: 'story' }); return { ...parse(t), source: 'gemini' }; } catch {}
  if (isDemo(turns) && turns.length >= 4 && turns[0].clean === DEMO_ANSWERS[0]) return { ...DEMO_STORY, source: 'fallback' };
  const said = turns.map(t => t.clean).filter(Boolean);
  return { title: `${p.hometown || '老家'}的那些年`, body: said.join('\n\n') || '这一次，我们只是慢慢地坐了一会儿。', quotes: said[0] ? `“${said[0]}”` : '', source: 'fallback' };
}

export async function updateArchive(p, a, turns, stage, { offline = false } = {}) {
  const asked = [...(a.asked || []), ...turns.map(t => t.qid).filter(Boolean)];
  if (!offline) try {
    const r = await gemini([{ text: `你在维护老人${p.name}的「记忆档案」。现有档案：${JSON.stringify(a)}\n本次访谈（阶段：${stage}）：\n${histText(turns)}\n\n把本次老人说的新信息合并进档案，只记老人说过的，不编造；前后矛盾并列保留不纠正。输出 JSON：{"people":[{"name":"","relation":"","note":""}],"places":[{"name":"","note":""}],"events":[{"title":"","when":"","detail":""}],"timeline":[{"when":"","what":""}],"lastTopic":"下次开场可提起的上次话题，一句口语，如：您和老伴李先生骑自行车去瘦西湖、他给您买桂花糕","conflicts":[""]}` }], { json: true, tier: 'pro' }) // pro 30 s 超时后回退 flash;
    if (r.people) return { ...r, asked, updatedAt: Date.now(), source: 'gemini' };
  } catch {}
  const m = { people: a.people || [], places: a.places || [], events: a.events || [], timeline: a.timeline || [], conflicts: a.conflicts || [] };
  const add = (arr, o, k) => { if (!arr.some(x => x[k] === o[k])) arr.push(o); };
  if (isDemo(turns)) {
    add(m.people, { name: '李建国', relation: '老伴（已故）', note: '纺织厂修机器的，一身机油味；见面脸一红就不会说话' }, 'name');
    add(m.people, { name: '小梅', relation: '女儿', note: '' }, 'name');
    add(m.places, { name: '扬州纺织厂', note: '和老伴相识的地方' }, 'name');
    add(m.places, { name: '瘦西湖', note: '谈对象时常去，春天柳树都绿了' }, 'name');
    add(m.events, { title: '在纺织厂认识李建国', when: '年轻时', detail: '他是修机器的' }, 'title');
    add(m.events, { title: '骑自行车去瘦西湖', when: '春天（年份想不起来）', detail: '他骑车带我' }, 'title');
    add(m.events, { title: '一包桂花糕', when: '谈对象时', detail: '他说扬州最甜的就是这个，跟我一样甜' }, 'title');
    add(m.timeline, { when: '1948', what: '出生于江苏扬州' }, 'what');
    add(m.timeline, { when: '年轻时', what: '进纺织厂，认识李建国' }, 'what');
    return { ...m, asked, lastTopic: '您老伴李先生骑自行车带您去瘦西湖，还给您买了一包桂花糕', updatedAt: Date.now(), source: 'fallback' };
  }
  turns.filter(t => t.clean).forEach(t => add(m.events, { title: t.clean.slice(0, 16), when: stage, detail: t.clean }, 'title'));
  const last = turns.filter(t => t.clean).at(-1)?.clean;
  return { ...m, asked, lastTopic: last ? `“${last.slice(0, 24)}”` : a.lastTopic, updatedAt: Date.now(), source: 'fallback' };
}
