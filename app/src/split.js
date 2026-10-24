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
