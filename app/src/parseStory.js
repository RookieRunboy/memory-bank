// 解析大模型输出的「标题：/正文：/关键人物：/时间地点：/原话摘录：」纯文本。前后端共用。
// 只认行首字段名；字段值为空时返回空字符串，不会吞掉下一行。
const KEYS = { 标题: 'title', 正文: 'body', 关键人物: 'people', 时间地点: 'timePlace', 原话摘录: 'quotes' };
const RE = new RegExp(`^\\s*(?:\\*\\*)?(${Object.keys(KEYS).join('|')})(?:\\*\\*)?[ \\t]*[：:][ \\t]*(.*)$`);
export function parseStory(text = '') {
  const out = {}; let cur = null;
  for (const line of String(text).replace(/\r/g, '').split('\n')) {
    const m = line.match(RE);
    if (m) { cur = KEYS[m[1]]; out[cur] = m[2] ? [m[2]] : []; }
    else if (cur) out[cur].push(line);
  }
  const r = {}; for (const k of Object.values(KEYS)) r[k] = (out[k] || []).join('\n').trim();
  if (/^无$/.test(r.people)) r.people = ''; if (/^无$/.test(r.timePlace)) r.timePlace = '';
  if (!r.title) r.title = '我的记忆'; if (!r.body) r.body = Object.keys(out).length ? '' : String(text).trim();
  return r;
}
