// A request reserves its place before multipart parsing. Disconnecting a client
// never cancels an accepted write or releases the following finish request early.
export class InterviewQueue {
  pending = new Map();
  run(id, work) {
    const previous = this.pending.get(id) || Promise.resolve();
    const result = previous.catch(() => {}).then(work);
    const tail = result.catch(() => {});
    this.pending.set(id, tail);
    tail.finally(() => { if (this.pending.get(id) === tail) this.pending.delete(id); });
    return result;
  }
}

export const audioExtension = mime => ({ 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/webm': 'webm' }[String(mime || '').split(';')[0]] || 'webm');
export function readWav(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Invalid WAV');
  let format, pcm;
  for (let at = 12; at + 8 <= buffer.length;) {
    const size = buffer.readUInt32LE(at + 4), next = at + 8 + size;
    if (next > buffer.length) throw new Error('Truncated WAV');
    const kind = buffer.toString('ascii', at, at + 4);
    if (kind === 'fmt ') {
      if (size < 16) throw new Error('Invalid WAV format');
      format = buffer.subarray(at + 8, at + 24);
    }
    if (kind === 'data') pcm = buffer.subarray(at + 8, next);
    at = next + (size % 2);
  }
  if (!format || !pcm || format.readUInt16LE(0) !== 1 || format.readUInt16LE(14) !== 16 || !format.readUInt32LE(4) || !format.readUInt16LE(12)) throw new Error('Unsupported WAV format');
  if (pcm.length % format.readUInt16LE(12)) throw new Error('Invalid WAV alignment');
  return { format, pcm, sampleRate: format.readUInt32LE(4), durationMs: pcm.length / format.readUInt32LE(8) * 1000 };
}
export function joinWav(buffers) {
  const parts = buffers.map(readWav), format = parts[0]?.format;
  if (!format || parts.some(p => !p.format.equals(format))) throw new Error('Incompatible WAV format');
  const bytes = parts.reduce((n, p) => n + p.pcm.length, 0), result = Buffer.alloc(44 + bytes);
  result.write('RIFF'); result.writeUInt32LE(result.length - 8, 4); result.write('WAVEfmt ', 8); result.writeUInt32LE(16, 16);
  format.copy(result, 20); result.write('data', 36); result.writeUInt32LE(bytes, 40);
  let offset = 44; for (const p of parts) { p.pcm.copy(result, offset); offset += p.pcm.length; }
  return result;
}

// The original segments stay untouched. Only the derived whole-session player
// is normalized if a resumed device delivers a different PCM rate/channel count.
export function normalizeWav(buffer, targetFormat) {
  const source = readWav(buffer);
  if (source.format.equals(targetFormat)) return buffer;
  const sourceChannels = source.format.readUInt16LE(2), targetChannels = targetFormat.readUInt16LE(2);
  const targetRate = targetFormat.readUInt32LE(4), sourceFrames = source.pcm.length / (sourceChannels * 2);
  const frames = Math.round(sourceFrames * targetRate / source.sampleRate), pcm = Buffer.alloc(frames * targetChannels * 2);
  for (let i = 0; i < frames; i++) {
    const x = i * source.sampleRate / targetRate, left = Math.min(Math.floor(x), sourceFrames - 1), right = Math.min(left + 1, sourceFrames - 1), mix = x - left;
    for (let c = 0; c < targetChannels; c++) {
      const value = at => { if (targetChannels === 1 && sourceChannels > 1) { let sum = 0; for (let n = 0; n < sourceChannels; n++) sum += source.pcm.readInt16LE((at * sourceChannels + n) * 2); return sum / sourceChannels; } return source.pcm.readInt16LE((at * sourceChannels + Math.min(c, sourceChannels - 1)) * 2); };
      pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value(left) * (1 - mix) + value(right) * mix))), (i * targetChannels + c) * 2);
    }
  }
  const out = Buffer.alloc(44 + pcm.length); out.write('RIFF'); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16); targetFormat.copy(out, 20); out.write('data', 36); out.writeUInt32LE(pcm.length, 40); pcm.copy(out, 44); return out;
}
