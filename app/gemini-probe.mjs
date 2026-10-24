// 用法：node gemini-probe.mjs  （只读 .env.local，输出里 key 被替换）
import fs from 'fs';
const key = fs.readFileSync(new URL('.env.local', import.meta.url), 'utf8').match(/GEMINI_API_KEY=(.*)/)[1].trim();
const red = s => String(s).split(key).join('<KEY>');
for (const m of ['gemini-3-flash-preview', 'gemini-2.5-flash']) { const t = Date.now();
  try { const r = await fetch(`https://aiplatform.googleapis.com/v1/publishers/google/models/${m}:generateContent?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: '用一句中文问候老人' }] }] }) });
    const j = await r.json(); console.log(m, r.status, Date.now() - t + 'ms', red(JSON.stringify(j.candidates?.[0]?.content?.parts?.map(p=>p.text).join('') || j.error).slice(0, 200)));
  } catch (e) { console.log(m, 'ERR', red(e.message)); } }
