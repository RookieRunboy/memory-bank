import { parseStory as parse } from './parseStory.js';
import { STORY_PROMPT, fill } from './questions.js';
// 大模型调用预留：localStorage 'mb_api_key' 或 VITE_LLM_API_KEY 配置后调用 OpenAI 兼容接口（VITE_LLM_API_URL / VITE_LLM_MODEL 可改）
const API_URL = import.meta.env.VITE_LLM_API_URL || 'https://api.openai.com/v1/chat/completions';
const MODEL = import.meta.env.VITE_LLM_MODEL || 'gpt-4o-mini';
export async function generateStory(answers, profile) {
  const key = localStorage.getItem('mb_api_key') || import.meta.env.VITE_LLM_API_KEY;
  if (key) {
    try {
      const transcript = answers.map(a => `小忆：${a.question}\n${profile.callName || profile.name}：${a.text || '（未转写）'}`).join('\n');
      const r = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: fill(STORY_PROMPT, profile).replace('{转录文本}', transcript) }] }) });
      const j = await r.json(); return parse(j.choices[0].message.content);
    } catch (e) { console.warn('LLM 失败，使用演示数据', e); }
  }
  return demoStory(profile);
}
// 演示假数据：docs/interview.md 第四部分示范对话（扬州王秀兰女士，虚构）
function demoStory(p) {
  return { title: '他说我跟桂花糕一样甜',
    body: `我是在纺织厂认识老李的。他是修机器的，一身机油味。\n\n头一回见他，傻乎乎的，脸一红就不会说话了。哈哈。\n\n那时候谈对象，我们去瘦西湖，他骑自行车带我。那是哪一年来着，我想不起来了。只记得是春天，柳树都绿了。\n\n他给我买过一包桂花糕，说扬州最甜的就是这个，跟我一样甜。\n\n他走了好多年了。这些事，我讲给小梅听，也讲给孙子听。`,
    people: '李建国（老伴）；小梅（女儿）', timePlace: '江苏扬州，纺织厂、瘦西湖', quotes: '“他说扬州最甜的就是这个，跟我一样甜。”' };
}
