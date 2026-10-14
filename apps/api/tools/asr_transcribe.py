#!/usr/bin/env python3
"""本地 ASR —— faster-whisper 的薄包装，输出一段 JSON 给 Node 侧。

为什么要它：中文可用的本地 ASR 生态在 Python 侧。
它只用标准库 + faster-whisper，不碰任何网络。

    python tools/asr_transcribe.py <音频文件> --model small --language zh

stdout 只有一行 JSON：
    {"language": "zh", "segments": [{"start": 0.4, "end": 6.2, "text": "...", "confidence": 0.91}]}

⚠️ 进度与警告一律走 stderr —— stdout 被约定成纯 JSON，
   Node 侧（src/asr/parse.ts）解析失败时会把它当故障抛出来。

装依赖：pip install faster-whisper
"""
import argparse
import json
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="faster-whisper 转写，输出 JSON")
    parser.add_argument("audio", help="音频文件路径")
    parser.add_argument("--model", default="small", help="模型规格，如 tiny / base / small / medium")
    parser.add_argument("--language", default="zh", help="语言代码，默认 zh")
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("没装 faster-whisper —— 先跑：pip install faster-whisper", file=sys.stderr)
        return 2

    # CPU + int8 是「不折腾显卡也能跑」的档；要提速自己调 device / compute_type
    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    segments, info = model.transcribe(args.audio, language=args.language, vad_filter=True)

    out = {"language": getattr(info, "language", None), "segments": []}
    for seg in segments:
        # avg_logprob 是负的对数概率，粗略映射到 0–1；拿不到就留 null，不编一个数
        confidence = None
        if seg.avg_logprob is not None:
            confidence = max(0.0, min(1.0, 1.0 + seg.avg_logprob))
        out["segments"].append(
            {
                "start": float(seg.start),
                "end": float(seg.end),
                "text": seg.text.strip(),
                "confidence": confidence,
            }
        )

    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())