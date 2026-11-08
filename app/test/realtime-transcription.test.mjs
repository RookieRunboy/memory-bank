import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { PCM16Resampler, RealtimeTranscriber } from '../src/realtime-transcription.js';

function concat(parts) { const bytes=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}return bytes; }
function fixture(options={}) {
  const sockets=[],transcripts=[],failures=[];
  class Socket {
    constructor(url){this.url=url;this.sent=[];this.bufferedAmount=0;this.closed=false;sockets.push(this);}
    send(value){if(this.closed)throw Error('closed');this.sent.push(typeof value==='string'?JSON.parse(value):new Uint8Array(value));}
    close(){this.closed=true;this.onclose?.();}
    open(){this.onopen?.();}
    receive(value){this.onmessage?.({data:JSON.stringify(value)});}
  }
  const client=new RealtimeTranscriber({WebSocketImpl:Socket,location:{href:'https://memory.test/#/interview'},onTranscript:x=>transcripts.push(x),onUnavailable:()=>failures.push(true),timeoutMs:1000,...options});
  client.enabled=true;
  const session=client.start({interviewId:'interview-a',utteranceId:'utterance-a',sampleRate:48000});
  return {client,session,socket:sockets[0],transcripts,failures};
}
const ready={type:'ready',sessionId:'server-session',utteranceId:'utterance-a'};
const final={type:'transcript',text:'我小时候住在这条街。',final:true,sessionId:'server-session',utteranceId:'utterance-a'};
const done={type:'done',sessionId:'server-session',utteranceId:'utterance-a'};

test('PCM16 resampling is independent of arbitrary block boundaries at common input rates',()=>{
  for(const rate of [8000,16000,44100,48000]){
    const pcm=Float32Array.from({length:rate+137},(_,i)=>.7*Math.sin(i*.061)+.2*Math.cos(i*.013));
    const whole=new PCM16Resampler(rate).push(pcm),stream=new PCM16Resampler(rate),parts=[];
    let seed=13;
    for(let i=0;i<pcm.length;){seed=(seed*16807)%2147483647;const size=1+seed%997;parts.push(stream.push(pcm.subarray(i,i+size)));i+=size;}
    assert.deepEqual(concat(parts),whole,`${rate} Hz continuous samples must be unchanged by packet boundaries`);
    assert.equal(whole.length/2,Math.floor(pcm.length*16000/rate));
  }
  const clipping=new DataView(new PCM16Resampler(16000).push(Float32Array.of(-2,-1,0,1,2)).buffer);
  assert.deepEqual(Array.from({length:5},(_,i)=>clipping.getInt16(i*2,true)),[-32768,-32768,0,32767,32767]);
});

test('live ASR buffers pre-roll until ready and sends audio before finish even when stopped early',async()=>{
  const {session,socket,client}=fixture();session.write(new Float32Array(960).fill(.1));socket.open();
  assert.deepEqual(socket.sent,[{type:'start',sampleRate:16000,interviewId:'interview-a',utteranceId:'utterance-a'}]);
  const completed=session.finish();socket.receive(ready);
  assert.equal(socket.url,'wss://memory.test/api/asr/stream');assert.equal(socket.sent[1].length,640);
  assert.deepEqual(socket.sent.at(-1),{type:'finish'});
  socket.receive(final);socket.receive(done);
  assert.deepEqual(await completed,{sessionId:'server-session',text:final.text});
  assert.equal(client.sessions.size,0);assert.equal(socket.closed,true);
});

test('interim replacement is cumulative; final token only becomes reusable after final plus done',async()=>{
  const {session,socket,transcripts}=fixture();socket.open();socket.receive(ready);
  socket.receive({...final,text:'我小时',final:false});socket.receive({...final,text:'我小时候',final:false});
  assert.deepEqual(transcripts.map(x=>x.text),['我小时','我小时候']);
  let settled=false;const pending=session.finish().then(value=>{settled=true;return value;});
  socket.receive(final);await delay(0);assert.equal(settled,false);
  socket.receive(done);assert.equal((await pending).sessionId,'server-session');
});

test('done without final confirmation or before finish cannot return a reusable session token',async()=>{
  const a=fixture();a.socket.open();a.socket.receive(ready);const first=a.session.finish();a.socket.receive(done);assert.equal(await first,null);
  const b=fixture();b.socket.open();b.socket.receive(ready);b.socket.receive(final);b.socket.receive(done);assert.equal(await b.session.done,null);
});

test('mismatched utterance or session does not update this bubble or authorize reuse',async()=>{
  const a=fixture({timeoutMs:30});a.socket.open();a.socket.receive(ready);
  a.socket.receive({...final,utteranceId:'another-utterance'});assert.equal(a.transcripts.length,0);
  a.socket.receive({...final,sessionId:'another-session'});assert.equal(a.transcripts.length,0);
  const pending=a.session.finish();a.socket.receive({...done,sessionId:'another-session'});assert.equal(await pending,null);
});

test('cancel and disconnect settle once and ignore callbacks from a closed session',async()=>{
  const a=fixture();a.socket.open();a.socket.receive(ready);const late=a.socket.onmessage;
  a.session.cancel();assert.equal(await a.session.done,null);assert.deepEqual(a.socket.sent.at(-1),{type:'cancel'});
  late({data:JSON.stringify(final)});assert.equal(a.transcripts.length,0);assert.equal(a.failures.length,0);assert.equal(a.client.sessions.size,0);
  const b=fixture();b.socket.open();b.socket.receive(ready);const pending=b.session.finish();b.socket.close();assert.equal(await pending,null);assert.equal(b.failures.length,1);
});

test('connection and finish waits are bounded, buffer pressure falls back without leaking a session',async()=>{
  const waiting=fixture({timeoutMs:15});assert.equal(await waiting.session.done,null);assert.equal(waiting.failures.length,1);
  const finishing=fixture({timeoutMs:15});finishing.socket.open();finishing.socket.receive(ready);assert.equal(await finishing.session.finish(),null);
  const buffered=fixture();for(let i=0;i<202;i++)buffered.session.write(new Float32Array(960));assert.equal(await buffered.session.done,null);assert.equal(buffered.client.sessions.size,0);
  const blocked=fixture();blocked.socket.open();blocked.socket.receive(ready);blocked.socket.bufferedAmount=128001;blocked.session.write(new Float32Array(960));assert.equal(await blocked.session.done,null);
});
