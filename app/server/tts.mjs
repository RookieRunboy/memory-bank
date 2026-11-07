// 小忆语音：Gemini TTS（声音 Kore），按 模型+声音+语气前缀+文本 哈希缓存到 DATA_DIR/tts；失败/超时由前端退回浏览器朗读
import fs from 'fs'; import path from 'path'; import crypto from 'crypto';
import { ttsCall, ttsStream } from './gemini.mjs'; import { splitSentences } from '../src/split.js';
import { dsEnabled, dsCall, dsStream, DS_DEFAULTS } from './dashscope.mjs';
export const DS = dsEnabled(); // 配了阿里百炼 key 就用它（TTS_PROVIDER=gemini 可关），否则沿用 Gemini
export { splitSentences };
export const TTS = DS ? { provider: 'dashscope', model: DS_DEFAULTS.model, fallback: '', voice: DS_DEFAULTS.voice, timeout: +(process.env.TTS_TIMEOUT_MS || 8000), prefix: '' } : {
  provider: 'gemini',
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
export const is429 = e => /HTTP 429|RESOURCE_EXHAUSTED/.test(e?.message || '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 429 退避重试：delays 依次等待后重试
export async function retry429(fn, delays = [600, 1500, 4000]) { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (!is429(e) || i >= delays.length) throw e; await sleep(delays[i]); } } }
export function makeTTS(dir, o = TTS, call = DS ? dsCall : ttsCall, stream = DS ? dsStream : ttsStream) {
  fs.mkdirSync(dir, { recursive: true }); const inflight = new Map(); let live = 0, lastLive = 0;
  const busy = () => live > 0 || Date.now() - lastLive < 3000; // 有实时请求（及之后 3 秒）就暂停预热
  const track = async p => { live++; try { return await p; } finally { live--; lastLive = Date.now(); } };
  const file = t => path.join(dir, cacheKey(t, o) + '.wav');
  async function gen(text, delays = [500]) {
    try { const r = await retry429(() => call(o.model, o.prefix + text, o.voice, 20000), delays); return wavHeader(r.pcm, rateOf(r.mime)); }
    catch (e) { if (!o.fallback || o.fallback === o.model) throw e; const r = await retry429(() => call(o.fallback, o.prefix + text, o.voice, 20000), delays); return wavHeader(r.pcm, rateOf(r.mime)); }
  }
  function get(text, { timeout = o.timeout, warmup = false } = {}) {
    const f = file(text); if (fs.existsSync(f)) return Promise.resolve({ wav: fs.readFileSync(f), cached: true });
    let p = inflight.get(f);
    if (!p) { p = gen(text, warmup ? [1000, 3000, 8000, 20000] : [500]).then(w => { fs.writeFileSync(f, w); return w; }).finally(() => inflight.delete(f)); inflight.set(f, p); p.catch(() => {}); }
    return withTimeout(warmup ? p : track(p), timeout).then(wav => ({ wav, cached: false }));
  }
  const warm = async texts => { let n = 0; for (const t of [...new Set(texts.flatMap(x => splitSentences(x)))]) { if (fs.existsSync(file(t))) continue; while (busy()) await sleep(500); try { await get(t, { timeout: 90000, warmup: true }); n++; } catch {} } return n; }; // 串行、一次一句
  // 流式：缓存命中直接给 PCM；否则边合成边下发，结束后写缓存。首块前遇 429 退避重试一次
  async function* streamPCM(text, { signal } = {}) {
    const f = file(text); if (fs.existsSync(f)) { yield fs.readFileSync(f).subarray(44); return; }
    live++; const parts = [];
    try { let it, first;
      for (let i = 0; ; i++) { it = stream(o.model, o.prefix + text, o.voice, { firstTimeout: o.timeout, signal });
        try { first = await it.next(); break; } catch (e) { if (!is429(e) || i >= 1) throw e; await sleep(500); } }
      if (!first.done) { parts.push(first.value); yield first.value; }
      for await (const c of it) { parts.push(c); yield c; }
      if (parts.length && !signal?.aborted) fs.writeFileSync(f, wavHeader(Buffer.concat(parts)));
    } finally { live--; lastLive = Date.now(); } }
  return { get, warm, streamPCM, busy, file, has: t => fs.existsSync(file(t)) };
}
