// Durable, local recovery for audio captured before a network interruption.
// This is separate from immutable server transcripts and from local demo stories.
let connection;
const open=()=>connection??=new Promise((resolve,reject)=>{const r=indexedDB.open('memory-bank-voice',1);r.onupgradeneeded=()=>r.result.createObjectStore('pending',{keyPath:'clientTurnId'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
const tx=async(mode,fn)=>{const db=await open();return new Promise((resolve,reject)=>{const t=db.transaction('pending',mode),q=fn(t.objectStore('pending'));t.oncomplete=()=>resolve(q?.result);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||new Error('无法保存本机录音'));});};
export const putPending=x=>{const {saved,durable,...value}=x;return tx('readwrite',st=>st.put(value));};
export const removePending=x=>tx('readwrite',st=>st.delete(x.clientTurnId));
export const listPending=async interviewId=>(await tx('readonly',st=>st.getAll())).filter(x=>!interviewId||x.interviewId===interviewId).sort((a,b)=>a.order-b.order);
