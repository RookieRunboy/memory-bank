import { readVoiceEvents } from './stream-events.js';
// A queue belongs to the interview, never to a DOM render. Aborting a view cannot
// undo an accepted server write; only playback/UI eligibility is invalidated.
const failure = (code, details = {}) => Object.assign(new Error(code), { code, ...details });
export class TurnQueue {
  constructor({send,apply=()=>{},stop=()=>{},persist=async()=>{},remove=async()=>{},onState=()=>{}}={}) {
    Object.assign(this,{send,apply,stop,persist,remove,onState});
    this.items=[]; this.version=0; this.speaking=false; this.running=false;
    this.accepting=true; this.disposed=false; this.error=null; this.waiters=[];
  }
  get pending(){return this.items.length;}
  speechStart(){if(!this.accepting)return;this.version++;this.speaking=true;this.stop('barge-in');this.onState();}
  speechEnd(){this.speaking=false;this.onState();this.pump();}
  enqueue(input){
    if(!this.accepting)return false;
    const item={...input,version:this.version};
    // Reserve order synchronously, including while IndexedDB is committing.
    item.saved=this.save(item); item.saved.catch(()=>{});
    this.items.push(item);if(!input.continuation)this.speaking=false;
    this.onState();this.pump();return true;
  }
  async pump(){
    if(this.running||this.error||this.disposed)return;
    this.running=true;
    try{
      while(this.items.length&&!this.disposed){
        const x=this.items[0];if(this.speaking&&!x.continuation)break;
        await x.saved; const r=await this.send(x);
        try{await this.remove(x);}catch(cause){throw failure('storage-cleanup',{cause});}this.items.shift();
        const eligible=!this.disposed&&x.version===this.version&&!this.speaking&&!this.items.length&&!x.continuation;
        if(!this.disposed)await this.apply(r,x,eligible);
      }
    }catch(e){this.error=e;}
    finally{this.running=false;this.onState();this.settle();}
  }
  settle(){
    if(this.error){for(const w of this.waiters.splice(0))w.reject(this.error);}
    else if(!this.pending&&!this.running){for(const w of this.waiters.splice(0))w.resolve();}
  }
  drain(){if(this.error)return Promise.reject(this.error);if(!this.pending&&!this.running)return Promise.resolve();return new Promise((resolve,reject)=>this.waiters.push({resolve,reject}));}
  save(item){return Promise.resolve().then(()=>this.persist(item)).then(()=>{item.durable=true;}).catch(cause=>{throw failure('storage-unavailable',{cause});});}
  retry(){this.error=null;for(const x of this.items)if(!x.durable){x.saved=this.save(x);x.saved.catch(()=>{});}this.pump();}
  finish(){this.accepting=false;this.speaking=false;this.pump();return this.drain();}
  dispose(){this.accepting=false;this.disposed=true;this.version++;this.stop('dispose');for(const w of this.waiters.splice(0))w.reject(new Error('会话已离开，待提交录音保留在本机'));}
}

// Timeout only stops local waiting. Retries use the same persisted clientTurnId.
export async function voiceRequest(url,body,{timeout=45000,fetchImpl=fetch,onEvent}={}){
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),timeout);
  try{const r=await fetchImpl('/api'+url,{method:'POST',body:body instanceof FormData?body:JSON.stringify(body),headers:{...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...(onEvent?{Accept:'text/event-stream'}:{})},signal:ctl.signal});
    if(r.ok&&r.headers?.get('content-type')?.includes('text/event-stream'))return await readVoiceEvents(r,onEvent);
    // Old servers/proxies can return HTML. Retain their HTTP status instead of
    // disguising a missing route as a JSON parsing or connectivity failure.
    const result=await r.json().catch(()=>null);
    if(!r.ok){const code=typeof result?.error==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(result.error)?result.error:'http-error';throw failure(code,{status:r.status});}
    if(!result||typeof result!=='object')throw failure('invalid-response',{status:r.status});return result;
  }catch(error){
    if(ctl.signal.aborted)throw failure('timeout');
    if(error?.status||error?.streamError||error?.code==='invalid-response')throw error;
    throw failure('network-error');
  }finally{clearTimeout(timer);}
}
