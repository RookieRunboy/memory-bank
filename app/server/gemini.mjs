// Gemini 封装：key 只在后端读取（优先环境变量 GEMINI_API_KEY，本地开发可用 .env.local，不存在也不报错），绝不下发前端/打印
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let KEY = process.env.GEMINI_API_KEY;
try { KEY ||= fs.readFileSync(path.join(root, '.env.local'), 'utf8').match(/^GEMINI_API_KEY=(.*)$/m)?.[1]?.trim(); } catch {}
// 模型链（环境变量可配，逗号分隔回退顺序）：任一调用失败依次回退
const list = (v, d) => (v || d).split(',').map(x => x.trim()).filter(Boolean);
export const CHAINS = {
  fast: [process.env.GEMINI_MODEL_FAST || 'gemini-3-flash-preview', ...list(process.env.GEMINI_MODEL_FAST_FALLBACKS, 'gemini-3.5-flash')], // 转写整理 + 实时访谈
  story: [process.env.GEMINI_MODEL_STORY || 'gemini-3-flash-preview', ...list(process.env.GEMINI_MODEL_STORY_FALLBACKS, 'gemini-3.5-flash')], // 结束页故事：要几秒内出来
  pro: [process.env.GEMINI_MODEL_PRO || 'gemini-3.1-pro-preview', ...list(process.env.GEMINI_MODEL_PRO_FALLBACKS, 'gemini-3-flash-preview')], // 故事 + 记忆档案
};
export const MODELS = CHAINS;
const redact = s => (KEY ? String(s).split(KEY).join('<KEY>') : String(s));
export const status = { ok: null, lastError: null, models: CHAINS, hasKey: !!KEY };
export async function gemini(parts, opts = {}) { // opts.tier: 'fast' | 'pro'
  const chain = CHAINS[opts.tier || 'fast']; let err;
  const o = { ...opts, timeout: opts.timeout || (opts.tier === 'pro' ? +(process.env.GEMINI_PRO_TIMEOUT_MS || 30000) : opts.tier === 'story' ? +(process.env.GEMINI_STORY_TIMEOUT_MS || 20000) : +(process.env.GEMINI_FAST_TIMEOUT_MS || 8000)) }; // 实时对话超时即回退更快的模型
  for (const m of chain) { try { return await call(m, parts, o); }
    catch (e) { err = e; console.warn('[gemini]', m, '失败', redact(e.message).slice(0, 120), '→ 回退'); } }
  throw err;
}
async function call(MODEL, parts, { system, json = false, timeout = 30000, temperature = 0.7 } = {}) {
  if (!KEY) throw new Error('未配置 GEMINI_API_KEY');
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(`https://aiplatform.googleapis.com/v1/publishers/google/models/${MODEL}:generateContent?key=${encodeURIComponent(KEY)}`, {
      method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(system && { systemInstruction: { parts: [{ text: system }] } }), contents: [{ role: 'user', parts }],
        generationConfig: { temperature, thinkingConfig: { thinkingLevel: 'low' }, ...(json && { responseMimeType: 'application/json' }) } }) });
    const j = await r.json();
    if (!r.ok) throw new Error(`HTTP ${r.status} ${j.error?.status || ''} ${j.error?.message || ''}`);
    const text = j.candidates?.[0]?.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('') || '';
    status.ok = true; status.lastError = null; status.lastModel = MODEL;
    return json ? JSON.parse(text.replace(/^\s*```(json)?|```\s*$/g, '')) : text.trim();
  } catch (e) { status.ok = false; status.lastError = redact(e.message).slice(0, 200); throw e; }
  finally { clearTimeout(t); }
}

// Gemini TTS（同一 Vertex express 端点）：返回 24kHz 单声道 16bit PCM（audio/L16），由 tts.mjs 加 WAV 头
export async function ttsCall(MODEL, text, voice, timeout = 8000) {
  if (!KEY) throw new Error('未配置 GEMINI_API_KEY');
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(`https://aiplatform.googleapis.com/v1/publishers/google/models/${MODEL}:generateContent?key=${encodeURIComponent(KEY)}`, {
      method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } }) });
    const j = await r.json();
    if (!r.ok) throw new Error(`HTTP ${r.status} ${j.error?.status || ''} ${redact(j.error?.message || '')}`);
    const d = j.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData;
    if (!d?.data) throw new Error('TTS 无音频');
    return { pcm: Buffer.from(d.data, 'base64'), mime: d.mimeType };
  } finally { clearTimeout(t); }
}
