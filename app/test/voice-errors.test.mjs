import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceRequest, TurnQueue } from '../src/voice-session.js';
import { voiceErrorMessage, voiceRetryLabel } from '../src/voice-errors.js';

const rejected = async work => { try { await work; assert.fail('expected rejection'); } catch(error) { return error; } };

test('HTTP failure keeps status even when the stale server returns HTML', async () => {
  const error = await rejected(voiceRequest('/interviews/x/events', {}, { fetchImpl: async () => new Response('<h1>Cannot POST</h1>', {status:404}) }));
  assert.equal(error.status,404); assert.equal(error.code,'http-error');
  assert.match(voiceErrorMessage(error),/服务.*更新/); assert.doesNotMatch(voiceErrorMessage(error),/网络|<h1>/);
  assert.equal(voiceRetryLabel(error),'服务恢复后，再试一次');
});
test('ASR unavailable is not reported as a disconnected network',async()=>{
  const error=await rejected(voiceRequest('/interviews/x/turn',{}, {fetchImpl:async()=>Response.json({error:'asr-unavailable'},{status:503})}));
  assert.equal(error.status,503);assert.equal(error.code,'asr-unavailable');
  assert.match(voiceErrorMessage(error),/语音识别暂时不可用/);assert.doesNotMatch(voiceErrorMessage(error),/网络没连上/);
});
test('timeout and transport errors remain distinct and do not expose upstream messages',async()=>{
  const timeout=await rejected(voiceRequest('/x',{}, {timeout:5,fetchImpl:(_, {signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))))}));
  assert.equal(timeout.code,'timeout');assert.match(voiceErrorMessage(timeout),/等得有些久/);
  const network=await rejected(voiceRequest('/x',{}, {fetchImpl:async()=>{throw Error('secret internal upstream text');}}));
  assert.equal(network.code,'network-error');assert.match(voiceErrorMessage(network),/连不上服务/);assert.doesNotMatch(voiceErrorMessage(network),/secret|upstream/);
});
test('invalid successful JSON and HTTP conflict do not masquerade as network loss',async()=>{
  const malformed=await rejected(voiceRequest('/x',{}, {fetchImpl:async()=>new Response('not json',{status:200})}));
  assert.equal(malformed.code,'invalid-response');assert.equal(malformed.status,200);
  const conflict=await rejected(voiceRequest('/x',{}, {fetchImpl:async()=>Response.json({error:'finished'},{status:409})}));
  assert.match(voiceErrorMessage(conflict),/已经结束/);assert.doesNotMatch(voiceErrorMessage(conflict),/网络/);
  assert.doesNotMatch(voiceErrorMessage({status:500,message:'sensitive text'}),/sensitive/);
});
test('local persistence failure is distinguished, retained in memory, and can be retried',async()=>{
  let attempts=0,sent=0;
  const q=new TurnQueue({persist:async()=>{if(++attempts===1)throw new DOMException('disk full','QuotaExceededError');},send:async()=>{sent++;return {};}});
  q.enqueue({clientTurnId:'stable',blob:new Blob(['audio'])});
  const error=await rejected(q.drain());assert.equal(error.code,'storage-unavailable');assert.equal(sent,0);assert.equal(q.pending,1);
  assert.match(voiceErrorMessage(error),/请先别关闭页面/);assert.doesNotMatch(voiceErrorMessage(error),/已保留|网络/);
  q.retry();await q.drain();assert.equal(sent,1);
});
test('local outbox cleanup failure acknowledges saved server data without changing the request ID',async()=>{
  let cleanups=0,sent=[];
  const q=new TurnQueue({send:async x=>{sent.push(x.clientTurnId);return {};},remove:async()=>{if(++cleanups===1)throw Error('IDB unavailable');}});
  q.enqueue({clientTurnId:'stable'});
  const error=await rejected(q.drain());assert.equal(error.code,'storage-cleanup');assert.match(voiceErrorMessage(error),/已经保存/);
  q.retry();await q.drain();assert.deepEqual(sent,['stable','stable']);
});
