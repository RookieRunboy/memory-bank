// One live synthetic-only ASR -> host SSE -> TTS probe. No retries, no saved user
// interviews, no transcript/provider-credential logging. Run from app/:
// node scripts/probe-realtime-voice.mjs SYNTHETIC_16K_MONO.wav [report.json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { readWav } from '../server/interview-session.mjs';
import { sseData } from '../server/streaming-json.mjs';
import { firstShort, splitSentences } from '../src/split.js';
import { speakable } from '../src/planner.js';

const appDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const audioFile=process.argv[2];
if(!audioFile)throw Error('Usage: node scripts/probe-realtime-voice.mjs SYNTHETIC_16K_MONO.wav [report.json]');
const output=path.resolve(process.argv[3]||path.join(appDir,'screenshots/realtime-voice/service-results.json'));
const audio=fs.readFileSync(audioFile),wav=readWav(audio);
if(wav.sampleRate!==16000||wav.format.readUInt16LE(2)!==1||wav.durationMs>60000)throw Error('Expected synthetic mono 16-bit 16kHz WAV, at most 60 seconds.');
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'mb-realtime-probe-'));
const report={measuredAt:new Date().toISOString(),sampleCount:1,environment:`${process.platform}/${process.arch}, ${process.version}`,
 input:{kind:'caller-supplied synthetic Chinese WAV; no elder recording',sampleRate:16000,channels:1,durationMs:wav.durationMs,sha256:createHash('sha256').update(audio).digest('hex')},
 isolation:{temporaryDatabase:true,ttsPrewarm:false,ttsCache:'empty',existingUserServiceRestarted:false},
 definitions:{clock:'relative to ASR WebSocket creation unless named durationMs',audioOutput:'first network PCM bytes only; no device/hardware playback',endpoint:'explicit finish at end of synthetic audio; microphone/VAD endpoint wait not measured'},
 asr:{events:[]},host:{replyEvents:[],draftEvents:[],cumulativeText:true},tts:{requested:false},pass:false};
const child=spawn(process.execPath,['server/index.mjs'],{cwd:appDir,env:{...process.env,DATA_DIR:dataDir,PORT:'0',HOST:'127.0.0.1',GEMINI_TTS_WARM:'0'},stdio:['ignore','pipe','pipe']});
child.stderr.on('data',()=>{});
let origin,socket,stage='startup',began,ttsPromise=null,ttsController,turnController;
const elapsed=()=>Math.round(performance.now()-began);
const post=async(url,body)=>{
 const response=await fetch(origin+'/api'+url,{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('http-'+response.status);return response.json();
};
function firstPlayable(text,final=false){
 let end=text.search(/[。！？!?；;\n]/);
 if(end<0&&text.length>=16){const comma=text.lastIndexOf('，',32);if(comma>=5)end=comma;}
 if(end<0&&!final)return '';
 return firstShort(splitSentences(speakable(end<0?text:text.slice(0,end+1))))[0]||'';
}
function requestTTS(text){
 if(ttsPromise||!text)return;
 report.tts.requested=true;report.tts.requestAtMs=elapsed();report.tts.sentenceChars=text.length;
 ttsController=new AbortController();
 ttsPromise=(async()=>{
  const timer=setTimeout(()=>ttsController.abort(),15000);
  try{
   const response=await fetch(origin+'/api/tts/stream?t='+encodeURIComponent(text),{signal:ttsController.signal});
   report.tts.httpStatus=response.status;report.tts.cached=response.headers.get('x-tts-cached')==='1';
   if(!response.ok){report.tts.failure='http-'+response.status;return;}
   const reader=response.body.getReader();
   try{const first=await reader.read();if(first.done||!first.value?.length)report.tts.failure='empty-stream';
    else{report.tts.firstNetworkAtMs=elapsed();report.tts.firstNetworkDurationMs=report.tts.firstNetworkAtMs-report.tts.requestAtMs;report.tts.firstChunkBytes=first.value.length;}}
   finally{await reader.cancel().catch(()=>{});}
  }catch{report.tts.failure=ttsController.signal.aborted?'timeout':'network-error';}
  finally{clearTimeout(timer);ttsController.abort();report.tts.finishedAtMs=elapsed();}
 })();
}
try{
 origin=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('startup-timeout')),15000);let log='';
  child.once('error',()=>{clearTimeout(timer);reject(Error('startup-error'));});
  child.once('exit',()=>{clearTimeout(timer);reject(Error('startup-exit'));});
  child.stdout.on('data',bytes=>{log=(log+bytes.toString()).slice(-4096);const match=log.match(/memory-bank on 127\.0\.0\.1:(\d+)/);if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1]);}});
 });
 stage='setup';
 const elder=await post('/elders',{profile:{name:'合成演示',gender:'女',callName:'测试女士',callNameManual:true,birthYear:'1948',hometown:'',people:''}});
 const interview=await post('/interviews',{elderId:elder.id,request:{nodeId:'child-home'}});
 const index=interview.cards.findIndex(card=>card.nodeId==='child-home');if(index<0)throw Error('matching-topic-unavailable');
 const choice=await post(`/interviews/${interview.id}/choose`,{action:'pick',index,clientTurnId:'probe-choice'});
 report.topicNode=choice.ask.nodeId;
 stage='asr';began=performance.now();
 let resolveReady,resolveDone;
 const readyPromise=new Promise(resolve=>resolveReady=resolve),donePromise=new Promise(resolve=>resolveDone=resolve);
 const asrTimer=setTimeout(()=>resolveDone({type:'timeout'}),45000);
 socket=new WebSocket(origin.replace('http:','ws:')+'/api/asr/stream');
 socket.on('error',()=>resolveDone({type:'error',code:'network-error'}));
 socket.on('message',bytes=>{
  let event;try{event=JSON.parse(bytes);}catch{resolveDone({type:'error',code:'invalid-response'});return;}
  const row={type:event.type,atMs:elapsed(),...(typeof event.text==='string'?{chars:event.text.length,final:event.final===true}:{})};
  if(event.type==='error')row.code=/^[a-z-]{1,64}$/.test(event.code||'')?event.code:'provider-error';
  report.asr.events.push(row);
  if(event.type==='ready')resolveReady(event);
  if(event.type==='transcript'){if(report.asr.firstInterimAtMs==null&&!event.final&&event.text)report.asr.firstInterimAtMs=row.atMs;if(event.final){report.asr.finalAtMs=row.atMs;report.asr.finalChars=event.text.length;}}
  if(event.type==='done'||event.type==='error')resolveDone(event);
 });
 const utteranceId=randomUUID();
 try{
  await Promise.race([once(socket,'open'),donePromise.then(x=>{throw Error(x.code||'asr-timeout');})]);
  socket.send(JSON.stringify({type:'start',sampleRate:16000,interviewId:interview.id,utteranceId}));
  const ready=await Promise.race([readyPromise,donePromise]);if(ready.type!=='ready')throw Error('asr-'+ready.type);
  report.asr.readyAtMs=elapsed();report.asr.audioStartAtMs=elapsed();
  for(let at=0;at<wav.pcm.length;at+=3200){if(socket.readyState!==WebSocket.OPEN)throw Error('asr-disconnected');socket.send(wav.pcm.subarray(at,at+3200));await delay(100);}
  report.asr.finishSentAtMs=elapsed();socket.send(JSON.stringify({type:'finish'}));
  const done=await donePromise;if(done.type!=='done'||report.asr.finalAtMs==null||!done.sessionId)throw Error(done.code||'asr-incomplete');
  report.asr.doneAtMs=elapsed();report.asr.finishToDoneMs=report.asr.doneAtMs-report.asr.finishSentAtMs;
  stage='host';
  const fd=new FormData();fd.append('audio',new Blob([audio],{type:'audio/wav'}),'synthetic.wav');
  for(const [key,value] of Object.entries({clientTurnId:'probe-turn',utteranceId,asrSessionId:done.sessionId,durMs:wav.durationMs,question:choice.say,questionId:choice.responseId,ask:JSON.stringify(choice.ask)}))fd.append(key,String(value));
  report.host.requestAtMs=elapsed();turnController=new AbortController();const hostTimer=setTimeout(()=>turnController.abort(),65000);
  let result,lastText='';
  try{
   const response=await fetch(origin+`/api/interviews/${interview.id}/turn`,{method:'POST',body:fd,headers:{Accept:'text/event-stream'},signal:turnController.signal});
   report.host.httpStatus=response.status;report.host.sse=/text\/event-stream/.test(response.headers.get('content-type')||'');
   if(!response.ok||!report.host.sse)throw Error('host-protocol');
   for await(const raw of sseData(response.body)){
    const event=JSON.parse(raw),atMs=elapsed();
    if(event.type==='transcript'){report.host.transcriptAtMs=atMs;report.host.asrSource=event.transcript?.source;report.host.transcriptChars=event.transcript?.raw?.length||0;}
    if(event.type==='reply-draft')report.host.draftEvents.push({atMs,chars:(event.text||'').length});
    if(event.type==='reply'){
     report.host.firstReplyAtMs??=atMs;report.host.cumulativeText&&=typeof event.text==='string'&&event.text.startsWith(lastText);
     lastText=event.text||'';report.host.replyEvents.push({atMs,chars:lastText.length});requestTTS(firstPlayable(lastText));
    }
    if(event.type==='error')report.host.streamError={code:/^[a-z-]{1,64}$/.test(event.code||'')?event.code:'stream-error',recoverable:!!event.recoverable,atMs};
    if(event.type==='result'){result=event.result;report.host.resultAtMs=atMs;report.host.source=result.next?.source;report.host.timing=result.timing;report.host.replyInterrupted=!!result.replyInterrupted;report.host.finalReplyChars=(result.next?.say||'').length;requestTTS(firstPlayable(result.next?.say||'',true));}
   }
   if(!result)throw Error('host-incomplete');
  }finally{clearTimeout(hostTimer);turnController.abort();}
  stage='tts';if(ttsPromise)await ttsPromise;
  report.tts.requestBeforeResult=report.tts.requestAtMs!=null&&report.tts.requestAtMs<report.host.resultAtMs;
  report.tts.firstNetworkBeforeResult=report.tts.firstNetworkAtMs!=null&&report.tts.firstNetworkAtMs<report.host.resultAtMs;
  report.tts.syntheticAudioEndToFirstNetworkMs=report.tts.firstNetworkAtMs==null?null:report.tts.firstNetworkAtMs-report.asr.finishSentAtMs;
  report.checks={asrIncrementalBeforeFinish:report.asr.events.filter(event=>event.type==='transcript'&&!event.final&&event.atMs<report.asr.finishSentAtMs).length>1,
   asrFinalReused:report.host.asrSource==='dashscope-realtime',hostSSE:report.host.sse,hostIncrementalText:report.host.draftEvents.length>1||report.host.replyEvents.length>1,
   hostCumulativeText:report.host.cumulativeText,hostCompleted:!!report.host.resultAtMs&&!report.host.replyInterrupted,
   ttsStartedBeforeHostResult:report.tts.requestBeforeResult,ttsFirstNetworkReceived:report.tts.firstNetworkAtMs!=null};
  report.pass=Object.values(report.checks).every(Boolean);
 }finally{clearTimeout(asrTimer);socket.terminate();}
}catch(error){report.failure={stage,code:/^[a-z0-9-]{1,64}$/.test(error.message)?error.message:error.name==='AbortError'?'timeout':'probe-error'};}
finally{
 if(ttsPromise)await ttsPromise;
 socket?.terminate();ttsController?.abort();turnController?.abort();
 child.kill('SIGTERM');await Promise.race([once(child,'exit').catch(()=>{}),delay(1500)]);if(child.exitCode==null&&child.signalCode==null){child.kill('SIGKILL');await once(child,'exit').catch(()=>{});}
 // Only this probe-created directory is removed; all live user data stays intact.
 fs.rmSync(dataDir,{recursive:true,force:true});report.isolation.cleaned=true;
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({output,pass:report.pass,failure:report.failure,asrFirstInterimMs:report.asr.firstInterimAtMs,hostFirstReplyMs:report.host.firstReplyAtMs,hostResultMs:report.host.resultAtMs,replyEvents:report.host.replyEvents.length,ttsFirstNetworkMs:report.tts.firstNetworkAtMs,ttsFailure:report.tts.failure}));
 if(!report.pass)process.exitCode=1;
}
