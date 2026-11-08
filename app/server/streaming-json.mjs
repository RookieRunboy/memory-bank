// Decode only JSON string values at the top level. Nested analysis and text
// inside quoted strings can never masquerade as the host's spoken `say`.
function stringAt(source, start) {
  let text = '';
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"') return { text, end: i + 1, complete: true };
    if (ch === '\\') {
      const esc = source[++i];
      if (esc === undefined) break;
      if (esc === 'u') {
        const code = source.slice(i + 1, i + 5);
        if (code.length < 4) break;
        if (!/^[0-9a-f]{4}$/i.test(code)) return null;
        text += String.fromCharCode(parseInt(code, 16)); i += 4;
      } else {
        const decoded = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[esc];
        if (decoded === undefined) return null;
        text += decoded;
      }
    } else {
      if (ch.charCodeAt(0) < 32) return null;
      text += ch;
    }
  }
  // Do not send half of an escaped surrogate pair to the browser.
  if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  return { text, end: source.length, complete: false };
}

export function topLevelJSON(source, field = 'say') {
  source = String(source).replace(/^\s*```(?:json)?\s*/i, '');
  let at = 0; const fields = Object.create(null); let selected;
  const snapshot = () => ({ fields, ...selected });
  const space = () => { while (/\s/.test(source[at] || '') && at < source.length) at++; };
  space(); if (source[at++] !== '{') return snapshot();
  for (;;) {
    space(); if (!source[at] || source[at] === '}') return snapshot();
    if (source[at] !== '"') return snapshot();
    const key = stringAt(source, at); if (!key?.complete) return snapshot();
    at = key.end; space(); if (source[at++] !== ':') return snapshot(); space();
    const start = at;
    if (source[at] === '"') {
      const value = stringAt(source, at); if (!value) return snapshot();
      if (key.text === field) selected = { text: value.text, complete: value.complete };
      if (!value.complete) return snapshot();
      fields[key.text] = value.text; at = value.end;
    } else {
      let depth = 0, inString = false, escaped = false;
      for (; at < source.length; at++) {
        const ch = source[at];
        if (inString) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') inString = false; continue; }
        if (ch === '"') inString = true;
        else if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') { if (!depth) break; depth--; }
        else if (ch === ',' && depth === 0) break;
      }
      if (at === source.length) return snapshot();
      try { fields[key.text] = JSON.parse(source.slice(start, at)); } catch { return snapshot(); }
    }
    space(); if (source[at] !== ',') return snapshot(); at++;
  }
}

// SSE frames may split in the middle of UTF-8 characters, CRLF, or JSON. Keep
// a bounded incomplete frame and process data lines only (ignore comments).
export async function* sseData(body, { maxBuffer = 1_000_000 } = {}) {
  const reader = body.getReader(), decoder = new TextDecoder(); let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > maxBuffer) throw new Error('stream-frame-too-large');
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
        if (data) yield data;
      }
      if (done) {
        if (buffer.trim()) throw new Error('stream-incomplete-frame');
        break;
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
