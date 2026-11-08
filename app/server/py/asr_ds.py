"""Stream one utterance through DashScope; stdin/stdout are bounded NDJSON.

The bridge passes only PCM and control frames. Provider credentials stay in the
process environment; provider exceptions are never written to either stream.
"""
import base64
import json
import logging
import os
import sys
import threading

import dashscope
from dashscope.audio.asr import Recognition, RecognitionCallback

logging.disable(logging.CRITICAL)
write_lock = threading.Lock()
sentences = {}
state = {"last": "", "failed": False, "done": False, "fallback_id": 0, "last_final": False}


def emit(event):
    with write_lock:
        sys.stdout.write(json.dumps(event, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def fail(code="asr-unavailable"):
    if not state["failed"] and not state["done"]:
        state["failed"] = True
        emit({"type": "error", "code": code})


class Callback(RecognitionCallback):
    def on_event(self, result):
        sentence = result.get_sentence()
        if not isinstance(sentence, dict) or sentence.get("heartbeat"):
            return
        text = sentence.get("text")
        if not isinstance(text, str):
            return
        identity = sentence.get("sentence_id", sentence.get("begin_time"))
        if identity is None:
            if state["last_final"]:
                state["fallback_id"] += 1
            identity = "fallback:" + str(state["fallback_id"])
        sentences[str(identity)] = text
        state["last_final"] = bool(sentence.get("sentence_end", sentence.get("end_time") is not None))
        cumulative = "".join(sentences.values())
        if cumulative != state["last"]:
            state["last"] = cumulative
            emit({"type": "transcript", "text": cumulative, "final": False})

    def on_complete(self):
        if state["failed"] or state["done"]:
            return
        state["done"] = True
        emit({"type": "transcript", "text": state["last"], "final": True})
        emit({"type": "done"})

    def on_error(self, result):
        # Keep upstream errors and account identifiers out of browser responses.
        code = str(getattr(result, "code", ""))
        fail("asr-access-denied" if any(s in code.lower() for s in ("access", "auth", "permission", "apikey")) else "asr-unavailable")


try:
    first = json.loads(sys.stdin.buffer.readline(8192))
    dashscope.api_key = os.environ["DASHSCOPE_API_KEY"]
    dashscope.base_websocket_api_url = os.environ["DASHSCOPE_ASR_WS_URL"]
    recognizer = Recognition(
        model=first["model"], callback=Callback(), format="pcm", sample_rate=first["sampleRate"],
        disfluency_removal_enabled=False,
    )
    recognizer.start()
    if not state["failed"]:
        emit({"type": "ready"})
    for line in sys.stdin.buffer:
        if state["failed"] or state["done"]:
            break
        message = json.loads(line)
        if message.get("type") == "audio":
            recognizer.send_audio_frame(base64.b64decode(message["data"], validate=True))
        elif message.get("type") == "finish":
            recognizer.stop()
            if not state["done"] and not state["failed"]:
                fail()
            break
        else:
            fail("asr-invalid-message")
            break
except BaseException:
    fail()
# Recognition creates non-daemon threads; the Node owner terminates this child
# after done/error/close, including SDK calls stuck waiting for an upstream task.
