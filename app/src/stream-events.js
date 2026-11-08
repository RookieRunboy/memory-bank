// SSE is a byte stream: UTF-8 characters and event boundaries can split anywhere.
export async function readVoiceEvents(response,onEvent){
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',result;
  const dispatch=block=>{
    const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
    if(!data||data==='[DONE]')return;
    let event;try{event=JSON.parse(data);}catch{throw Object.assign(new Error('invalid-response'),{code:'invalid-response'});}
    if(event.type==='error'&&!event.recoverable)throw Object.assign(new Error(event.code||'stream-error'),{code:event.code||'stream-error',streamError:true});
    if(event.type==='result')result=event.result;
    else onEvent?.(event);
  };
  try{
    for(;;){
      const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});
      if(buffer.length>1048576)throw Object.assign(new Error('invalid-response'),{code:'invalid-response'});
      let match;while((match=/\r?\n\r?\n/.exec(buffer))){dispatch(buffer.slice(0,match.index).replace(/\r\n/g,'\n'));buffer=buffer.slice(match.index+match[0].length);}
      if(done){if(buffer.trim())dispatch(buffer.replace(/\r\n/g,'\n'));break;}
    }
    if(!result||typeof result!=='object')throw Object.assign(new Error('incomplete-stream'),{code:'incomplete-stream',streamError:true});
    return result;
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
