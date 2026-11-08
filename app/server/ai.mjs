import { parseStory as parse } from '../src/parseStory.js';
// 访谈 Agent / 转写整理 / 故事 / 记忆档案。每个函数先走 Gemini，失败回退规则+演示数据。
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { gemini } from './gemini.mjs';
import { asrViaOpenai, openaiTranscribe, openaiEnabled, openaiChat } from './openai.mjs';
import { topLevelJSON } from './streaming-json.mjs';
import { DEMO_ANSWERS } from '../src/questions.js';
import * as P from '../src/planner.js';
import { detectCallName } from '../src/callname.js';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FW = JSON.parse(fs.readFileSync(path.join(root, 'src/framework.json'), 'utf8')); // 有来源的访谈问题库
const md = fs.readFileSync(path.join(root, '../docs/interview.md'), 'utf8');
const blocks = [...md.matchAll(/```\n([\s\S]*?)```/g)].map(m => m[1]);
const style = fs.readFileSync(path.join(root, '../docs/host-style.md'), 'utf8').match(/```\n([\s\S]*?)```/)?.[1] || ''; // 主持人风格层（docs/host-style.md）
export const HOST_PROMPT = blocks[0] + '\n' + style, STORY_PROMPT = blocks[1]; // interview.md 主持人提示词全文 + 风格层 / 故事提示词全文
// 系统提示词：{重要人物} 给完整人物列表，其余档案变量 + 会话规划变量全部替换，并校验没有残留花括号变量
const vars = (t, p, v = {}) => P.assertNoVars(P.fillAll(t.replace(/\{重要人物\}/g, p.people || ''), p, v), '提示词');
const say = t => P.assertNoVars(P.speakable(t), '朗读');
const archText = a => JSON.stringify({ 人物: a.people, 地点: a.places, 事件: a.events, 时间线: a.timeline, 上次聊到: a.lastTopic, 已问过: (a.asked || []).slice(-30) }, null, 0);
const histText = turns => turns.map(t => `小忆${t.interrupted ? '（这句未播完，老人已插话）' : ''}：${t.q}\n老人${t.continuation ? '（长段讲述，尚未讲完）' : ''}：${t.clean || t.raw || '（没说话）'}`).join('\n');
const isDemo = turns => turns.some(t => DEMO_ANSWERS.includes(t.clean || t.raw));

const NODE_LIST = FW.nodes.map(n => `${n.id}:${n.title}`).join('，');
const ctxText = (c, p) => { const s = c.plan && P.st(c.states, c.plan.ask.nodeId);
  return `${c.delivery?.length ? '【播放情况】上次生成的回复可能未播放或已被插话打断。只以每轮记录的实际问题为准，不假定老人听过生成但未播出的提问。先接着老人的最新补充。\n' : ''}【记忆档案（以往访谈积累）】${archText(c.archive || {})}\n【实体表】${JSON.stringify((c.entities || []).map(e => ({ 名称: e.name, 类型: e.type, 关系: e.relation, 已故: e.deceased || undefined, 要点: e.notes?.slice(-2) })))}\n` +
    (s && !c.plan.free ? `【当前节点状态】${c.plan.ask.nodeId} 已到第${s.depth}层，本节点已聊${s.turns}轮，连续简短回答${s.shortRun || 0}次\n` +
      `【当前话题的访谈参考】${JSON.stringify(P.questionGuide(FW, c.plan.ask.nodeId, p))}\n按 entryCondition 判断适用前提，结合回答从 questions 中选一个角度。简短或卡住时参考 gentleQuestion，遵守 precautions。问过的跳过，反思按本人意愿，问法可自然改写。\n` : ''); };

export async function opening(p, c, isReturn) {
  // 用户已定稿；只替换称呼，避免模型改写或增加一次开场等待。
  return { say: P.greetText(FW, c.plan, { ...c, profile: p }, isReturn), ask: c.plan.ask, source: 'template' };
}
// Only explicit menu commands select a card. Natural speech goes intact to
// the host, including subjects absent from the reference question bank.
export async function chooseTopic(p, cards, text, { after = false } = {}) {
  return { ...P.parseChoice(FW, text, cards, p, { after }), source: 'rule' };
}
const requestsChoices = (p, text) => ['more', 'help'].includes(P.parseChoice(FW, text || '', [], p, { after: true }).action);
export const closing = (p, c) => P.closingText(FW, c.plan, { ...c, profile: p });

// whisper 对静音/噪音偶尔会“幻觉”出固定字幕语，这类整句直接当没听清
const HALLU = /^(请)?(不吝)?点赞|字幕(志愿者|由)|谢谢(大家)?(观看|收看)?[。.!！]?$|订阅|Amara|明镜/;
export async function transcribe(audio, mime, hint) { // 优先 whisper（OpenAI 协议），失败回退 Gemini 听音频
  if (audio?.length > 1000 && asrViaOpenai()) try {
    const t = await openaiTranscribe(audio, mime);
    if (!t || HALLU.test(t.replace(/\s/g, ''))) return { raw: '', clean: '', source: 'whisper-nospeech' };
    return { raw: t, clean: t, source: 'whisper' };
  } catch (e) { console.warn('[asr] whisper 失败', e.message.slice(0, 100), '→ 回退'); }
  if (audio?.length > 1000) try {
    const r = await gemini([{ inlineData: { mimeType: (mime || 'audio/webm').split(';')[0], data: audio.toString('base64') } },
      { text: '先判断：这段录音里是否有清晰可辨的人声在说中文？如果只有静音、噪音、蜂鸣/提示音或听不清，必须输出 {"speech":false,"raw":"","clean":""}，绝对不要猜测或编写任何内容。若有人声：这是一位中国老人讲述往事的录音（可能带方言）。输出 JSON：{"speech":true,...}，字段：{"raw":"逐字原始转写，保留嗯啊重复","clean":"整理后文本：去掉口头禅、重复和停顿，按意思分段（用\\n分隔），保留老人原话的味道和方言词，绝不编造或补充"}。听不清就 raw 和 clean 都给空字符串。' }], { json: true, temperature: 0 });
    if (r.speech !== false && (r.raw || r.clean)) return { raw: r.raw || '', clean: r.clean || r.raw, source: 'gemini' };
    return { raw: '', clean: '', source: 'gemini-nospeech' };
  } catch {}
  const t = (hint || '').trim();
  return { raw: t, clean: t.replace(/(嗯+|啊+|那个|就是说)[，,、]?/g, '').trim() || t, source: 'fallback', ...(audio?.length > 1000 && !t ? { unavailable: true } : {}) };
}

async function nextGemini(p, c, turns, audio, progress) {
  const MAX = 10;
  const invoke = progress && openaiEnabled() && !audio ? openaiChat : gemini;
  const schema = progress
    ? '{"ask":{"nodeId":"下一句问的是哪个节点","depth":1},"done":false,"callName":null,"say":"要朗读的话","answer":{"nodeId":"","depth":0,"note":"","entities":[{"type":"person|place|thing","name":"","aliases":[],"relation":"parents|siblings|spouse|children|friends|teachers|colleagues|null","deceased":false,"trigger":"photo|song|food|object|festival|null","note":""}]},"emotion":"兴致好|开心|平静|卡壳|难过|困惑|累了|烦躁","leave":null,"action":"追问细节|留白|澄清|给台阶|安抚|换话题|过渡|收尾"}'
    : `{${audio ? '"speech":true,"raw":"","clean":"",' : ''}"answer":{"nodeId":"","depth":0,"note":"","entities":[{"type":"person|place|thing","name":"","aliases":[],"relation":"parents|siblings|spouse|children|friends|teachers|colleagues|null","deceased":false,"trigger":"photo|song|food|object|festival|null","note":""}]},"emotion":"兴致好|开心|平静|卡壳|难过|困惑|累了|烦躁","leave":null,"ask":{"nodeId":"下一句问的是哪个节点","depth":1},"action":"追问细节|留白|澄清|给台阶|安抚|换话题|过渡|收尾","callName":null,"say":"要朗读的话","done":false}`;
    const v = P.planVars(FW, c.plan, { ...c, profile: p });
    if (c.plan.free) Object.assign(v, { 今天话题: '以老人本次讲述为准', 当前话题: '以老人最新讲述为准', 当前层次: '', 当前话题入场问题: '', 顺藤线索: '' });
    return await invoke([{ text:  `${ctxText(c, p)}【本次对话】\n${histText(turns)}\n\n【话题网节点】${NODE_LIST}\n` +
      '老人最新说的话是当前话题的依据。老人纠正话题、否认你的假设或已说出另一个具体话题时，直接跟进他明确说的内容；不要让他再选一次，不要拉回题库或档案里的旧话题。\n' +
      (requestsChoices(p, turns.at(-1)?.clean || turns.at(-1)?.raw)
        ? '老人明确请求推荐或更换候选话题，可以填 ask.nodeId="switch"，say 简短回应，系统会提供候选。\n'
        : '本轮不提供话题菜单，不填 ask.nodeId="switch"。题库只是归档标签，不限制老人能讲什么；没有对应节点也正常。\n') +
      `顺着老人刚才的话决定下一句。已经聊了${turns.filter(t => !t.continuation).length}轮，满${MAX}轮或老人想停时，简短收尾，done 填 true，ask 保持当前节点。收尾优先于换话题。\n` +
      `同时分析老人刚才这一句：属于哪个节点（有直接对应的才填节点 id，没有就填 null，不强行归到最接近的；ask.nodeId 可保留当前参考节点，但不能因此改变要聊的内容）、到达第几层（0 没有实质内容，1 事实，2 场景细节，3 感受，4 意义与寄语）、一句要点、提到的人地物。\n` +
      `只输出 JSON：${schema}。leave 只在老人难过且安抚后仍未恢复时填 "upset"，累了填 "tired"。老人还在兴致勃勃地讲时，action 填“留白”，say 用“您接着说。”这类短回应。没听清意思时 action 填“澄清”。callName 只在老人刚才明确要求换个叫法时填新称呼（如老人说“叫我老王就行”就填 "老王"），并且 say 里当场用新称呼；否则填 null。${FIRST_RULE}${progress ? '按示例顺序先输出 ask、done、callName、say，再输出其余分析。say 里只写最终要说的话，不在后面的字段修改已写的内容。' : ''}` }, ...(audio ? [{ text: '【老人刚才这一句的录音】见下面的音频。' + '附带的录音是老人刚才这一句的回答（中国老人，可能带方言）。先听清它：没有清晰人声（静音、噪音、提示音）就输出 {"speech":false}，绝不猜测编写。有人声就在 JSON 里同时给出 "speech":true、"raw"（逐字原始转写，保留嗯啊重复）、"clean"（去掉口头禅重复停顿、按意思分段用\\n、保留原话味道和方言词、绝不编造），raw 和 clean 只能是录音里真的说出来的话，一个字也不能从上下文、档案或前面的对话里补；录音只有几个字，clean 就只有那几个字。然后把它当作老人这一句来分析和回复。\n' + '输出 JSON 时把 "speech"、"raw"、"clean" 放在最前面：先只凭音频写完转写，再写回复。' }, { inlineData: { mimeType: (audio.mime || 'audio/webm').split(';')[0], data: audio.buf.toString('base64') } }] : [])],
      { system: vars(HOST_PROMPT, p, v), json: true, ...(progress && openaiEnabled() && !audio && { realtime: true, onDelta: (_delta, accumulated) => progress.update(accumulated) }), ...(audio && { timeout: +(process.env.GEMINI_FUSED_TIMEOUT_MS || 10000) }) });
}

const validNode = id => !!P.nodeById(FW, id);
// 每轮：模型同时输出 回答归属节点/层次/要点/实体/情绪 + 下一问的节点/层次 + 要朗读的话；据此更新节点状态、实体表、会话规划
// 合并调用：音频 + 上下文一次给模型，同时输出 raw/clean 转写和下一句（省掉一次往返）；失败抛 FUSED，调用方回退两步流程
export const FUSED_FAIL = 'fused-failed';
export const NO_SPEECH = 'no-speech';
// 合并调用偶尔会把上下文“补”进转写：按录音时长估一个字数上限（老人语速一般 ≤ 6 字/秒），超了就不信，回退两步
export const plausible = (text, durMs) => !durMs || String(text || '').replace(/[\s，。,.！!？?…、；;：:"“”]/g, '').length <= durMs / 1000 * 6 + 6;
const FIRST_RULE = 'say 直接接着问或继续听，不必另加一句复述。不要假定老人听过尚未播放或被打断的问题。';
export const FORGOT_RE = /记不(太)?清|想不起|忘了|不记得|不知道/;
// 服务端兜底：一次只问一个问题（第二个问号之后全截掉）
export const oneQuestion = t => { const m = String(t || '').match(/^[^？?]*[？?]/); return m ? m[0] : String(t || ''); };
// 记不清：模型没安抚就补固定安抚话术
export const soothe = (t, said, q = CONCRETE[0]) => { if (!FORGOT_RE.test(said || '')) return t;
  let x = /没关系|不要紧|不着急/.test(t || '') ? String(t || '') : '没关系。' + String(t || '').replace(/^[^，。]*(记不清|想不起)[^。]*。/, '');
  if (!/[？?]/.test(x) || VAGUE_RE.test(questionOf(x))) x = swapQuestion(x, q); return x; }; // 安抚后必须跟一个具体小问题
// 换话题这一轮：只留模型“接住”的部分，候选由服务端念（与卡片一致）
// 泛问检测与具体小问题兜底（画面/物件，好答）
export const VAGUE_RE = /(日子|生活|那时候|那会儿|当时)?(过得)?(怎么样|如何)[？?]|感觉怎么样|觉得怎么样|什么感受|心里(怎么样|什么滋味)|还有什么想(说|聊)/;
export const CONCRETE = ['这件事，您想从哪一段讲起？', '那一段里，您还记得哪个细节？', '接下来发生了什么？', '当时您先注意到了什么？', '关于这件事，您还记得谁说过什么？', '您刚才提到的那一刻，发生了什么？'];
export const concreteQ = (n, avoid = []) => CONCRETE.filter(q => !avoid.some(a => sim(a, q) > 0.5))[n % CONCRETE.length] || CONCRETE[n % CONCRETE.length];
// 相似度：二字组 Dice 系数（去标点）；≥0.6 视为原样复述
const bg = t => { const x = String(t || '').replace(/[\s，。,.！!？?…、；;：:“”"呀啊呢吗吧]/g, ''); const a = []; for (let i = 0; i < x.length - 1; i++) a.push(x.slice(i, i + 2)); return a; };
export function sim(a, b) { const A = bg(a), B = bg(b); if (!A.length || !B.length) return 0; const m = new Map(); A.forEach(x => m.set(x, (m.get(x) || 0) + 1)); let k = 0; for (const x of B) if (m.get(x) > 0) { k++; m.set(x, m.get(x) - 1); } return 2 * k / (A.length + B.length); }
export const questionOf = t => (String(t || '').match(/[^。！!？?]*[？?]/) || [''])[0];
export const echoes = (say, refs) => { const q = questionOf(say); return !!q && refs.some(r => r && sim(q, r) >= 0.6); };
// 把 say 里的问题句换成 q（保留前面接住的部分）
export const swapQuestion = (say, q) => { const k = String(say).search(/[^。！!？?]*[？?]/); return (k >= 0 ? String(say).slice(0, k) : String(say)) + q; };
export const keepAck = t => String(t || '').replace(/(接下来|咱们聊聊哪|您想聊哪|想聊哪|下面|第一个[，,])[\s\S]*$/, '').replace(/[^。！!]*[？?]\s*$/, '').trim();
// Drafts follow actual provider characters; only checked complete sentences
// enter the voice queue. A draft may revise its unspoken tail, never a stable
// prefix already offered for playback. Explicit topic switches stay buffered.
export function hostProgress(p, c, turns, onReply, onDraft) {
  const last = turns.at(-1), ask = c.plan.ask, count = turns.filter(t => !t.continuation).length;
  const short = (last?.clean || '').replace(/[\s，。,.！!？?…、]/g, '').length < 8 || /不知道|忘了|想不起/.test(last?.clean || '');
  const progress = { text: '', controls: null, draft: '', rawDraft: '',
    preview(text, ask) {
      const visible = text.startsWith(this.text) ? text : this.text;
      if (visible === this.draft) return;
      this.draft = visible; onDraft?.(visible, { ask, phase: 'chat' });
    },
    emit(text, ask) {
      if (!text || text === this.text) return;
      if (!text.startsWith(this.text)) return;
      this.text = text; this.ask = ask; onReply?.(text, { ask, phase: 'chat' });
      this.preview(this.rawDraft, ask);
    },
    update(json) {
      const partial = topLevelJSON(json);
      if (partial.text === undefined || !partial.fields.ask || typeof partial.fields.done !== 'boolean') return;
      this.controls = partial.fields;
      const nextAsk = partial.fields.ask, done = partial.fields.done || count >= 10;
      const nA = validNode(nextAsk.nodeId) ? { nodeId: nextAsk.nodeId, depth: Math.max(1, Math.min(4, +nextAsk.depth || 1)) } : { ...ask };
      // A known node can be displayed before its attribution finishes because
      // this text is not yet audible. Never display metadata or a switch's
      // speculative question as if it had already passed the speaking guards.
      if (nextAsk.nodeId !== 'switch' && (validNode(nextAsk.nodeId) || done)) {
        this.rawDraft = done ? say(partial.text) : oneQuestion(say(partial.text));
        this.preview(this.rawDraft, nA);
      }
      // A menu decision is finalized after analysis, even in elder-led mode.
      if (!done && nextAsk.nodeId === 'switch') return;
      if (!done && !c.plan.free && nextAsk.nodeId !== ask.nodeId && (!validNode(nextAsk.nodeId) || partial.fields.answer?.nodeId !== nextAsk.nodeId)) return;
      if (!done && FORGOT_RE.test(last?.clean || '') && !partial.complete) return;
      const matches = [...partial.text.matchAll(/[。！？!?]/g)];
      const end = partial.complete ? partial.text.length : matches.at(-1)?.index + 1;
      if (!end) return;
      let candidate = say(partial.text.slice(0, end));
      if (!done) {
        const refs = [P.questionFor(FW, nA.nodeId, nA.depth || 1, p), questionOf(last?.q), P.questionFor(FW, ask.nodeId, ask.depth, p)];
        if (echoes(candidate, refs) || ((short || FORGOT_RE.test(last?.clean || '')) && VAGUE_RE.test(questionOf(candidate)))) candidate = swapQuestion(candidate, concreteQ(count, refs));
        candidate = oneQuestion(soothe(candidate, last?.clean, concreteQ(count)));
      }
      this.emit(candidate, nA);
    },
  };
  return progress;
}

export async function nextTurn(p, c, turns, sessionId, { audio, onReply, onDraft } = {}) {
  const MAX = 10, last = turns.at(-1), ask = c.plan.ask, turnCount = turns.filter(t => !t.continuation).length;
  let r0 = null, streamInterrupted = false;
  const progress = (onReply || onDraft) && !audio ? hostProgress(p, c, turns, onReply, onDraft) : null;
  if (audio) { const real = last.clean; last.clean = '（见附带的录音）';
    try { r0 = await nextGemini(p, c, turns, audio); } catch (e) { r0 = null; } last.clean = real;
    if (r0 && (r0.speech === false || !(r0.clean || r0.raw))) throw new Error(NO_SPEECH);
    if (!r0 || !(r0.clean || r0.raw) || !r0.say || !plausible(r0.raw || r0.clean, audio.durMs)) throw new Error(FUSED_FAIL);
    last.raw = r0.raw || r0.clean; last.clean = r0.clean || r0.raw; }
  const short = (last?.clean || '').replace(/[\s，。,.！!？?…、]/g, '').length < 8 || /不知道|忘了|想不起/.test(last?.clean || '');
  const second = c.plan.nodes[c.plan.currentNodeIndex + 1];
  let r = r0, source = r0 ? 'gemini-fused' : progress && openaiEnabled() ? 'openai-stream' : 'gemini';
  if (!r) try {
    r = await nextGemini(p, c, turns, null, progress);
    if (!r?.say) throw new Error('empty');
  } catch (e) {
    if (/未替换的变量/.test(e.message)) console.warn('[vars]', e.message);
    if (progress?.text) { streamInterrupted = true; source = 'stream-interrupted'; r = { ...progress.controls, ask: progress.ask || ask, done: false, say: progress.text, action: '留白' }; }
    else { r = null; source = 'fallback'; }
  }
  // A model's label cannot override a concrete subject the person just gave.
  // Buffering switch replies above means this repair never replaces spoken audio.
  if (r?.ask?.nodeId === 'switch' && !requestsChoices(p, last?.clean || last?.raw) && !r.done) {
    r = { ...r, ask, action: '澄清', say: '刚才我没接准。您接着讲这件事。' };
  }
  // 0) 改口：老人主动要求别的叫法（模型给 callName，或规则从原话识别），当场生效
  const newCall = (typeof r?.callName === 'string' && r.callName.trim() && r.callName.trim() !== p.callName ? r.callName.trim().slice(0, 8) : null) || (() => { const c = detectCallName(last?.clean); return c && c !== p.callName ? c : null; })();
  if (newCall) p = { ...p, callName: newCall, callNameBy: 'elder' };
  // 1) 回答归属与状态
  // A stale reference topic must not turn an unnamed teammate into a spouse.
  // With no model attribution, free conversation only retains explicit mentions.
  const rule = P.ruleAnalyze(FW, last?.clean || '', c.plan.free ? null : ask, p);
  const unclassified = (r?.answer && !validNode(r.answer.nodeId)) || (c.plan.free && !r?.answer);
  const an = unclassified ? { ...(r?.answer || rule), nodeId: null, depth: Math.max(0, Math.min(4, +r?.answer?.depth || 0)) } : r?.answer && validNode(r.answer.nodeId) ? { ...r.answer, depth: Math.max(0, Math.min(4, +r.answer.depth || 0)) } : rule;
  const emotion = r?.emotion || rule.emotion;
  const upd = unclassified ? { states: c.states, leave: null } : P.applyAnswer(FW, c.states, { nodeId: an.nodeId, depth: an.depth, note: an.note, short, emotion, leave: r?.leave || null }, sessionId);
  let states = upd.states; const entities = P.mergeEntities(c.entities, an.entities || [], an.nodeId, sessionId);
  // 当前节点是否聊够（跑题时当前节点也可能因连续简短等聊够）
  const curS = P.st(states, ask.nodeId), leave = an.nodeId === ask.nodeId ? upd.leave : (curS.depth >= 4 ? 'deep' : null);
  // 2) 规划推进
  let plan = { ...c.plan }, text, done;
  let sw = false;
  if (r && r.ask?.nodeId === 'switch' && requestsChoices(p, last?.clean || last?.raw)) { sw = true; text = say(r.say); done = turnCount >= MAX; }
  else if (r) {
    const nA = r.ask && validNode(r.ask.nodeId) ? { nodeId: r.ask.nodeId, depth: Math.max(1, Math.min(4, +r.ask.depth || 1)) } : ask;
    if (requestsChoices(p, last?.clean || last?.raw) && nA.nodeId !== ask.nodeId && nA.nodeId !== an.nodeId && leave !== 'upset' && !r.done && turnCount < MAX) { // 模型想换话题：不直接跳，交给老人选
      sw = true; text = say(r.say); done = false;
    } else {
    const k = plan.nodes.findIndex(x => x.nodeId === nA.nodeId);
    if (k > plan.currentNodeIndex) plan.currentNodeIndex = k;
    plan.ask = nA; text = say(r.say); done = !!r.done || turnCount >= MAX;
    }
  } else if (plan.free) {
    done = turnCount >= MAX || P.parseChoice(FW, last?.clean || last?.raw || '', [], p, { after: true }).action === 'end';
    text = done ? null : '刚才回复没接上。您接着讲这件事。';
  } else {
    const nx = P.nextAsk(FW, plan, states, leave);
    if (leave !== 'upset' && leave !== 'tired' && turnCount < 5 && (nx.currentNodeIndex !== plan.currentNodeIndex || nx.done)) sw = true; // 聊够了：让老人自己选下一个
    else plan = nx;
    done = !sw && (plan.done || turnCount >= 5);
    const sad = emotion === '难过', forgot = /卡壳/.test(emotion);
    const pre = sad ? '您慢慢说。' : forgot ? '没关系。' : '';
    text = done ? null : sw ? '好，咱们换个话题。' : say(pre + P.questionFor(FW, plan.ask.nodeId, plan.ask.depth, p));
  }
  if (r && text && !done && !sw) { // 服务端把关：不原样复述计划问题/上一轮问题；短答、记不清后不泛问
    const prevQ = questionOf(turns.at(-1)?.q), planQ = P.questionFor(FW, plan.ask.nodeId, plan.ask.depth, p), refs = [planQ, prevQ, P.questionFor(FW, ask.nodeId, ask.depth, p)];
    const bad = t => echoes(t, refs) || ((short || FORGOT_RE.test(last?.clean || '')) && VAGUE_RE.test(questionOf(t)));
    if (bad(text)) { text = swapQuestion(text, concreteQ(turnCount, refs)); console.log('[turn] repeated-question locally replaced'); } }
  if (r && text && !done) text = sw ? keepAck(text) : oneQuestion(soothe(text, last?.clean, concreteQ(turnCount)));
  if (done) { plan.done = true; if (!r) text = closing(p, { ...c, states, entities, plan }); }
  if (progress?.text && (streamInterrupted || !String(text || '').startsWith(progress.text))) {
    // A malformed/failed tail cannot replace a sentence already shown/spoken.
    text = progress.text; streamInterrupted = true; sw = false; done = false;
    plan = { ...c.plan, ask: progress.ask || ask, done: false };
  }
  return { streamInterrupted, emotion, action: r?.action || (done ? '收尾' : leave ? '过渡' : '追问细节'), say: text, done, source, analysis: { ...an, short, leave }, plan, states, entities, callName: newCall, switch: sw && !done };
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
    if (r.people) return { ...r, seedVersion: a.seedVersion, asked, updatedAt: Date.now(), source: 'gemini' }; // 种子版本由服务端保留，不由模型改写。
  } catch {}
  const m = { seedVersion: a.seedVersion, people: a.people || [], places: a.places || [], events: a.events || [], timeline: a.timeline || [], conflicts: a.conflicts || [] };
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
