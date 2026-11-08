import * as P from '../src/planner.js';

export function conversationHistory(FW, p, v, transcript = []) {
  const records = new Map(transcript.map(t => [t.id, t]));
  const turnIds = new Set(v.turns.map(t => t.id));
  const narrated = (v.opening.choices || []).filter(c => {
    if (!c.heard || turnIds.has(c.id) || ['help', 'more', 'stay', 'end'].includes(c.action)) return false;
    const cards = (c.cards || []).map(nodeId => ({ nodeId, text: P.cardText(FW, nodeId, p) }));
    return P.parseChoice(FW, c.heard, cards, p).action === 'discuss';
  }).map(c => {
    const recorded = records.get(c.id);
    return { ...recorded, id: c.id, at: recorded?.at ?? c.at,
      q: recorded?.question || '（当时的问题未记录）',
      raw: recorded?.raw || c.raw || c.heard, clean: recorded?.clean || c.clean || c.heard };
  });
  return [...narrated, ...v.turns].sort((a, b) => (a.at || 0) - (b.at || 0));
}
