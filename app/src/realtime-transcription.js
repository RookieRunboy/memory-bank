// One live recognizer per utterance, using the existing capture stream. The
// service's final transcript is only a preview here; archival text comes back
// through the accepted /turn request (which may reuse its server-side result).
export class PCM16Resampler {
  constructor(sampleRate, outputRate=16000){
    this.ratio=sampleRate/outputRate;this.sum=0;this.filled=0;
  }
  push(input){
    const values=[];
    for(const value of input){
      let remaining=1;
      while(remaining>1e-8){
        const take=Math.min(remaining,this.ratio-this.filled);
        this.sum+=value*take;this.filled+=take;remaining-=take;
        if(this.filled>=this.ratio-1e-8){
          const sample=Math.max(-1,Math.min(1,this.sum/this.ratio));
          values.push(Math.round(sample*(sample<0?32768:32767)));this.sum=0;this.filled=0;
        }
      }
    }
    const bytes=new Uint8Array(values.length*2),view=new DataView(bytes.buffer);
    values.forEach((value,index)=>view.setInt16(index*2,value,true));return bytes;
  }
}

export class RealtimeTranscriber {
  constructor({onTranscript=()=>{},onUnavailable=()=>{},fetchImpl=globalThis.fetch?.bind(globalThis),WebSocketImpl=globalThis.WebSocket,location=globalThis.location,timeoutMs=7000}={}){
    Object.assign(this,{onTranscript,onUnavailable,fetchImpl,WebSocketImpl,location,timeoutMs});
    this.sessions=new Set();this.enabled=false;
  }
  async configure(){
    const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),2500);
    try{const r=await this.fetchImpl('/api/asr/config',{signal:ctl.signal});const config=r.ok?await r.json():{};this.enabled=!!(config.enabled&&this.WebSocketImpl);return this.enabled;}
    catch{return this.enabled=false;}finally{clearTimeout(timer);}
  }
  start({interviewId,utteranceId,sampleRate}){
    if(!this.enabled)return null;
    const url=new URL('/api/asr/stream',this.location.href);url.protocol=url.protocol==='https:'?'wss:':'ws:';
    let socket;
    try{socket=new this.WebSocketImpl(url.href);}catch{this.onUnavailable();return null;}
    const resampler=new PCM16Resampler(sampleRate),queue=[];
    let ready=false,closed=false,ending=false,bytes=0,sessionId=null,finalText=null,timer,resolveDone;
    const done=new Promise(resolve=>{resolveDone=resolve;});
    const finishSession=(result=null)=>{
      if(closed)return;closed=true;clearTimeout(timer);queue.length=0;this.sessions.delete(handle);
      socket.onopen=socket.onmessage=socket.onerror=socket.onclose=null;
      try{socket.close();}catch{}resolveDone(result);
    };
    const fail=()=>{if(closed)return;this.onUnavailable();finishSession();};
    const arm=()=>{clearTimeout(timer);timer=setTimeout(fail,this.timeoutMs);};
    const send=value=>{try{socket.send(value);return true;}catch{fail();return false;}};
    const flush=()=>{if(!ready||closed)return;while(queue.length)if(!send(queue.shift()))return;bytes=0;if(ending)send(JSON.stringify({type:'finish'}));};
    const handle={done,get sessionId(){return sessionId;},get active(){return !closed&&!ending;},
      write:pcm=>{
        if(closed||ending)return;
        const chunk=resampler.push(pcm);if(!chunk.length)return;
        if(ready){if(socket.bufferedAmount>128000)return fail();send(chunk);}
        else{bytes+=chunk.length;if(bytes>128000)return fail();queue.push(chunk);}
      },
      finish:()=>{if(!ending&&!closed){ending=true;flush();arm();}return done;},
      cancel:()=>{if(!closed){if(ready)send(JSON.stringify({type:'cancel'}));finishSession();}},
    };
    this.sessions.add(handle);arm();
    socket.onopen=()=>send(JSON.stringify({type:'start',sampleRate:16000,interviewId,utteranceId}));
    socket.onmessage=event=>{
      if(closed)return;
      let message;try{message=JSON.parse(event.data);}catch{return fail();}
      if(message.utteranceId&&message.utteranceId!==utteranceId)return fail();
      if(ready&&message.sessionId&&message.sessionId!==sessionId)return fail();
      if(message.type==='ready'){if(!message.sessionId)return fail();sessionId=message.sessionId;ready=true;clearTimeout(timer);flush();if(ending)arm();}
      else if(message.type==='transcript'){
        if(!ready)return fail();
        if(typeof message.text==='string'){if(message.final)finalText=message.text;this.onTranscript({utteranceId,text:message.text,final:!!message.final});}
      }else if(message.type==='done'){
        if(!ending||finalText===null||message.sessionId!==sessionId)return fail();
        finishSession({sessionId,text:finalText});
      }
      else if(message.type==='error')fail();
    };
    socket.onerror=fail;socket.onclose=()=>{if(!closed)fail();};
    return handle;
  }
  cancelAll(){for(const session of [...this.sessions])session.cancel();}
}
