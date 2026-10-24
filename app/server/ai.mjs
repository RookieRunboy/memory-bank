// 访谈 Agent / 转写整理 / 故事 / 记忆档案。每个函数先走 Gemini，失败回退规则+演示数据。
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { gemini } from './gemini.mjs';
import { QUESTION_BANK, SCRIPT, DEMO_ANSWERS, fill } from '../src/questions.js';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const md = fs.readFileSync(path.join(root, '../docs/interview.md'), 'utf8');
const blocks = [...md.matchAll(/```\n([\s\S]*?)```/g)].map(m => m[1]);
export const HOST_PROMPT = blocks[0], STORY_PROMPT = blocks[1]; // interview.md 主持人提示词全文 / 故事提示词全文
const vars = (t, p) => fill(t, p).replace(/\{重要人物\}/g, p.people || '无');
const archText = a => JSON.stringify({ 人物: a.people, 地点: a.places, 事件: a.events, 时间线: a.timeline, 上次聊到: a.lastTopic, 已问过: (a.asked || []).slice(-30) }, null, 0);
const histText = turns => turns.map(t => `小忆：${t.q}\n老人：${t.clean || t.raw || '（没说话）'}`).join('\n');
const isDemo = turns => turns.some(t => DEMO_ANSWERS.includes(t.clean || t.raw));

function nextFixed(p, a, turns) { // 兜底：固定问题库里下一道没问过的题
  const asked = new Set([...(a.asked || []), ...turns.map(t => t.qid)]);
  const bank = QUESTION_BANK[p.stage] || QUESTION_BANK['童年'];
  const i = bank.findIndex((_, k) => !asked.has(`${p.stage}-${k}`));
  return i < 0 ? null : { qid: `${p.stage}-${i}`, text: fill(bank[i], p) };
}

export async function opening(p, a, isReturn) {
  try {
    const r = await gemini([{ text: `【记忆档案（以往访谈积累）】${archText(a)}\n${isReturn ? '这是第二次及以后的访谈：开场先亲切提起上次聊到的具体细节（人、地、物），让老人感到被记得，再顺着那个话题问一个新的小细节。' : '这是第一次访谈，按【开场】说。'}\n只输出 JSON：{"say":"要朗读的话（最多三句）"}` }], { system: vars(HOST_PROMPT, p), json: true });
    if (r.say) return { say: r.say, source: 'gemini' };
  } catch {}
  const q = nextFixed(p, a, []);
  if (isReturn && a.lastTopic) return { say: fill(`{称呼}，您好呀，我是小忆。上次您跟我讲了${a.lastTopic.replace(/^(上次)?(您)?(跟我)?(讲了|提到|说到|说)?/, '').replace(/[。.，,！!]+$/, '')}，我一直记着呢。今天咱们接着聊，${q ? q.text : '您再跟我说说那时候的事？'}`, p), qid: q?.qid, source: 'fallback' };
  return { say: fill(SCRIPT.opening, p) + (q ? q.text : ''), qid: q?.qid, source: 'fallback' };
}

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

export async function nextTurn(p, a, turns) {
  const MAX = 10;
  try {
    const r = await gemini([{ text: `【记忆档案】${archText(a)}\n【本次对话】\n${histText(turns)}\n\n请按【说话方式】【必须遵守】决定下一句：先判断老人情绪(开心/卡壳/难过/累了/平静)，再决定动作(追问细节/给台阶/安抚/换话题/收尾)。已经聊了${turns.length}轮，满${MAX}轮或老人累了就用【结束】话术收尾。不要重复问记忆档案里已问过的。只输出 JSON：{"emotion":"","action":"","say":"要朗读的话","done":false}` }], { system: vars(HOST_PROMPT, p), json: true });
    if (r.say) return { ...r, done: !!r.done || turns.length >= MAX, source: 'gemini' };
  } catch {}
  const last = turns.at(-1)?.clean || '';
  const sad = /走了|去世|想他|想她|难过/.test(last), forgot = /想不起|不记得|忘了/.test(last);
  const q = turns.length >= 5 ? null : nextFixed(p, a, turns);
  if (!q) return { emotion: '平静', action: '收尾', say: fill(SCRIPT.closing, p), done: true, source: 'fallback' };
  const pre = sad ? '听得出来，您很想他。' : forgot ? SCRIPT.forgot.replace('咱们聊点别的。', '') : fill(SCRIPT.acks[turns.length % 3], p);
  return { emotion: sad ? '难过' : forgot ? '卡壳' : '平静', action: sad ? '安抚' : forgot ? '给台阶' : '追问细节', say: pre + q.text, qid: q.qid, done: false, source: 'fallback' };
}

const DEMO_STORY = { title: '他说我跟桂花糕一样甜', body: '我是在纺织厂认识老李的。他是修机器的，一身机油味。\n\n头一回见他，傻乎乎的，脸一红就不会说话了。哈哈。\n\n那时候谈对象，我们去瘦西湖，他骑自行车带我。那是哪一年来着，我想不起来了。只记得是春天，柳树都绿了。\n\n他给我买过一包桂花糕，说扬州最甜的就是这个，跟我一样甜。\n\n他走了好多年了。这些事，我讲给小梅听，也讲给孙子听。', people: '李建国（老伴）；小梅（女儿）', timePlace: '江苏扬州，纺织厂、瘦西湖', quotes: '“他说扬州最甜的就是这个，跟我一样甜。”' };
const parse = t => { const g = k => (t.match(new RegExp(k + '[：:]\\s*([\\s\\S]*?)(?=\\n(标题|正文|关键人物|时间地点|原话摘录)[：:]|$)')) || [])[1]?.trim();
  return { title: g('标题') || '我的记忆', body: g('正文') || t, people: g('关键人物'), timePlace: g('时间地点'), quotes: g('原话摘录') }; };
export async function story(p, turns) {
  try { const t = await gemini([{ text: vars(STORY_PROMPT, p).replace('{转录文本}', histText(turns)) }], { tier: 'pro', timeout: 60000 }); return { ...parse(t), source: 'gemini' }; } catch {}
  if (isDemo(turns) && turns.length >= 4 && turns[0].clean === DEMO_ANSWERS[0]) return { ...DEMO_STORY, source: 'fallback' };
  const said = turns.map(t => t.clean).filter(Boolean);
  return { title: `${p.hometown || '老家'}的那些年`, body: said.join('\n\n') || '这一次，我们只是慢慢地坐了一会儿。', quotes: said[0] ? `“${said[0]}”` : '', source: 'fallback' };
}

export async function updateArchive(p, a, turns, stage) {
  const asked = [...(a.asked || []), ...turns.map(t => t.qid).filter(Boolean)];
  try {
    const r = await gemini([{ text: `你在维护老人${p.name}的「记忆档案」。现有档案：${JSON.stringify(a)}\n本次访谈（阶段：${stage}）：\n${histText(turns)}\n\n把本次老人说的新信息合并进档案，只记老人说过的，不编造；前后矛盾并列保留不纠正。输出 JSON：{"people":[{"name":"","relation":"","note":""}],"places":[{"name":"","note":""}],"events":[{"title":"","when":"","detail":""}],"timeline":[{"when":"","what":""}],"lastTopic":"下次开场可提起的上次话题，一句口语，如：您和李爷爷骑自行车去瘦西湖、他给您买桂花糕","conflicts":[""]}` }], { json: true, tier: 'pro', timeout: 60000 });
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
    return { ...m, asked, lastTopic: '李爷爷骑自行车带您去瘦西湖，还给您买了一包桂花糕', updatedAt: Date.now(), source: 'fallback' };
  }
  turns.filter(t => t.clean).forEach(t => add(m.events, { title: t.clean.slice(0, 16), when: stage, detail: t.clean }, 'title'));
  const last = turns.filter(t => t.clean).at(-1)?.clean;
  return { ...m, asked, lastTopic: last ? `“${last.slice(0, 24)}”` : a.lastTopic, updatedAt: Date.now(), source: 'fallback' };
}
