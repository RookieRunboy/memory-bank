import * as P from './planner.js';
import FW from './framework.json';
import { ic, loader } from './ui.js';
import { VoiceCapture } from './voice-capture.js';
import { TurnQueue, voiceRequest } from './voice-session.js';
import { voiceErrorMessage, voiceRetryLabel } from './voice-errors.js';
import { putPending, removePending, listPending } from './voice-outbox.js';
import { saveStory } from './db.js';
import { InterviewMessages, userId } from './interview-messages.js';
import { RealtimeTranscriber } from './realtime-transcription.js';

const uid=()=>crypto.randomUUID();
export const voiceMetric=(event,details={})=>{
  const rows=window.__voiceMetrics??=[]; rows.push({event,at:performance.now(),...details});if(rows.length>500)rows.shift();
};

export class VoiceInterview {
  constructor({app,esc,api,elderId,profile,request,onFinish,onProfile,playback}){
    Object.assign(this,{app,esc,api,elderId,profile,request,onFinish,onProfile,playback});
    this.disposed=false;this.ending=false;this.started=false;this.order=Date.now();this.notice='';this.captureSnapshot=null;this.answers=[];
    this.messageNodes=new Map();this.followLatest=true;this.messageRevision=-1;
    this.replyStreams=new Map();this.liveFinals=new Map();this.outputEpoch=0;
    this.liveASR=new RealtimeTranscriber({onTranscript:result=>this.liveTranscript(result),onUnavailable:()=>{if(!this.disposed&&!this.leaving){this.asrNotice='实时文字暂时没连上，说完后会补上转写。';this.paint();}}});
    this.turns=new TurnQueue({send:x=>this.sendTurn(x),apply:(r,x,eligible)=>this.applyTurn(r,x,eligible),stop:reason=>{if(!this.leaving&&!this.disposed)this.playback.stop(reason);},persist:x=>putPending(x),remove:removePending,onState:()=>this.paint()});
    this.archives=new TurnQueue({send:x=>this.sendArchive(x),persist:putPending,remove:removePending,onState:()=>this.paint()});
    this.capture=new VoiceCapture({isPlaying:()=>this.playback.active,
      onSpeechStart:info=>this.speechStarted(info),
      onSpeechAudio:pcm=>this.activeLive?.write(pcm),
      onSegment:x=>this.segment(x),onFullSegment:x=>this.fullSegment(x),
      onState:()=>{if(!this.capture?.speaking&&this.turns.speaking){this.turns.speechEnd();const draft=this.messages?.items.find(m=>m.id===this.activeUserId);if(draft?.status==='listening'){this.messages.remove(draft.id);this.activeLive?.cancel();this.activeLive=null;}}this.paint();},
      onLevel:level=>this.app.querySelector('#voiceOrb')?.style.setProperty('--voice-level',level.toFixed(3)),
      onWave:wave=>this.paintWave(wave),
      onError:()=>{this.notice='麦克风停了，录音已保留。可以重新开麦，或打字。';this.event('device-lost');this.stopRecognition();this.paint();}});
  }
  async initialize({autoStart=false}={}){
    const asrReady=this.liveASR.configure();
    this.app.innerHTML=`<main class="page center interview">${loader('小忆来啦，稍等一下……')}</main>`;
    const activeKey='mb_active_interview_'+this.elderId;this.activeKey=activeKey;
    try{
      const existing=localStorage.getItem(activeKey);
      let o=null;
      if(existing)try{o=await this.api('/interviews/'+existing);}catch(error){
        if(error.status===404||error.message==='404')localStorage.removeItem(activeKey);
        else{
          if(this.disposed||this.leaving)return;
          this.app.innerHTML='<main class="page interview"><h2>上次的录音还在</h2><p>网络暂时没连上。连好后，我们接着聊。</p><button class="big" id="recoverRetry">再试一次</button><a class="link" href="#/me">返回</a></main>';
          this.app.querySelector('#recoverRetry').onclick=()=>this.initialize({autoStart});return;
        }
      }
      if(o?.finished){localStorage.removeItem(activeKey);o=null;}
      if(!o)o=await voiceRequest('/interviews',{elderId:this.elderId,request:this.request});
      this.s={...o,p:this.profile,online:true,n:o.turns?.length||0,log:(o.turns||[]).map(t=>t.clean||t.raw).filter(Boolean),say:o.say||o.opening?.say||'',phase:o.phase||'choose'};
      localStorage.setItem(activeKey,o.id);
    }catch{
      const cards=P.candidates(FW,{profile:this.profile,request:this.request});
      this.s={id:'local'+uid(),p:this.profile,online:false,n:0,log:[],phase:'choose',cards,shown:cards.map(c=>c.nodeId),say:P.greetText(FW,P.offlineQuestions(FW,this.profile,this.request).plan,{profile:this.profile},false)};
      this.notice='现在离线，录音保存在本机。也可以打字聊。';
    }
    if(this.disposed)return;
    // A displayed/generated question is not evidence that it was heard. This
    // also prevents recovery from assigning an unplayed late reply to new speech.
    this.heard={question:'（小忆尚未提问，老人主动讲述）',ask:this.s.ask,questionId:this.s.id+':unheard',interrupted:true};
    this.s.responseId??=this.s.id+':opening';
    this.messages=new InterviewMessages(this.s);
    this.capture.sequence=Math.max(-1,...(this.s.fullSegments||[]).map(x=>x.sequence??-1))+1;
    const pending=await listPending(this.s.id).catch(()=>[]);
    this.capture.sequence=Math.max(this.capture.sequence,...pending.filter(x=>x.kind==='full').map(x=>x.sequence+1));
    for(const x of pending){if(x.kind==='turn')this.pendingMessage(x);(x.kind==='turn'?this.turns:this.archives).enqueue(x);}
    const preview=this.readReplyPreview();
    if(preview?.text&&(preview.id===this.s.responseId||pending.some(x=>x.clientTurnId===preview.clientTurnId))){
      this.messages.assistant(preview.id,preview.text,'interrupted');
      this.replyStreams.set(preview.clientTurnId,{...preview,handle:null,recovered:true});
      this.s.responseId=preview.id;this.s.say=preview.text;if(preview.ask)this.s.ask=preview.ask;if(preview.phase)this.s.phase=preview.phase;
    }
    if(this.disposed)return;
    this.render();await asrReady;if(this.disposed||this.leaving)return;if(autoStart)await this.start();
  }
  snapshot(){const live=this.playback.job;return {...this.heard,...(live?.audible&&live.spokenText?{question:live.spokenText,questionId:live.responseId,interrupted:true}:{}),phase:this.heard?.phase||this.s?.phase||'choose',ask:this.heard?.ask||this.s?.ask,outputEpoch:this.outputEpoch};}
  speechStarted(info){
    if(this.ending||this.disposed||this.leaving)return;
    this.captureSnapshot={...this.snapshot(),utteranceId:uid()};this.activeUserId=userId(this.captureSnapshot);this.recognitionPrefix='';this.hadLiveContinuation=false;
    this.messages?.user(this.activeUserId,'','listening');this.turns.speechStart();
    this.activeLive=this.s.online?this.liveASR.start({interviewId:this.s.id,utteranceId:this.captureSnapshot.utteranceId,sampleRate:this.capture.sampleRate}):null;
    voiceMetric('speech-start',{confirmationMs:info?.confirmationMs,localStopMs:Date.now()-(info?.speechAt||Date.now())});this.paint();
  }
  liveTranscript({utteranceId,text}){
    if(this.disposed||this.leaving||!text)return;
    const id=userId({utteranceId}),message=this.messages?.byId.get(id);
    if(!message||this.messages.finished.has(id))return;
    this.asrNotice='';this.messages.user(id,text,id===this.activeUserId&&this.capture.speaking?'listening':'pending');this.paint();
  }
  paintWave(wave){
    if(this.disposed||this.leaving)return;
    const d=wave.map((level,i)=>`${i?'L':'M'}${(i*100/(wave.length-1)).toFixed(1)},${(8+(i%2?1:-1)*level*7).toFixed(1)}`).join(' ');
    this.app.querySelector('#voiceWave path')?.setAttribute('d',d);
    this.messageNodes.get(this.activeUserId)?.querySelector('.message-wave path')?.setAttribute('d',d);
  }
  record(kind,body){return {...body,kind,interviewId:this.s.id,clientTurnId:body.clientTurnId||uid(),order:++this.order};}
  event(type,extra={}){
    if(!this.s?.online||this.disposed)return;
    this.archives.enqueue(this.record('event',{type,eventId:uid(),at:Date.now(),...extra}));
  }
  playbackFirst(info){
    if(this.disposed||!this.s)return;
    if(info.kind==='formal'||info.kind==='replay'){
      const stream=[...this.replyStreams.values()].find(x=>x.id===info.responseId);
      this.heard={question:info.spokenText||info.text||this.s.say,ask:stream?.ask||this.s.ask,phase:stream?.phase||this.s.phase,questionId:info.responseId,interrupted:true};
      this.event('playback-started',{responseId:info.responseId});
      voiceMetric('formal-first-audio',{kind:info.kind,responseId:info.responseId,ttsMs:info.firstAudioMs,ttsFirstByteMs:info.ttsFirstByteMs,playbackLeadMs:info.playbackLeadMs,endToFirstMs:this.lastEndpoint?Date.now()-(this.lastEndpoint.speechEndedAt||this.lastEndpoint.endedAt):null,endpointMs:this.lastEndpoint?.endpointMs});
    }else voiceMetric('ack-first-audio',{ttsMs:info.firstAudioMs});
  }
  playbackComplete(info){
    if(this.disposed||!this.s)return;
    if(/playback-(error|unavailable)/.test(info.reason||''))this.notice='声音没能播出来，可以点“再听一遍”。麦克风仍在听。';
    if(this.heard?.questionId===info.responseId){if(info.spokenText)this.heard.question=info.spokenText;if(info.completed)this.heard.interrupted=false;}
    this.event(info.completed?'playback-completed':info.reason==='barge-in'?'playback-interrupted':'playback-suppressed',{responseId:info.responseId});this.paint();
  }
  async start(){
    if(this.disposed||this.leaving||this.ending||this.finishFailed||this.starting||this.capture.active)return;
    this.starting=true;
    if(!this.started){this.started=true;this.playback.setEnabled(true);}
    this.playback.unlock();this.paint();
    try{const settings=await this.capture.start();if(this.disposed||this.leaving||this.ending){await this.capture.pause();return;}
      voiceMetric('mic-start',{echoCancellation:settings?.echoCancellation===true});this.notice=this.s.online?'':'现在离线，录音保存在本机。';this.asrNotice=this.s.online&&!this.liveASR.enabled?'实时文字暂不可用，说完后会补上转写。':'';this.event('resume');this.startRecognition();
      if(!this.turns.pending&&!this.turns.speaking)this.say({kind:this.hasOpened?'replay':'formal'});this.hasOpened=true;
    }catch{this.notice='没能打开麦克风，可以重新试试，或在下面打字。';}
    finally{this.starting=false;this.paint();}
  }
  async pause(){if(this.pausing)return this.pausing;this.outputEpoch++;this.playback.stop('pause');this.stopRecognition();this.pausing=this.capture.pause().then(()=>{this.event('pause');this.notice='麦克风已关闭。想继续时，点一下开麦。';this.paint();}).finally(()=>this.pausing=null);return this.pausing;}
  segment(x){
    if(this.disposed||!this.s)return;
    const snapshot=this.captureSnapshot||this.snapshot();
    this.lastEndpoint=x;voiceMetric('endpoint',{endpointMs:x.endpointMs,durMs:x.durMs,continuation:!!x.continuation});
    const input=this.record('turn',{...x,...snapshot,browserText:this.browserText||'',source:'voice'});
    if(x.continuation)this.hadLiveContinuation=true;
    else if(this.activeLive){const final=this.activeLive.finish();if(!this.hadLiveContinuation)this.liveFinals.set(input.clientTurnId,final);this.activeLive=null;}
    this.pendingMessage(input);this.turns.enqueue(input);
    this.recognitionPrefix=this.messages?.items.find(m=>m.id===userId(input))?.text||'';
    this.browserText='';this.srOffset=this.srCount||0;if(!x.continuation)this.captureSnapshot=null;
    // A network outage must not turn into an unbounded in-memory recording.
    if(this.turns.pending>=8){this.notice='网络有些慢，录音已保留。请稍等，再点开麦。';this.pause();}
  }
  fullSegment(x){if(!this.s||this.disposed)return;this.archives.enqueue(this.record('full',x));if(this.archives.items.filter(x=>x.kind==='full').length>=10&&!this.leaving&&!this.ending)this.pause();}
  async sendArchive(x){
    if(!this.s.online){(this.localFull??=[]).push(x);await this.saveOffline();return {};}
    if(x.kind==='event')return voiceRequest(`/interviews/${this.s.id}/events`,x);
    const fd=new FormData();fd.append('audio',x.blob,'full.wav');
    for(const k of ['clientTurnId','sequence','startedAt','endedAt','boundary','durMs'])if(x[k]!=null)fd.append(k,x[k]);
    return voiceRequest(`/interviews/${this.s.id}/full`,fd);
  }
  async sendTurn(x){
    if(!this.s.online)return this.offlineTurn(x);
    x.outputEpoch??=this.outputEpoch;
    const liveFinal=this.liveFinals.get(x.clientTurnId);
    if(liveFinal){let timer;const final=await Promise.race([liveFinal,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),1200);})]);clearTimeout(timer);this.liveFinals.delete(x.clientTurnId);if(final?.sessionId){
      // Persist the exact token before sending. A reload after a lost HTTP
      // response must retry the same payload and idempotency fingerprint.
      try{await putPending({...x,asrSessionId:final.sessionId});x.asrSessionId=final.sessionId;}catch{/* The original audio is already durable; use the ordinary ASR path. */}
    }}
    const fd=new FormData();if(x.blob)fd.append('audio',x.blob,'turn.wav');
    for(const k of ['clientTurnId','utteranceId','asrSessionId','finalizeContinuation','question','questionId','interrupted','continuation','durMs','manual','browserText','action','index'])if(x[k]!=null)fd.append(k,x[k]);
    if(x.ask)fd.append('ask',JSON.stringify(x.ask));
    const t=performance.now(),endpoint=x.phase==='choose'?'choose':'turn';
    let r;
    try{r=await voiceRequest(`/interviews/${this.s.id}/${endpoint}`,fd,{onEvent:event=>this.turnEvent(event,x)});}
    catch(error){this.replyStreams.get(x.clientTurnId)?.handle?.cancel('stream-error');throw error;}
    voiceMetric('backend',{requestId:x.clientTurnId,roundTripMs:performance.now()-t,...r.timing});return r;
  }
  streamEligible(x){return !this.disposed&&!this.leaving&&!this.ending&&x.version===this.turns.version&&!this.turns.speaking&&this.turns.items.length===1&&!x.continuation;}
  readReplyPreview(){try{return JSON.parse(localStorage.getItem('mb_reply_preview_'+this.s.id));}catch{return null;}}
  rememberReply(x,stream){
    // Keep the visible prefix before the final result is accepted. Reload can
    // happen without a reliable unload callback; it must not revive unseen text.
    try{localStorage.setItem('mb_reply_preview_'+this.s.id,JSON.stringify({clientTurnId:x.clientTurnId,id:stream.id,text:stream.visibleText||stream.text,ask:stream.ask,phase:stream.phase}));}catch{}
  }
  forgetReply(x){try{if(this.readReplyPreview()?.clientTurnId===x.clientTurnId)localStorage.removeItem('mb_reply_preview_'+this.s.id);}catch{}}
  alignQuestion(responseId,ask,phase){
    if(!responseId||(!ask&&!phase))return;
    const fields={...(ask?{ask}:{}),...(phase?{phase}:{})};
    if(this.heard?.questionId===responseId)Object.assign(this.heard,fields);
    if(this.captureSnapshot?.questionId===responseId)Object.assign(this.captureSnapshot,fields);
    for(const input of this.turns.items){
      if(input.questionId!==responseId||(!ask||JSON.stringify(input.ask)===JSON.stringify(ask))&&(!phase||input.phase===phase))continue;
      Object.assign(input,fields);input.saved=this.turns.save(input);input.saved.catch(()=>{});
    }
  }
  resolveMessage(x,result){
    const id=userId(x),current=this.messages.byId.get(id);
    const preview=x.continuation&&id===this.activeUserId&&this.capture.speaking&&this.activeLive?.active?current?.text:null;
    this.messages.resolve(x,result);
    // A 45-second archival chunk is older than the ongoing live preview.
    // Keep that preview visible while still retaining the confirmed raw part.
    if(preview)this.messages.user(id,preview,'listening');
  }
  turnEvent(event,x){
    if(this.disposed||this.leaving)return;
    if(event.type==='transcript'&&event.transcript){this.resolveMessage(x,{transcript:event.transcript,deferred:!!x.continuation});this.paint();return;}
    if(event.type==='error'){this.replyStreams.get(x.clientTurnId)?.handle?.cancel('stream-error');this.notice='小忆这句话没说完，您可以接着聊。';this.paint();return;}
    if(!['reply','reply-draft'].includes(event.type)||!this.streamEligible(x)||typeof event.text!=='string'||!event.text.trim()||!event.responseId)return;
    let stream=this.replyStreams.get(x.clientTurnId);
    if(!stream){stream={id:event.responseId,text:'',visibleText:'',ask:event.ask,phase:event.phase,handle:null,audioStarted:false};this.replyStreams.set(x.clientTurnId,stream);}
    if(stream.recovered||stream.id!==event.responseId||!event.text.startsWith(stream.text))return;
    if(event.ask)stream.ask=event.ask;if(event.phase)stream.phase=event.phase;
    if(event.type==='reply')this.alignQuestion(event.responseId,event.ask,event.phase);
    if(event.type==='reply-draft')stream.visibleText=event.text;
    else{
      const delta=event.text.slice(stream.text.length);stream.text=event.text;
      if(!stream.visibleText.startsWith(stream.text))stream.visibleText=stream.text;
      if(!stream.audioStarted){stream.audioStarted=true;if(x.outputEpoch===this.outputEpoch)stream.handle=this.playback.beginStream({responseId:event.responseId,kind:'formal'});}
      stream.handle?.append(delta);
    }
    this.rememberReply(x,stream);Object.assign(this.messages.assistant(stream.id,stream.visibleText||stream.text,'streaming'),{ask:stream.ask,phase:stream.phase});this.paint();
  }
  applyTurn(r,x,eligible){
    if(this.disposed||this.leaving)return;
    this.resolveMessage(x,r);
    if(r.ignored){this.notice='小忆在听，您接着说。';this.paint();return;}
    const s=this.s;if(r.transcript?.clean||r.heard)s.log.push(r.transcript?.clean||r.heard);
    if(x.phase!=='choose'&&((r.transcript&&!r.deferred)||r.finalized))s.n++;
    if(r.profile){s.p=r.profile;this.onProfile(r.profile);}
    const n=r.next||r;s.ask=n.ask||s.ask;this.alignQuestion(r.responseId,n.ask,n.phase);s.phase=n.phase||s.phase;s.free=n.free??s.free;s.cards=n.cards||s.cards;s.after=n.after??s.after;s.closing=r.closing||s.closing;
    if(r.deferred){this.paint();return;}
    const streamed=this.replyStreams.get(x.clientTurnId);this.replyStreams.delete(x.clientTurnId);
    if(!eligible||this.ending||streamed?.recovered){
      streamed?.handle?.cancel('stale-reply');const visible=streamed?.visibleText||streamed?.text;
      if(visible){this.rememberReply(x,streamed);this.messages.assistant(streamed.id,visible,'interrupted');}
      this.event('playback-suppressed',{responseId:r.responseId,displayed:!!visible,...(visible?{question:visible}:{})});this.paint();return;
    }
    if(n.say){s.say=n.say;s.responseId=r.responseId||x.clientTurnId+':reply';const message=this.messages.assistant(s.responseId,n.say);if(message)Object.assign(message,{ask:s.ask,phase:s.phase});}
    this.notice=r.replyInterrupted?'小忆这句话没说完，您可以接着聊。':'';this.render();
    if(!r.replyInterrupted)this.forgetReply(x);
    if(streamed){if(r.replyInterrupted)streamed.handle?.cancel('stream-error');else{if(n.say?.startsWith(streamed.text))streamed.handle?.append(n.say.slice(streamed.text.length));streamed.handle?.finish();}}
    if(r.end||n.done){this.finish();return;}
    if(!streamed&&!r.replyInterrupted&&(x.outputEpoch??this.outputEpoch)===this.outputEpoch)this.say();
  }
  say({force=false,kind='formal'}={}){
    if(this.disposed||this.leaving||this.ending||this.capture.speaking||this.turns.speaking||this.turns.pending)return;
    const {responseId}=this.s;
    // A stale reply hidden before recovery must not suddenly be spoken on
    // resume. Muting or interrupting audible speech does not hide its text.
    const message=this.messages?.byId.get('assistant:'+responseId);if(!message)return;
    const result=this.playback.speak(message.text,{force,kind,responseId});this.paint();return result;
  }
  manual(input){
    if(this.ending||this.disposed||!this.turns.accepting||this.turns.pending||this.capture.speaking)return;
    this.playback.stop('manual');
    const labels={more:'换几个话题',free:'随便聊聊',stay:'接着聊'};
    const displayText=input.manual||(input.action==='pick'?this.s.cards?.[input.index]?.text:labels[input.action])||'';
    const visible=this.messages.items.findLast(message=>message.role==='assistant');
    const questionId=visible?.id.slice('assistant:'.length)||this.s.responseId;
    const context=questionId===this.heard?.questionId?this.heard:this.s;
    const turn=this.record('turn',{...this.snapshot(),...input,displayText,question:visible?.text||this.s.say,questionId,ask:visible?.ask||context.ask,interrupted:visible?.status==='interrupted',phase:visible?.phase||context.phase||this.s.phase,outputEpoch:this.outputEpoch});
    this.pendingMessage(turn);const accepted=this.turns.enqueue(turn);this.paint();return accepted;
  }
  pendingMessage(input){
    const id=userId(input),existing=this.messages?.items.find(m=>m.id===id);
    // Keep the position and any real preview text while the recorded turn is
    // submitted. A new chunk of the same utterance is still one user bubble.
    this.messages?.user(id,existing?.text||input.displayText||input.manual||input.browserText||'','pending');
  }
  async offlineTurn(x){
    const s=this.s;let text=(x.manual||x.browserText||'').trim();
    if(!x.finalizeContinuation&&(x.blob||text&&!x.action)){this.answers.push({question:x.question,text,audio:x.blob});await this.saveOffline();}
    this.offlineContinuations??=new Map();
    if(x.continuation){const parts=this.offlineContinuations.get(x.utteranceId)||[];parts.push(text);this.offlineContinuations.set(x.utteranceId,parts);return {deferred:true,transcript:{raw:text,clean:text},phase:s.phase};}
    const parts=this.offlineContinuations.get(x.utteranceId);if(parts){text=[...parts,text].filter(Boolean).join('\n');this.offlineContinuations.delete(x.utteranceId);}
    if(x.finalizeContinuation&&!text)return {finalized:true,next:{phase:s.phase,say:'您接着说。',ask:s.ask}};
    if(!text&&!x.action){this.notice='原声已保留，也可以打字补记。';return {ignored:true};}
    if(s.phase==='choose'){
      const ch=x.action?x:P.parseChoice(FW,text,s.cards,s.p,{after:s.after});
      if(ch.action==='help')return {phase:'choose',heard:text,say:P.OPENING_NUDGE};
      if(ch.action==='end')return {end:true};
      if(ch.action==='more'){s.cards=P.candidates(FW,{profile:s.p,exclude:s.shown});s.shown.push(...s.cards.map(c=>c.nodeId));return {phase:'choose',cards:s.cards,say:P.choiceText(s.cards)};}
      const nodeId=ch.nodeId||s.cards[ch.index]?.nodeId;
      if(ch.action==='discuss'||ch.action==='free'||!nodeId){
        s.free=true;
        return {phase:'chat',free:true,heard:text,say:text?'现在离线，内容已保存在本机，您可以接着讲这段经历。':'现在离线，可以先把想说的录下来。'};
      }
      const o=P.offlineQuestions(FW,s.p,{nodeId});s.qs=o.qs;s.plan=o.plan;s.free=false;
      return {phase:'chat',free:false,heard:text,ask:o.qs[0],say:o.qs[0].text};
    }
    if(s.free)return {...(x.finalizeContinuation?{finalized:true}:{transcript:{raw:x.manual||x.browserText||'',clean:x.manual||x.browserText||''}}),next:{phase:'chat',free:true,say:'这段内容已保存在本机，您可以接着讲。',done:/今天.*(到这|不聊)|想休息|累了/.test(text)}};
    const next=s.qs?.[Math.min(s.n+1,s.qs.length-1)];return {...(x.finalizeContinuation?{finalized:true}:{transcript:{raw:x.manual||x.browserText||'',clean:x.manual||x.browserText||''}}),next:{phase:'chat',say:next?.text||'您接着说。',ask:next,done:/今天.*(到这|不聊)|想休息|累了/.test(text)}};
  }
  startRecognition(){
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(this.s.online||!SR)return;
    const sr=this.sr=new SR();this.srOffset=0;this.srCount=0;sr.lang='zh-CN';sr.continuous=true;sr.interimResults=true;
    sr.onresult=e=>{if(e.results.length<this.srCount)this.srOffset=0;this.srCount=e.results.length;this.browserText=[...e.results].slice(this.srOffset).map(r=>r[0].transcript).join('');if(this.capture.speaking&&this.activeUserId){this.messages.user(this.activeUserId,[this.recognitionPrefix,this.browserText].filter(Boolean).join(''),'listening');this.paintMessages();}};
    sr.onend=()=>{if(this.sr===sr&&this.capture.active&&!this.ending&&!this.disposed&&!this.leaving)try{sr.start();}catch{}};
    try{sr.start();}catch{}
  }
  stopRecognition(){const sr=this.sr;this.sr=null;if(sr){sr.onend=null;sr.onresult=null;try{sr.abort();}catch{}}}
  saveOffline(){const text=this.answers.map(x=>x.text).filter(Boolean).join('\n\n');return saveStory({id:this.s.id,createdAt:this.createdAt??=Date.now(),title:text?'这次聊过的往事':'这次访谈的原声',body:text||'录音保存在下面，可以逐段回听。',profile:this.s.p,answers:this.answers,fullSegments:(this.localFull||[]).filter(x=>x.kind==='full')});}
  render(){
    if(this.disposed||this.leaving)return;
    if(!this.app.querySelector('#conversation')){
      this.messageNodes.clear();this.messageRevision=-1;this.followLatest=true;
      this.app.innerHTML=`<main class="page interview interview-chat" data-voice-state="closed">
        <header class="interview-header">
          <a class="interview-back" href="#/me" aria-label="返回">${ic('back',20)}</a>
          <div class="interview-heading"><h1>和小忆聊聊</h1><p id="interviewTopic"></p></div>
          <button class="snd" id="snd" type="button"></button>
        </header>
        <section class="conversation" id="conversation" role="log" aria-label="访谈对话" aria-live="off" tabindex="0">
          <div class="chat-messages" id="messages"></div><section class="topic-choices" id="topicChoices" aria-label="可以聊的话题"></section>
        </section>
        <button class="latest-message hidden" id="latest" type="button">回到最新消息 ↓</button>
        <footer class="voice-dock">
          <div class="voice-summary"><div class="voice-orb" id="voiceOrb" aria-hidden="true"><span class="orb-ring"></span><span class="orb-core"></span></div>
            <svg class="voice-wave" id="voiceWave" viewBox="0 0 100 16" aria-hidden="true"><path d="M0 8 L100 8"></path></svg>
            <div class="voice-copy"><p class="voice-state" id="voiceState" role="status" aria-live="polite"></p><p class="live" id="live"></p></div>
          </div>
          <div class="voice-actions">
            <button class="mic control" id="mic" type="button">${ic('mic',20)}<span id="micl"></span></button>
            <button class="control" id="replay" type="button">${ic('play',18)}<span>再听一遍</span></button>
            <button class="control end-call" id="end" type="button">结束聊天</button>
          </div>
          <button class="ghost hidden" id="retry" type="button">再试一次</button>
          <details class="manual-entry"><summary>也可以打字</summary><form id="manualForm"><label for="manual">想说的话</label><textarea id="manual" rows="2" placeholder="在这里写下想说的话"></textarea><button class="ghost" id="sendManual" type="submit">发送</button></form></details>
        </footer></main>`;
      const q=id=>this.app.querySelector('#'+id);
      q('mic').onclick=()=>this.capture.active?this.pause():this.start();
      q('snd').onclick=()=>{this.playback.setEnabled(!this.playback.enabled);if(this.playback.enabled){this.playback.unlock();this.say();}this.paint();};
      q('replay').onclick=()=>this.say({force:true,kind:'replay'});
      q('manualForm').onsubmit=ev=>{ev.preventDefault();const el=q('manual');if(el.value.trim()&&this.manual({manual:el.value.trim()}))el.value='';};
      q('end').onclick=()=>this.finish();
      q('retry').onclick=()=>{this.notice='';this.turns.retry();this.archives.retry();if(this.finishFailed)this.finish();this.paint();};
      q('latest').onclick=()=>{this.followLatest=true;this.scrollMessages();};
      q('conversation').onscroll=()=>{const c=q('conversation');this.followLatest=c.scrollHeight-c.scrollTop-c.clientHeight<64;q('latest').classList.toggle('hidden',this.followLatest);};
      if(globalThis.ResizeObserver){this.chatResize?.disconnect();this.chatResize=new ResizeObserver(()=>{if(this.followLatest)this.scrollMessages();});this.chatResize.observe(q('conversation'));}
    }
    const s=this.s,e=this.esc,choosing=s.phase==='choose',choices=this.app.querySelector('#topicChoices');
    this.app.querySelector('#interviewTopic').textContent=choosing||s.free?'想起什么，就聊什么':s.ask?.nodeId?P.nodeTitle(FW,s.ask.nodeId,s.p):'慢慢聊，不着急';
    const markup=choosing?`<div class="cards">${(s.cards||[]).map((c,i)=>`<button class="tcard" data-i="${i}"><span>${e(c.text)}</span>${ic('arrow',16)}</button>`).join('')}</div>
      <details class="choose-extra"><summary>换几个，或随便聊</summary><div class="row choose-more"><button class="ghost" data-a="more">换几个</button><button class="ghost" data-a="free">随便聊聊</button>${s.after?'<button class="ghost" data-a="stay">接着聊</button>':''}</div></details>`:'';
    if(this.choicesMarkup!==markup||choices.dataset.mounted!=='true'){
      choices.innerHTML=markup;choices.hidden=!choosing;choices.dataset.mounted='true';this.choicesMarkup=markup;
      choices.querySelectorAll('.tcard').forEach(b=>b.onclick=()=>this.manual({action:'pick',index:+b.dataset.i}));
      choices.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>this.manual({action:b.dataset.a}));
    }
    this.paint();
  }
  scrollMessages(){
    const c=this.app.querySelector('#conversation');if(!c)return;
    c.scrollTop=c.scrollHeight;this.app.querySelector('#latest')?.classList.add('hidden');
  }
  paintMessages(){
    const container=this.app.querySelector('#messages');
    if(!container||!this.messages||this.messageRevision===this.messages.revision)return;
    const follow=this.followLatest,ids=new Set(this.messages.items.map(m=>m.id));
    for(const [id,node] of this.messageNodes)if(!ids.has(id)){node.remove();this.messageNodes.delete(id);}
    this.messages.items.forEach((m,i)=>{
      let node=this.messageNodes.get(m.id);
      if(!node){node=document.createElement('article');node.className='chat-message '+m.role;node.dataset.messageId=m.id;node.setAttribute('aria-label',m.role==='user'?'你':'小忆');const text=document.createElement('p');text.className='message-text';node.append(text);if(m.role==='user'){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');svg.classList.add('message-wave');svg.setAttribute('viewBox','0 0 100 16');svg.setAttribute('aria-hidden','true');path.setAttribute('d','M0 8 L100 8');svg.append(path);node.append(svg);}this.messageNodes.set(m.id,node);}
      node.dataset.status=m.status;
      const text=m.text||(m.status==='listening'?'正在听…':'正在转写…');
      if(node.firstChild.textContent!==text)node.firstChild.textContent=text;
      if(container.children[i]!==node)container.insertBefore(node,container.children[i]||null);
    });
    this.messageRevision=this.messages.revision;
    if(follow)this.scrollMessages();
  }
  paint(){
    if(this.disposed||this.leaving||!this.s)return;
    const q=id=>this.app.querySelector('#'+id),active=this.capture.active,busy=this.turns.pending>0;
    if(!q('mic'))return;
    const waitingForAudio=this.playback.pending&&!this.playback.active;
    const status=this.capture.speaking?'小忆在听':this.playback.active?'小忆在说':busy?'小忆在想':waitingForAudio?'正在准备声音':active?'小忆在听':'麦克风已关闭';
    q('voiceState').textContent=status;q('micl').textContent=this.starting?'正在开麦':active?'暂停收音':this.started?'继续开麦':'开麦';
    this.app.querySelector('.interview-chat').dataset.voiceState=this.capture.speaking?'listening':this.playback.active?'speaking':busy||waitingForAudio?'thinking':active?'listening':'closed';
    q('mic').setAttribute('aria-label',active?'暂停收音':'开启麦克风');this.paintMessages();
    q('mic').classList.toggle('rec',active);q('mic').setAttribute('aria-pressed',String(active));q('mic').disabled=this.ending||this.finishFailed||this.starting;
    const failed=this.turns.error||this.archives.error;
    const notice=failed?voiceErrorMessage(failed):this.notice||this.asrNotice||'';
    q('live').textContent=notice;q('live').hidden=!notice;
    q('retry').textContent=voiceRetryLabel(failed);
    q('retry').classList.toggle('hidden',!failed&&!this.finishFailed);q('end').disabled=this.ending;
    this.app.querySelectorAll('.tcard,[data-a],#sendManual').forEach(b=>b.disabled=busy||this.ending||this.capture.speaking);
    q('replay').disabled=this.ending||busy||this.capture.speaking||!this.messages.items.some(m=>m.id==='assistant:'+this.s.responseId);
    const snd=q('snd'),on=this.playback.enabled;snd.setAttribute('aria-label',on?'小忆的声音：已打开，点此静音':'小忆的声音：已关闭，点此打开');snd.setAttribute('aria-pressed',String(on));snd.innerHTML=ic(on?'sound':'soundoff',24);snd.classList.toggle('on',on);
  }
  finish(){
    if(this.finishing)return this.finishing;
    this.ending=true;this.finishFailed=false;this.playback.stop('finish');this.stopRecognition();this.paint();
    this.finishing=(async()=>{
      // pause emits the valid tail before the queue admission gate closes.
      await this.capture.pause();this.event('pause',{boundary:'finish'});
      if(!this.disposed&&!this.leaving)this.playback.speak(this.s.closing||'好，今天先聊到这儿，您歇一歇。',{kind:'closing',responseId:this.s.id+':closing'});
      await this.turns.finish();await this.archives.drain();
      if(this.disposed||this.leaving)return;
      this.app.innerHTML=`<main class="page center interview">${loader('小忆在把您的故事写下来……')}</main>`;
      if(this.s.online){const r=await voiceRequest(`/interviews/${this.s.id}/finish`,{clientTurnId:this.s.id+':finish'},{timeout:90000});if(localStorage.getItem(this.activeKey)===this.s.id)localStorage.removeItem(this.activeKey);if(!this.disposed&&!this.leaving)this.onFinish(r.storyId?'#/story/'+r.storyId:'#/library');}
      else{await this.saveOffline();if(!this.disposed&&!this.leaving)this.onFinish('#/story/'+this.s.id);}
    })().catch(()=>{if(!this.disposed&&!this.leaving){this.finishing=null;this.finishFailed=true;this.notice='还没保存完，录音已保留。重试后再结束。';this.ending=false;this.render();}});
    return this.finishing;
  }
  dispose(){
    if(this.disposed||this.leaving)return;
    this.leaving=true;this.chatResize?.disconnect();
    this.playback.stop('leave');this.stopRecognition();
    // Tracks stop now; allow the worklet's final queued frames into the outbox.
    const flushing=this.capture.pause();
    Promise.resolve(flushing).finally(()=>{this.liveASR.cancelAll();this.activeLive=null;this.event('pause',{boundary:'leave'});this.disposed=true;this.turns.dispose();this.capture.dispose({flush:false});});
  }
}
