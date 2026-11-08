import test from 'node:test';
import assert from 'node:assert/strict';
import { readVoiceEvents } from '../src/stream-events.js';
import { voiceRequest } from '../src/voice-session.js';

const encode=new TextEncoder();
const line=event=>'data: '+JSON.stringify(event)+'\r\n\r\n';

test('SSE splits UTF-8 and CRLF arbitrarily, dispatching text before final result',async()=>{
  let controller;const events=[];
  const response=new Response(new ReadableStream({start(c){controller=c;}}));
  const result=readVoiceEvents(response,event=>events.push(event));
  for(const byte of encode.encode(': keepalive\r\n\r\n'+line({type:'reply',text:'那棵树呢？',delta:'那棵树呢？'})))controller.enqueue(Uint8Array.of(byte));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(events[0].text,'那棵树呢？','a complete real event must render while the HTTP stream remains open');
  controller.enqueue(encode.encode(line({type:'result',result:{next:{say:'那棵树呢？'}}})));controller.close();
  assert.equal((await result).next.say,events[0].text);
});

test('recoverable reply interruption still consumes the archival result',async()=>{
  const events=[];
  const response=new Response(line({type:'reply',text:'您慢慢说。'})+line({type:'error',code:'reply-interrupted',recoverable:true})+line({type:'result',result:{replyInterrupted:true,turnId:'saved'}}));
  assert.deepEqual(await readVoiceEvents(response,event=>events.push(event)),{replyInterrupted:true,turnId:'saved'});
  assert.equal(events[1].type,'error');
});

test('a disconnected reply stream is not treated as an accepted final result',async()=>{
  await assert.rejects(readVoiceEvents(new Response(line({type:'reply',text:'您慢慢说。'}))),{code:'incomplete-stream'});
  await assert.rejects(readVoiceEvents(new Response(line({type:'error',code:'asr-unavailable'}))),{code:'asr-unavailable'});
});

test('voice request negotiates streaming and remains compatible with JSON servers',async()=>{
  let accept;const streamed=[];
  const result=await voiceRequest('/interviews/x/turn',new FormData(),{onEvent:event=>streamed.push(event),fetchImpl:async(_url,opts)=>{
    accept=opts.headers.Accept;
    return new Response(line({type:'transcript',transcript:{raw:'我还记得。'}})+line({type:'result',result:{turnId:'t1'}}),{headers:{'Content-Type':'text/event-stream'}});
  }});
  assert.equal(accept,'text/event-stream');assert.equal(result.turnId,'t1');assert.equal(streamed[0].transcript.raw,'我还记得。');
  assert.deepEqual(await voiceRequest('/old',{}, {onEvent:()=>{},fetchImpl:async()=>Response.json({say:'慢慢说。'})}),{say:'慢慢说。'});
});
