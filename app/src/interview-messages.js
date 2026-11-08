// Display projection only. Original recordings and stored transcripts stay in
// their existing storage layers; interim text never becomes an archived quote.
const textOf = (...values) => values.find(value => typeof value === 'string' && value.trim())?.trim() || '';
const prefixed = (role, id) => String(id).startsWith(role + ':') ? String(id) : `${role}:${id}`;
const yes = value => value === true || value === 'true';
const NO_TRANSCRIPT = '这段语音暂未识别出文字。';

export const userId = input => prefixed('user', input.utteranceId || input.clientTurnId || input.id);

export class InterviewMessages {
  constructor(snapshot = {}) {
    this.items = [];
    this.revision = 0;
    this.byId = new Map();
    this.parts = new Map();
    this.finished = new Set();
    const rows = snapshot.transcript?.length ? snapshot.transcript : snapshot.turns || [];
    const projected = new Map((snapshot.turns || []).map(turn => [turn.id, turn]));
    let previousQuestion = null;
    for (const [index, row] of rows.entries()) {
      const question = textOf(row.question, row.q);
      const unheard = /(?:^|:)(?:unheard|unknown)$/i.test(row.questionId || '') || /^(?:[（(].*尚未提问.*[）)]|unknown|unheard)$/i.test(question);
      if (question && !unheard) {
        const id = row.questionId || (previousQuestion?.text === question ? previousQuestion.id : `history-question:${index}`);
        this.assistant(id, question);
        previousQuestion = { id, text: question };
      }
      const projection = projected.get(row.id);
      const pending = (yes(row.deferred) || yes(row.continuation)) && !(projection?.finalizedBy || projection?.continuation === false);
      const input = { ...row, id: row.id || `history-user:${index}`, continuation: pending };
      // clean is only a compatibility fallback for historical records that did
      // not store raw; live responses below never substitute a rewritten quote.
      this.resolve(input, { transcript: { raw: textOf(row.raw, row.clean) }, deferred: pending });
    }
    const responseId = snapshot.responseId || `${snapshot.id || 'interview'}:current`;
    // Audio cancellation (mute, pause, leave) says nothing about visible text.
    // Only an explicit display marker can suppress a never-shown late reply.
    const notDisplayed = (snapshot.events || []).some(event => event.responseId === responseId && event.displayed === false);
    const partial=(snapshot.events||[]).findLast(event=>event.responseId===responseId&&event.type==='playback-suppressed'&&event.displayed===true&&event.question);
    if (!notDisplayed) this.assistant(responseId, textOf(partial?.question,snapshot.say, snapshot.opening?.say),partial?'interrupted':'final');
  }

  upsert(id, role, text, status) {
    const existing = this.byId.get(id);
    if (existing) {
      if (existing.text !== text || existing.status !== status) {
        existing.text = text; existing.status = status; this.revision++;
      }
      return existing;
    }
    const item = { id, role, text, status };
    this.items.push(item); this.byId.set(id, item); this.revision++;
    return item;
  }

  assistant(id, text, status='final') {
    if (!textOf(text)) return null;
    return this.upsert(prefixed('assistant', id), 'assistant', text, status);
  }

  user(id, text, status = 'pending') {
    return this.upsert(prefixed('user', id), 'user', String(text || ''), status);
  }

  remove(id) {
    const item = this.byId.get(id);
    if (!item) return false;
    this.items.splice(this.items.indexOf(item), 1);
    this.byId.delete(id); this.parts.delete(id); this.finished.delete(id); this.revision++;
    return true;
  }

  resolve(input, response = {}) {
    const id = userId(input);
    let parts = this.parts.get(id);
    if (!parts) { parts = new Map(); this.parts.set(id, parts); }
    if (!yes(input.finalizeContinuation)) {
      const key = input.clientTurnId || input.id || id;
      let text = textOf(response.transcript?.raw, response.heard, input.manual, input.displayText);
      // Offline topic selection returns cumulative heard, whereas normal ASR
      // returns one segment. Strip only the exact known prefix in that case;
      // repeated raw words in two actual segments must remain repeated.
      const prior = [...parts.entries()].filter(([partId]) => partId !== key).map(([, part]) => part).filter(Boolean).join('\n');
      if (!response.transcript && input.utteranceId && prior && text.startsWith(prior + '\n')) text = text.slice(prior.length + 1);
      // A retry has the same stable key. Its update cannot append another copy.
      parts.set(key, text);
    }
    if (!yes(input.continuation) && !response.deferred) this.finished.add(id);
    const text = [...parts.values()].filter(Boolean).join('\n') || NO_TRANSCRIPT;
    return this.user(id, text, this.finished.has(id) ? 'final' : 'pending');
  }
}
