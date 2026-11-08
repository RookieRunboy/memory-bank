import test from 'node:test';
import assert from 'node:assert/strict';
import { topLevelJSON, sseData } from '../server/streaming-json.mjs';
import { openaiChat } from '../server/openai.mjs';
import { hostProgress, nextTurn, FW } from '../server/ai.mjs';
import * as P from '../src/planner.js';
import { DEMO_PROFILE } from '../src/questions.js';

const encoder = new TextEncoder();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function body(parts, { gap = 0, fail = false } = {}) {
  let at = 0;
  return new ReadableStream({ async pull(controller) {
    if (gap) await delay(gap);
    if (at < parts.length) controller.enqueue(encoder.encode(parts[at++]));
    else if (fail) controller.error(new Error('fixture-disconnect'));
    else controller.close();
  } });
}
const frame = delta => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: delta }, finish_reason: null }] })}\n\n`;
const end = 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
const ctx = () => ({ plan: P.planSession(FW, { profile: DEMO_PROFILE, request: { nodeId: 'child-home' } }), archive: {}, states: {}, entities: [] });
const turns = () => [{ q: '小时候家里有什么东西？', raw: '母亲把一个旧柜子擦得很干净，里面放着家里的棉被。', clean: '母亲把一个旧柜子擦得很干净，里面放着家里的棉被。' }];
const controls = '"ask":{"nodeId":"child-home","depth":2},"done":false,"callName":null,';
const tail = ',"answer":{"nodeId":"child-home","depth":2,"note":"母亲的旧柜子","entities":[]},"emotion":"平静","leave":null,"action":"追问细节"}';
function config(t) {
  const before = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, LLM_PROVIDER: process.env.LLM_PROVIDER };
  process.env.OPENAI_API_KEY = 'stream-test'; process.env.LLM_PROVIDER = 'openai';
  t.after(() => { for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}

test('partial JSON exposes top-level say only, preserves escaped characters and fragmented surrogate pairs', () => {
  const source = '{"analysis":{"say":"private"},"ask":{"nodeId":"child-home"},"done":false,"say":"他说\\\"好\\\"。\\n\\uD83D\\uDE00"}';
  const found = topLevelJSON(source);
  assert.equal(found.text, '他说"好"。\n😀'); assert.equal(found.complete, true);
  assert.equal(found.fields.ask.nodeId, 'child-home');
  const cut = source.indexOf('\\uDE00');
  assert.equal(topLevelJSON(source.slice(0, cut)).text, '他说"好"。\n');
  assert.equal(topLevelJSON('{"analysis":{"say":"private"}').text, undefined);
  assert.equal(topLevelJSON('{"note":"\\\"say\\\":\\\"private\\\"","say":"您接着').text, '您接着');
});

test('SSE decoder accepts arbitrary byte boundaries and rejects incomplete frames', async () => {
  const bytes = encoder.encode('data: {"text":"中文"}\r\n\r\n: ping\r\n\r\ndata: [DONE]\n\n');
  const stream = new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close(); } });
  assert.deepEqual(await Array.fromAsync(sseData(stream)), ['{"text":"中文"}', '[DONE]']);
  await assert.rejects(Array.fromAsync(sseData(body(['data: {"text":"unfinished"}']))), /incomplete/);
});

test('OpenAI transport streams actual deltas before the provider completes; ignores reasoning metadata', async t => {
  config(t); const seen = [];
  const output = await openaiChat([{ text: 'fixture' }], { json: true, realtime: true, onDelta: (delta, text) => seen.push({ delta, text }), fetchImpl: async (_url, options) => {
    assert.equal(JSON.parse(options.body).stream, true);
    assert.equal(JSON.parse(options.body).response_format, undefined, 'live host must not request relay-buffered JSON mode');
    return new Response(body(['data: {"choices":[{"index":0,"delta":{"reasoning_content":"private"}}]}\n\n', frame('{"say":"您'), frame('接着说。"}'), end]), { headers: { 'content-type': 'text/event-stream' } });
  } });
  assert.equal(output.say, '您接着说。'); assert.equal(seen.length, 2);
  assert.equal(seen[0].text, '{"say":"您'); assert.ok(seen.every(x => !x.text.includes('private')));
});

test('checked sentences become visible before metadata; final reply is a monotonic extension', async t => {
  config(t); const emitted = []; let metadataSent = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ async start(c) {
    for (const delta of ['{' + controls + '"say":"您慢慢说。', '那只柜子平常放在哪里？"']) { c.enqueue(encoder.encode(frame(delta))); await delay(20); }
    metadataSent = true; c.enqueue(encoder.encode(frame(tail))); c.enqueue(encoder.encode(end)); c.close();
  } }), { headers: { 'content-type': 'text/event-stream' } }));
  const result = await nextTurn(DEMO_PROFILE, ctx(), turns(), 'fixture', { onReply: (text, meta) => emitted.push({ text, metadataSent, ask: meta.ask }) });
  assert.ok(emitted.some(x => !x.metadataSent)); assert.equal(emitted[0].text, '您慢慢说。');
  assert.deepEqual(emitted[0].ask, { nodeId: 'child-home', depth: 2 });
  assert.equal(result.say, emitted.at(-1).text);
  assert.ok(emitted.every((x, i) => i === 0 || x.text.startsWith(emitted[i - 1].text)));
});

test('repeated questions are locally replaced before any spoken text leaves the stream', () => {
  const c = ctx(), q = P.questionFor(FW, c.plan.ask.nodeId, c.plan.ask.depth, DEMO_PROFILE), emitted = [];
  const progress = hostProgress(DEMO_PROFILE, c, turns(), text => emitted.push(text));
  progress.update('{' + controls + '"say":' + JSON.stringify(q));
  assert.equal(emitted.length, 1); assert.notEqual(emitted[0], q); assert.match(emitted[0], /[？?]$/);
});

test('topic switch text stays buffered until the final server choice text is known', () => {
  const emitted = [], progress = hostProgress(DEMO_PROFILE, ctx(), turns(), text => emitted.push(text));
  progress.update('{"ask":{"nodeId":"switch"},"done":false,"say":"好，换个话题。您还记得学校吗？"');
  assert.deepEqual(emitted, []);
});

test('provider failure after a visible sentence preserves that sentence without adding a fallback question', async t => {
  config(t); const emitted = [];
  t.mock.method(globalThis, 'fetch', async () => new Response(body([frame('{' + controls + '"say":"您慢慢说。')], { fail: true }), { headers: { 'content-type': 'text/event-stream' } }));
  const result = await nextTurn(DEMO_PROFILE, ctx(), turns(), 'fixture', { onReply: text => emitted.push(text) });
  assert.equal(result.streamInterrupted, true); assert.equal(result.say, '您慢慢说。');
  assert.deepEqual(emitted, ['您慢慢说。']); assert.equal(result.switch, false);
});


test('following a newly mentioned node can stream once its answer attribution is known', () => {
  const c = ctx(), node = FW.nodes.find(n => n.id !== c.plan.ask.nodeId).id, emitted = [];
  const progress = hostProgress(DEMO_PROFILE, c, turns(), (text, meta) => emitted.push({ text, ...meta }));
  const prefix = JSON.stringify({ ask: { nodeId: node, depth: 2 }, done: false, say: '您慢慢说。' }).slice(0, -1);
  progress.update(prefix); assert.equal(emitted.length, 0);
  progress.update(prefix + ',"answer":' + JSON.stringify({ nodeId: node, depth: 2, entities: [] }) + ',');
  assert.equal(emitted.length, 1); assert.equal(emitted[0].ask.nodeId, node); assert.equal(emitted[0].phase, 'chat');
});


test('a partial failure preserves the question attribution already sent with its spoken sentence', async t => {
  config(t); const c = ctx(), node = FW.nodes.find(n => n.id !== c.plan.ask.nodeId).id, emitted = [];
  const partial = JSON.stringify({ ask: { nodeId: node, depth: 2 }, done: false, answer: { nodeId: node, depth: 2, entities: [] } }).slice(0, -1) + ',"say":"您慢慢说。';
  t.mock.method(globalThis, 'fetch', async () => new Response(body([frame(partial)], { fail: true }), { headers: { 'content-type': 'text/event-stream' } }));
  const result = await nextTurn(DEMO_PROFILE, c, turns(), 'fixture', { onReply: (text, meta) => emitted.push({ text, ...meta }) });
  assert.equal(result.streamInterrupted, true); assert.equal(emitted.length, 1);
  assert.deepEqual(result.plan.ask, emitted[0].ask);
});

test('one short question displays real provider drafts before its final punctuation is speakable', async t => {
  config(t); const timeline = [];
  t.mock.method(globalThis, 'fetch', async () => new Response(body([
    frame('{' + controls + '"say":"那只旧柜子'), frame('平常放在'), frame('屋里的什么地方？"'), frame(tail), end,
  ], { gap: 5 }), { headers: { 'content-type': 'text/event-stream' } }));
  const result = await nextTurn(DEMO_PROFILE, ctx(), turns(), 'draft-fixture', {
    onDraft: (text, meta) => timeline.push({ type: 'draft', text, ...meta }),
    onReply: (text, meta) => timeline.push({ type: 'stable', text, ...meta }),
  });
  assert.deepEqual(timeline.filter(e => e.type === 'draft').map(e => e.text), ['那只旧柜子', '那只旧柜子平常放在', '那只旧柜子平常放在屋里的什么地方？']);
  assert.deepEqual(timeline.map(e => e.type), ['draft', 'draft', 'draft', 'stable']);
  assert.equal(result.say, timeline.at(-1).text);
  assert.ok(timeline.every(e => e.ask.nodeId === 'child-home' && e.phase === 'chat'));
});

test('drafts can replace an unspoken corrected question but never roll back a stable spoken prefix', () => {
  const c = ctx(), drafts = [], stable = [], progress = hostProgress(DEMO_PROFILE, c, turns(), text => stable.push(text), text => drafts.push(text));
  const repeated = P.questionFor(FW, c.plan.ask.nodeId, c.plan.ask.depth, DEMO_PROFILE);
  const prefix = '{' + controls + '"say":"';
  progress.update(prefix + '您慢慢说。');
  progress.update(prefix + '您慢慢说。' + repeated.slice(0, 3));
  progress.update(prefix + '您慢慢说。' + repeated + '"');
  assert.equal(stable[0], '您慢慢说。'); assert.ok(stable.at(-1).startsWith(stable[0]));
  assert.notEqual(stable.at(-1), '您慢慢说。' + repeated);
  assert.equal(drafts.at(-1), stable.at(-1));
  progress.update(prefix + '原来是另一个开头。"');
  assert.equal(drafts.at(-1), stable.at(-1), 'a changed provider prefix cannot replace spoken text');
  assert.ok(drafts.every(text => text.startsWith('您慢慢说。')));
});

test('guard replacement preserves an arbitrary topic instead of inventing household details', async t => {
  config(t);
  const c = ctx(); c.plan.free = true;
  const history = [{ q: '参加黑客松时，您先做了什么？', clean: '我想不起来先做了什么。' }];
  const reply = { ask: { nodeId: 'child-home', depth: 2 }, done: false, callName: null, say: '那时候您觉得怎么样？', answer: { nodeId: 'child-home', depth: 1, entities: [] }, action: '追问细节' };
  t.mock.method(globalThis, 'fetch', async () => new Response(body([frame(JSON.stringify(reply)), end]), { headers: { 'content-type': 'text/event-stream' } }));
  const spoken = [], result = await nextTurn(DEMO_PROFILE, c, history, 'topic-guard', { onReply: text => spoken.push(text) });
  assert.ok(spoken.length); assert.equal(spoken.at(-1), result.say);
  for (const text of [...spoken, result.say]) assert.doesNotMatch(text, /家里|煤炉|灶台|家具|衣服|收音机|过年/);
});

test('free conversation buffers an unwanted menu label before spoken output and keeps the named subject', async t => {
  config(t); const c = ctx(); c.plan.free = true;
  const history = [{ q: '想聊什么？', clean: '聊我第一次参加黑客松的比赛吧。' }];
  const reply = { ask: { nodeId: 'switch', depth: 1 }, done: false, say: '好，那我们聊聊结婚那天。', answer: { nodeId: null, depth: 1, entities: [] } };
  t.mock.method(globalThis, 'fetch', async () => new Response(body([frame(JSON.stringify(reply)), end]), { headers: { 'content-type': 'text/event-stream' } }));
  const spoken = [], drafts = [], r = await nextTurn(DEMO_PROFILE, c, history, 'reject-menu', { onReply: text => spoken.push(text), onDraft: text => drafts.push(text) });
  assert.deepEqual(spoken, []); assert.deepEqual(drafts, []);
  assert.equal(r.switch, false); assert.doesNotMatch(r.say, /结婚|换个话题/);
});

test('an explicit request for other choices remains available in free conversation', async t => {
  config(t); const c = ctx(); c.plan.free = true;
  const reply = { ask: { nodeId: 'switch', depth: 1 }, done: false, say: '好，再换几个。', answer: { nodeId: null, depth: 0, entities: [] } };
  t.mock.method(globalThis, 'fetch', async () => new Response(body([frame(JSON.stringify(reply)), end]), { headers: { 'content-type': 'text/event-stream' } }));
  const spoken = [], r = await nextTurn(DEMO_PROFILE, c, [{ q: '后来呢？', clean: '换几个话题吧' }], 'requested-menu', { onReply: text => spoken.push(text) });
  assert.deepEqual(spoken, []); assert.equal(r.switch, true);
});
