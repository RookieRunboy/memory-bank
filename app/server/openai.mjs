// OpenAI 协议封装（兼容中转站）：只处理纯文本的访谈/故事/档案调用，key 只在后端读取，绝不下发前端/打印
// 配置（环境变量或 .env.local）：OPENAI_API_KEY（有 key 才启用）、OPENAI_BASE_URL、OPENAI_MODEL、OPENAI_TIMEOUT_MS；LLM_PROVIDER=gemini 可强制关闭
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const env = k => process.env[k] || (() => { try { return fs.readFileSync(path.join(root, '.env.local'), 'utf8').match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim(); } catch {} })();
const cfg = () => ({ key: env('OPENAI_API_KEY'), base: (env('OPENAI_BASE_URL') || 'https://api.openai-next.com/v1').replace(/\/+$/, ''), model: env('OPENAI_MODEL') || 'gpt-5.6-sol' });
export const openaiEnabled = () => !!cfg().key && env('LLM_PROVIDER') !== 'gemini';
// 转写走 OpenAI 协议 /audio/transcriptions（whisper-1）；ASR_PROVIDER=gemini 可强制改回 Gemini 听音频
export const asrViaOpenai = () => openaiEnabled() && env('ASR_PROVIDER') !== 'gemini';
const EXT = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg' };
export async function openaiTranscribe(buf, mime, { timeout = 15000 } = {}) {
  const { key, base } = cfg(); if (!key) throw new Error('未配置 OPENAI_API_KEY');
  const type = String(mime || 'audio/webm').split(';')[0], fd = new FormData();
  fd.append('model', env('OPENAI_ASR_MODEL') || 'whisper-1'); fd.append('language', 'zh'); fd.append('response_format', 'json');
  fd.append('file', new Blob([buf], { type }), `a.${EXT[type] || 'webm'}`);
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(`${base}/audio/transcriptions`, { method: 'POST', signal: ctl.signal, headers: { Authorization: `Bearer ${key}` }, body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`HTTP ${r.status} ${j.error?.code || ''} ${j.error?.message || ''}`);
    return String(j.text || '').trim();
  } catch (e) { throw new Error(String(e.message).split(key).join('<KEY>')); }
  finally { clearTimeout(t); }
}
export async function openaiChat(parts, { system, json = false, timeout = 8000 } = {}) {
  const { key, base, model } = cfg(); if (!key) throw new Error('未配置 OPENAI_API_KEY');
  const redact = s => String(s).split(key).join('<KEY>');
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), +env('OPENAI_TIMEOUT_MS') || timeout);
  try {
    const r = await fetch(`${base}/chat/completions`, { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: parts.map(p => p.text || '').join('\n') }], ...(json && { response_format: { type: 'json_object' } }) }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(redact(`HTTP ${r.status} ${j.error?.code || ''} ${j.error?.message || ''}`));
    const text = j.choices?.[0]?.message?.content || '';
    if (!text) throw new Error('空回复');
    return json ? JSON.parse(text.replace(/^\s*```(json)?|```\s*$/g, '')) : text.trim();
  } catch (e) { throw new Error(redact(e.message)); }
  finally { clearTimeout(t); }
}
