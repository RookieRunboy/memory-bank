// 朗读分句：前后端共用（后端按句缓存 TTS，前端按句播放）
// 按句切分（。！？；换行），太短的并到上一句，太长的在逗号处再切
export function splitSentences(text, max = 40) {
  const raw = String(text || '').replace(/\s+/g, ' ').match(/[^。！？!?；;\n]+[。！？!?；;]*/g) || [];
  const out = [];
  for (let s of raw.map(x => x.trim()).filter(x => x.replace(/[。！？!?；;，,、…\s]/g, ''))) {
    while (s.length > max) { const k = s.lastIndexOf('，', max); if (k < 8) break; out.push(s.slice(0, k + 1)); s = s.slice(k + 1); }
    if (out.length && s.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').length <= 3) out[out.length - 1] += s; else out.push(s);
  }
  return out;
}

// 老人一说完就播的短回应（预热缓存，轮换、不连续重复）；正式回复不要再重复这类意思
export const ACKS = ['嗯，我听着呢。', '哦，是这样啊。', '嗯嗯，我记下了。', '嗯，明白了。', '哎，好。', '嗯，我在听。', '哦，原来这样。'];
export function pickAck(prev, rnd = Math.random) { const pool = ACKS.filter(a => a !== prev); return pool[Math.floor(rnd() * pool.length) % pool.length]; }
// 首句太长时在第一个逗号处先断开，让第一段尽快合成、先播
export const firstShort = (parts, max = 12) => { const f = parts[0] || '', k = f.search(/[，,]/); return f.length > max && k >= 2 && k < max ? [f.slice(0, k + 1), f.slice(k + 1), ...parts.slice(1)] : parts; };
