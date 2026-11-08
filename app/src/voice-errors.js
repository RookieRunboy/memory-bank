// Keep server/provider text out of the UI. These labels explain the failing
// boundary without guessing that every error means the device is offline.
export function voiceErrorMessage(error) {
  if(error?.code==='storage-unavailable')return '这段录音还没存到本机，请先别关闭页面，再试一次。';
  if(error?.code==='storage-cleanup')return '这段已经保存，本机记录还没清理好。可以重试。';
  if(error?.status===404)return '访谈服务还没更新，请重启服务后重试。';
  if(error?.code==='asr-unavailable')return '语音识别暂时不可用，录音已保留，可以稍后重试。';
  if(error?.code==='timeout')return '小忆这次等得有些久，录音已保留。请再试一次。';
  if(error?.code==='finished')return '这场访谈已经结束，请返回首页查看故事。';
  if(error?.status===409)return '这场访谈的状态有变化，请先暂停，稍后重试。';
  if(error?.status===401||error?.status===403)return '访谈服务暂时无法使用，请检查服务配置。';
  if(error?.status>=500)return '访谈服务暂时没能处理好，录音已保留，可以重试。';
  if(error?.code==='invalid-response')return '访谈服务返回异常，请稍后重试。';
  if(error?.status>=400)return '这段暂时没能提交，请先暂停，再试一次。';
  if(error?.code==='network-error')return '暂时连不上服务，录音已保留。请稍后重试。';
  return '这段暂时没能处理好，请先别关闭页面，再试一次。';
}

export function voiceRetryLabel(error) {
  return error?.status===404?'服务恢复后，再试一次':'再试一次';
}
