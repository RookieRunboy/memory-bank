import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { sseData } from '../server/streaming-json.mjs';

test('streamed HTTP turns deliver before completion, cache results, save after disconnect and retain partial failures', { timeout: 30000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-stream-api-'));
  const preload = path.join(dir, 'provider.mjs');
  fs.writeFileSync(preload, `
  const enc=new TextEncoder();
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const frame=text=>'data: '+JSON.stringify({choices:[{index:0,delta:{content:text},finish_reason:null}]})+'\\n\\n';
  globalThis.fetch=async (_url,options)=>{
    const request=JSON.parse(options.body),prompt=request.messages?.at(-1)?.content||'';
    const match=prompt.match(/【当前节点状态】([^ ]+)/),node=match?.[1]||'child-home';
    const prefix=JSON.stringify({ask:{nodeId:node,depth:2},done:false,callName:null}).slice(0,-1)+',"say":"您慢慢说。';
    const suffix='那只柜子放在哪里？"'+',"answer":'+JSON.stringify({nodeId:node,depth:2,note:'合成测试柜子',entities:[]})+',"emotion":"平静","leave":null,"action":"追问细节"}';
    if(!request.stream)return Response.json({choices:[{message:{content:prefix+suffix}}]});
    return new Response(new ReadableStream({async start(c){
      c.enqueue(enc.encode(frame(prefix)));await wait(100);
      if(prompt.includes('模拟断流')){c.error(new Error('fixture-disconnected'));return;}
      c.enqueue(enc.encode(frame(suffix)));await wait(100);
      c.enqueue(enc.encode('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\\n\\ndata: [DONE]\\n\\n'));c.close();
    }}),{headers:{'content-type':'text/event-stream'}});
  };`);
  const child = spawn(process.execPath, ['--import', preload, 'server/index.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, DATA_DIR: dir, PORT: '0', HOST: '127.0.0.1', OPENAI_API_KEY: 'fixture', LLM_PROVIDER: 'openai', GEMINI_TTS_WARM: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode == null) { child.kill(); await once(child, 'exit'); } fs.rmSync(dir, { recursive: true, force: true }); });
  let output = '', base;
  child.stdout.on('data', x => output += x); child.stderr.on('data', () => {});
  for (let i = 0; i < 350; i++) { const match = output.match(/memory-bank on 127.0.0.1:(\d+)/); if (match) { base = 'http://127.0.0.1:' + match[1] + '/api'; break; } await delay(20); }
  assert.ok(base, 'isolated server must start');
  const post = async (url, value, streaming = false) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', ...(streaming && { Accept: 'text/event-stream' }) }, body: JSON.stringify(value) });
  const opening = await (await post('/interviews', { elderId: 'demo-wang' })).json(), url = '/interviews/' + opening.id;
  const selection = await (await post(url + '/choose', { clientTurnId: 'choice', action: 'pick', index: 0 })).json();
  const input = { clientTurnId: 'first', manual: '母亲把旧柜子擦得干干净净，里面放着棉被。', question: selection.say, questionId: selection.responseId, ask: selection.ask };
  const response = await post(url + '/turn', input, true), events = [];
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  for await (const text of sseData(response.body)) events.push(JSON.parse(text));
  assert.equal(events[0].type, 'transcript'); assert.equal(events[0].transcript.raw, input.manual);
  const replies = events.filter(e => e.type === 'reply'), final = events.at(-1);
  const drafts = events.filter(e => e.type === 'reply-draft');
  assert.ok(drafts.length > 0, 'the HTTP channel must expose actual text drafts');
  assert.ok(events.findIndex(e => e.type === 'reply-draft') < events.findIndex(e => e.type === 'reply'));
  assert.ok(drafts.every(e => e.responseId === final.result.responseId && e.ask?.nodeId && e.phase));
  assert.ok(replies.length >= 1); assert.equal(final.type, 'result');
  assert.equal(final.result.next.say, replies.at(-1).text);
  assert.ok(replies.every((e, i) => i === 0 || e.text.startsWith(replies[i - 1].text)));
  assert.ok(replies.every(e => e.responseId === final.result.responseId));
  assert.ok(replies.every(e => e.ask?.nodeId === final.result.next.ask.nodeId && e.ask.depth === final.result.next.ask.depth));
  assert.ok(replies.every(e => e.phase === final.result.next.phase));
  const cached = await post(url + '/turn', input, true), cachedEvents = [];
  for await (const text of sseData(cached.body)) cachedEvents.push(JSON.parse(text));
  assert.deepEqual(cachedEvents.map(e => e.type), ['result']); assert.equal(cachedEvents[0].cached, true);
  assert.deepEqual(cachedEvents[0].result, final.result);
  const abortInput = { ...input, clientTurnId: 'disconnect', manual: '我的那只旧柜子后来搬到楼上去了，合成测试。' };
  const disconnected = await post(url + '/turn', abortInput, true);
  for await (const text of sseData(disconnected.body)) { if (JSON.parse(text).type === 'reply') break; }
  await delay(400);
  const recovered = await (await fetch(base + url)).json();
  assert.equal(recovered.turns.filter(x => x.clientTurnId === 'disconnect').length, 1, 'disconnect must not discard accepted speech');
  const retried = await (await post(url + '/turn', abortInput)).json();
  assert.ok(retried.responseId); assert.equal((await (await fetch(base + url)).json()).turns.length, 2);
  const broken = await post(url + '/turn', { ...input, clientTurnId: 'broken', manual: '模拟断流，这仍然是一段应该留下来的完整原话。' }, true), brokenEvents = [];
  for await (const text of sseData(broken.body)) brokenEvents.push(JSON.parse(text));
  assert.ok(brokenEvents.some(e => e.type === 'error' && e.code === 'reply-interrupted' && e.recoverable));
  assert.equal(brokenEvents.at(-1).result.replyInterrupted, true);
  assert.equal(brokenEvents.at(-1).result.next.say, brokenEvents.find(e => e.type === 'reply').text);
  assert.equal((await (await fetch(base + url)).json()).transcript.filter(x => x.clientTurnId === 'broken').length, 1);
});
