#!/usr/bin/env python3
"""Insert the composition's silentHold into the approved soundtrack at 10.55 s.

The original assets/sound.wav remains untouched. Only zero-valued PCM frames
are inserted; no resampling, fades, mixing, or loudness processing is applied.
Run this after changing silentHold and before `om render --silent`.
"""

import hashlib
import json
from decimal import Decimal
from html.parser import HTMLParser
from pathlib import Path
import wave


INSERT_AT = Decimal("10.55")
PROJECT = Path(__file__).resolve().parent.parent


class CompositionVariables(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.variables = None

    def handle_starttag(self, tag, attrs):
        if tag == "html":
            raw = dict(attrs).get("data-composition-variables")
            if raw is not None:
                self.variables = json.loads(raw)


def read_wave(path):
    with wave.open(str(path), "rb") as audio:
        params = audio.getparams()
        pcm = audio.readframes(params.nframes)
    return params, pcm


def main():
    parser = CompositionVariables()
    parser.feed((PROJECT / "index.html").read_text(encoding="utf-8"))
    matches = [v for v in (parser.variables or []) if v.get("id") == "silentHold"]
    if len(matches) != 1:
        raise ValueError("index.html must declare exactly one silentHold variable")
    hold = Decimal(str(matches[0]["default"]))
    if not hold.is_finite() or hold < 0:
        raise ValueError("silentHold must be a finite, non-negative number")

    source = PROJECT / "assets/sound.wav"
    destination = PROJECT / "assets/sound-silent-hold.wav"
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    params, original = read_wave(source)
    if (params.framerate, params.nchannels, params.sampwidth, params.comptype) != (48000, 2, 2, "NONE"):
        raise ValueError("Expected the approved 48 kHz, stereo, PCM16 soundtrack")

    insert_frames = INSERT_AT * params.framerate
    hold_frames = hold * params.framerate
    if insert_frames != int(insert_frames) or hold_frames != int(hold_frames):
        raise ValueError("Insertion time and silentHold must resolve to whole PCM frames")
    insert_frames, hold_frames = int(insert_frames), int(hold_frames)
    if insert_frames > params.nframes:
        raise ValueError("Insertion point exceeds the source soundtrack")

    frame_bytes = params.nchannels * params.sampwidth
    split = insert_frames * frame_bytes
    silence = bytes(hold_frames * frame_bytes)
    output = original[:split] + silence + original[split:]
    with wave.open(str(destination), "wb") as audio:
        audio.setparams(params._replace(nframes=params.nframes + hold_frames))
        audio.writeframes(output)

    result_params, result = read_wave(destination)
    resume = split + len(silence)
    checks = {
        "source_file_unchanged": hashlib.sha256(source.read_bytes()).hexdigest() == source_hash,
        "before_pcm_identical": result[:split] == original[:split],
        "inserted_pcm_all_zero": result[split:resume] == silence,
        "after_pcm_identical": result[resume:] == original[split:],
        "frame_count_correct": result_params.nframes == params.nframes + hold_frames,
        "format_unchanged": result_params._replace(nframes=params.nframes) == params,
        "pcm_length_correct": len(result) == result_params.nframes * frame_bytes,
    }
    if not all(checks.values()):
        raise RuntimeError(f"Output validation failed: {checks}")
    print(json.dumps({
        "output": str(destination),
        "silence_start_seconds": float(INSERT_AT),
        "silence_end_seconds": float(INSERT_AT + hold),
        "inserted_frames": hold_frames,
        "source_frames": params.nframes,
        "output_frames": result_params.nframes,
        "duration_seconds": result_params.nframes / params.framerate,
        "source_sha256": source_hash,
        "checks": checks,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
