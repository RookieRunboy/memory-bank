import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import { WebSocket } from 'ws';
import { attachRealtimeASR, getRealtimeTranscript } from '../server/realtime-asr.mjs';

async function fixture(t, { model = 'normal', limits = {}, enabled = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-asr-'));
  const script = path.join(dir, 'provider.mjs');
  fs.writeFileSync(script, `import readline from 'node:readline';
let model;
const emit = value => process.stdout.write(JSON.stringify(value)+'\\n');
for await (const line of readline.createInterface({input:process.stdin})) {
 const x=JSON.parse(line);
 if(x.type==='start') { model=x.model;if(model==='silent')continue;if(model==='error'){process.stderr.write(process.env.DASHSCOPE_API_KEY);emit({type:'error',code:'account-secret-key'});}else emit({type:'ready'}); }
 if(x.type==='audio') {
   if(model==='malformed'){process.stdout.write('{broken json\\n');continue;}
   const bytes=Buffer.from(JSON.stringify({type:'transcript',text:'你好，我小时候',final:false})+'\\n');
   for(let i=0;i<bytes.length;i++)process.stdout.write(bytes.subarray(i,i+1));
 }
 if(x.type==='finish'&&model!=='no-finish'){
   if(model!=='missing-final')emit({type:'transcript',text:'你好，我小时候住在这条街。',final:true});
   emit({type:'done'});
 }
}
`);
  const app = express(), server = createServer(app), children = [];
  const bridge = attachRealtimeASR(app, server, {
    config: () => ({ enabled, key: 'fixture-secret', url: 'wss://private.invalid/account-secret', model, python: process.execPath }),
    script, limits: { connectMs: 1500, idleMs: 1500, finishMs: 1000, ...limits },
    spawnImpl: (...args) => { const child = spawn(...args); children.push(child); return child; },
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { bridge.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  return { app, base, children, async connect() {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/api/asr/stream'), events = [];
    ws.on('message', data => events.push(JSON.parse(data)));
    await once(ws, 'open');
    return { ws, events, send: value => ws.send(typeof value === 'object' && !Buffer.isBuffer(value) ? JSON.stringify(value) : value),
      async wait(type) { for (let i=0;i<250;i++) { const event=events.find(event=>event.type===type); if(event)return event;await delay(10); } throw Error('No '+type); },
      start(extra={}) { ws.send(JSON.stringify({type:'start',sampleRate:16000,interviewId:'interview-1',utteranceId:'utterance-1',...extra})); },
    };
  } };
}

test('ASR streams cumulative UTF-8 text before finish and binds a reusable final transcript token', async t => {
  const f=await fixture(t);
  const response=await fetch(f.base+'/api/asr/config'), config=await response.json();
  assert.equal(config.enabled,true);assert.equal(config.sampleRate,16000);
  assert.ok(!JSON.stringify(config).includes('fixture-secret'));assert.ok(!JSON.stringify(config).includes('private.invalid'));
  const c=await f.connect();c.start();const ready=await c.wait('ready');
  assert.match(ready.sessionId,/^[a-f0-9-]{36}$/);assert.equal(ready.utteranceId,'utterance-1');
  c.send(Buffer.alloc(640));const interim=await c.wait('transcript');
  assert.equal(interim.text,'你好，我小时候');assert.equal(interim.final,false);
  assert.equal(getRealtimeTranscript(ready.sessionId,{interviewId:'interview-1',utteranceId:'utterance-1'}),null);
  c.send({type:'finish'});const done=await c.wait('done');assert.equal(done.sessionId,ready.sessionId);
  assert.ok(c.events.some(e=>e.type==='transcript'&&e.final&&e.text==='你好，我小时候住在这条街。'));
  assert.equal(getRealtimeTranscript(done.sessionId,{interviewId:'other',utteranceId:'utterance-1'}),null);
  assert.equal(getRealtimeTranscript(done.sessionId,{interviewId:'interview-1',utteranceId:'other'}),null);
  for(let i=0;i<2;i++)assert.equal(getRealtimeTranscript(done.sessionId,{interviewId:'interview-1',utteranceId:'utterance-1'}),'你好，我小时候住在这条街。');
});

test('ASR rejects invalid sample format, odd PCM and excessive audio without saving a final', async t => {
  const f=await fixture(t,{limits:{maxAudioBytes:1280}});
  const invalid=await f.connect();invalid.start({sampleRate:48000});assert.equal((await invalid.wait('error')).code,'asr-invalid-message');
  const early=await f.connect();early.send(Buffer.alloc(2));assert.equal((await early.wait('error')).code,'asr-invalid-audio');
  const odd=await f.connect();odd.start();await odd.wait('ready');odd.send(Buffer.alloc(3));assert.equal((await odd.wait('error')).code,'asr-invalid-audio');
  const large=await f.connect();large.start();await large.wait('ready');large.send(Buffer.alloc(1282));assert.equal((await large.wait('error')).code,'asr-session-limit');
});

test('ASR cancellation kills the provider process and emits no successful final', async t => {
  const f=await fixture(t), c=await f.connect();c.start();await c.wait('ready');c.send({type:'cancel'});
  for(let i=0;i<100&&f.children[0].exitCode==null&&f.children[0].signalCode==null;i++)await delay(10);
  assert.ok(f.children[0].exitCode!=null||f.children[0].signalCode!=null);
  assert.ok(!c.events.some(e=>e.type==='done'||e.final));
});

test('ASR finish timeout and provider failure are bounded and do not expose provider details', async t => {
  const f=await fixture(t,{model:'no-finish',limits:{finishMs:50}}), c=await f.connect();c.start();await c.wait('ready');c.send({type:'finish'});
  assert.equal((await c.wait('error')).code,'asr-timeout');
  const failing=await fixture(t,{model:'error'}), bad=await failing.connect();bad.start();
  assert.equal((await bad.wait('error')).code,'asr-unavailable');assert.ok(!JSON.stringify(bad.events).includes('secret'));
});

test('ASR does not cache partial results when provider omits final confirmation', async t => {
  const f=await fixture(t,{model:'missing-final'}), c=await f.connect();c.start();const ready=await c.wait('ready');
  c.send(Buffer.alloc(640));await c.wait('transcript');c.send({type:'finish'});await c.wait('done');
  assert.equal(getRealtimeTranscript(ready.sessionId,{interviewId:'interview-1',utteranceId:'utterance-1'}),null);
});

test('ASR malformed provider output and idle clients terminate cleanly', async t => {
  const malformed=await fixture(t,{model:'malformed'}), c=await malformed.connect();c.start();await c.wait('ready');c.send(Buffer.alloc(640));
  assert.equal((await c.wait('error')).code,'asr-invalid-response');
  const idle=await fixture(t,{limits:{idleMs:60}}), d=await idle.connect();d.start();await d.wait('ready');assert.equal((await d.wait('error')).code,'asr-timeout');
});
