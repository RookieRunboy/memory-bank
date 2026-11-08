import test from 'node:test';
import assert from 'node:assert/strict';
import { TurnQueue } from '../src/voice-session.js';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const tick = () => new Promise(r => setImmediate(r));

test('continuous input suppresses late reply but archives every accepted turn in order', async () => {
  const first = deferred(), sent = [], applied = [], stopped = [];
  const q = new TurnQueue({send: async x => { sent.push(x.clientTurnId); return sent.length === 1 ? first.promise : {say:'最新问题'}; }, apply: (r,x,eligible) => applied.push([x.clientTurnId,eligible]), stop: () => stopped.push(1)});
  q.speechStart(); q.enqueue({clientTurnId:'a'}); await tick();
  q.speechStart(); assert.equal(stopped.length,2); q.enqueue({clientTurnId:'b'});
  first.resolve({say:'旧问题'}); await q.drain();
  assert.deepEqual(sent,['a','b']); assert.deepEqual(applied,[['a',false],['b',true]]);
});
test('retry keeps request ID and failed audio; finish waits for the last accepted turn', async () => {
  const gate=deferred(); let attempts=0, applied=0;
  const q=new TurnQueue({send: async x=> { assert.equal(x.clientTurnId,'stable'); if(++attempts===1) throw new Error('offline'); return gate.promise; },apply:()=>applied++});
  q.enqueue({clientTurnId:'stable',blob:new Blob(['audio'])}); await tick();
  await assert.rejects(q.drain(),/offline/); assert.equal(q.pending,1);
  const finish=q.finish(); await assert.rejects(finish,/offline/); assert.equal(q.enqueue({clientTurnId:'late'}),false);
  q.retry(); let done=false; const waiting=q.drain().then(()=>done=true); await tick(); assert.equal(done,false);
  gate.resolve({}); await waiting; assert.equal(applied,1); assert.equal(q.pending,0);
});
test('dispose blocks late UI mutations without cancelling accepted server save', async()=>{
  const gate=deferred(); let applied=0, removed=0;
  const q=new TurnQueue({send:()=>gate.promise,apply:()=>applied++,remove:async()=>removed++});
  q.enqueue({clientTurnId:'a'}); await tick(); q.dispose(); gate.resolve({}); await tick();
  assert.equal(applied,0); assert.equal(removed,1);
});
test('durable enqueue preserves order even when local storage completes out of order',async()=>{
  const gate=deferred(),sent=[];
  const q=new TurnQueue({persist:x=>x.clientTurnId==='a'?gate.promise:Promise.resolve(),send:async x=>sent.push(x.clientTurnId)});
  q.enqueue({clientTurnId:'a'});q.enqueue({clientTurnId:'b'});await tick();assert.deepEqual(sent,[]);
  gate.resolve();await q.drain();assert.deepEqual(sent,['a','b']);
});
test('continuation never speaks, new speech holds pending unsent input until endpoint',async()=>{
  const sent=[],eligible=[];
  const q=new TurnQueue({send:async x=>sent.push(x.clientTurnId),apply:(r,x,e)=>eligible.push(e)});
  q.speechStart(); q.enqueue({clientTurnId:'long',continuation:true});await tick();
  assert.deepEqual(eligible,[false]);assert.equal(q.speaking,true);
  q.enqueue({clientTurnId:'tail'});await q.drain();assert.deepEqual(eligible,[false,true]);
});
