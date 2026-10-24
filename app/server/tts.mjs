// 小忆语音：Gemini TTS（声音 Kore），按 模型+声音+语气前缀+文本 哈希缓存到 DATA_DIR/tts；失败/超时由前端退回浏览器朗读
import fs from 'fs'; import path from 'path'; import crypto from 'crypto';
import { ttsCall } from './gemini.mjs'; import { splitSentences } from '../src/split.js';
export { splitSentences };
export const TTS = {
  model: process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-lite-preview-tts', // 实测 lite 比 flash 快约 1 秒
  fallback: process.env.GEMINI_TTS_FALLBACK ?? 'gemini-2.5-flash-tts',
  voice: process.env.GEMINI_TTS_VOICE || 'Kore',
  timeout: +(process.env.GEMINI_TTS_TIMEOUT_MS || 8000),
  prefix: process.env.GEMINI_TTS_PREFIX ?? '像一个开朗、亲切的年轻电台主播在和长辈聊天，语气自然有起伏，带点笑意，语速正常偏快，不要拖音：',
};
// 24kHz 单声道 16bit PCM → WAV
export function wavHeader(pcm, rate = 24000, ch = 1, bits = 16) {
  const h = Buffer.alloc(44), br = rate * ch * bits / 8;
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(ch, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(br, 28); h.writeUInt16LE(ch * bits / 8, 32); h.writeUInt16LE(bits, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
export const rateOf = mime => +(String(mime).match(/rate=(\d+)/)?.[1] || 24000);
export const cacheKey = (text, o = TTS) => crypto.createHash('sha256').update([o.model, o.voice, o.prefix, text].join('\u0000')).digest('hex').slice(0, 32);
// 带超时：到点就 reject（调用方回退），后台合成完成后仍写缓存
export const withTimeout = (p, ms) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('TTS 超时')), ms); p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); }); });
export function makeTTS(dir, o = TTS, call = ttsCall) {
  fs.mkdirSync(dir, { recursive: true }); const inflight = new Map();
  const file = t => path.join(dir, cacheKey(t, o) + '.wav');
  async function gen(text) {
    try { const r = await call(o.model, o.prefix + text, o.voice, 20000); return wavHeader(r.pcm, rateOf(r.mime)); }
    catch (e) { if (!o.fallback || o.fallback === o.model) throw e; const r = await call(o.fallback, o.prefix + text, o.voice, 20000); return wavHeader(r.pcm, rateOf(r.mime)); }
  }
  function get(text, { timeout = o.timeout } = {}) {
    const f = file(text); if (fs.existsSync(f)) return Promise.resolve({ wav: fs.readFileSync(f), cached: true });
    let p = inflight.get(f);
    if (!p) { p = gen(text).then(w => { fs.writeFileSync(f, w); return w; }).finally(() => inflight.delete(f)); inflight.set(f, p); p.catch(() => {}); }
    return withTimeout(p, timeout).then(wav => ({ wav, cached: false }));
  }
  const warm = async texts => { let n = 0; for (const t of [...new Set(texts.flatMap(x => splitSentences(x)))]) { if (fs.existsSync(file(t))) continue; try { await get(t, { timeout: 60000 }); n++; } catch {} } return n; };
  return { get, warm, file, has: t => fs.existsSync(file(t)) };
}
