// The browser may go away while an accepted recording is being saved. Closing
// this output channel never cancels the route's persistence work.
export function interviewStream(req, res) {
  if (!String(req.headers.accept || '').includes('text/event-stream')) return null;
  let closed = false;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const close = () => { closed = true; clearInterval(heartbeat); };
  const send = event => {
    if (closed || res.destroyed || res.writableEnded) return false;
    // Voice replies are small. A stalled downstream must not build an unbounded
    // server buffer, nor prevent the original recording from being committed.
    if (res.writableLength > 256 * 1024) { close(); res.end(); return false; }
    res.write(`data: ${JSON.stringify(event)}\n\n`); return true;
  };
  const heartbeat = setInterval(() => { if (!closed && !res.destroyed) res.write(': keepalive\n\n'); }, 10000);
  heartbeat.unref?.(); res.once('close', close);
  return {
    send,
    finish(result, status = 200, cached = false) {
      if (status >= 400) send({ type: 'error', code: result?.error || 'http-error', status, retryable: status >= 500 });
      else send({ type: 'result', result, cached });
      close(); if (!res.destroyed && !res.writableEnded) res.end(); return res;
    },
    fail(code = 'request-failed') {
      send({ type: 'error', code, status: 500, retryable: true });
      close(); if (!res.destroyed && !res.writableEnded) res.end();
    },
  };
}
