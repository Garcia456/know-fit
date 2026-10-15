#!/usr/bin/env python3
"""本地 ASR —— faster-whisper 的薄包装，输出一段 JSON 给 Node 侧。

为什么要它：中文可用的本地 ASR 生态在 Python 侧。
它只用标准库 + faster-whisper（av / numpy 随它一起装），不碰任何网络。

    python tools/asr_transcribe.py <音频文件> --model small --language zh

stdout 只有一行 JSON：
    {"language": "zh", "segments": [{"start": 0.4, "end": 6.2, "text": "...", "confidence": 0.91}]}

⚠️ 进度与警告一律走 stderr —— stdout 被约定成纯 JSON，
   Node 侧（src/asr/parse.ts）解析失败时会把它当故障抛出来。

装依赖：pip install faster-whisper
"""
import argparse
import json
import os
import sys

SAMPLE_RATE = 16000


def load_nvidia_dlls() -> None:
    """把 pip 装来的 CUDA 运行库加进 DLL 搜索路径（只对 cuda 有意义）。

    ctranslate2 是按**名字**去 LoadLibrary('cublas64_12.dll') 的，
    而 pip 的 nvidia-* 包把 DLL 放在 site-packages/nvidia/<lib>/bin —— 那不在 PATH 上，
    于是报「Library cublas64_12.dll is not found or cannot be loaded」。**实测踩到，DLL 其实是装了的。**
    """
    if sys.platform != "win32":
        return
    import site
    from pathlib import Path

    dirs: set[str] = set()
    for sp in {*site.getsitepackages(), site.getusersitepackages()}:
        for dll_dir in (Path(sp) / "nvidia").glob("*/bin"):
            if dll_dir.is_dir():
                dirs.add(str(dll_dir))
    for d in sorted(dirs):
        if hasattr(os, "add_dll_directory"):
            os.add_dll_directory(d)
        # 也塞 PATH —— 有些 LoadLibrary 走的是它，两条都留着才稳
        os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")


def decode16k(path: str, rate: int = SAMPLE_RATE):
    """自己解码成 16k 单声道 float32，再喂给模型。

    为什么不让 faster-whisper 自己解：它内部调 `av.open(..., metadata_errors=...)`，
    而 av 19 删了这个参数（它只声明 av>=11、不封顶）—— 直接传文件路径会炸。
    喂 ndarray 会整段跳过它的内部解码器，这两个库的版本怎么撞都与本脚本无关。
    """
    import av
    import numpy as np

    with av.open(path) as container:
        stream = container.streams.audio[0]
        resampler = av.AudioResampler(format="fltp", layout="mono", rate=rate)
        parts = []
        for frame in container.decode(stream):
            for out in resampler.resample(frame) or []:
                parts.append(out.to_ndarray())
        for out in resampler.resample(None) or []:  # 冲掉重采样器里剩的尾巴
            parts.append(out.to_ndarray())

    if not parts:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(parts, axis=1)[0].astype(np.float32)


def main() -> int:
    # 两条流约定都是 UTF-8（stdout 是纯 JSON）。本机 locale 是 GBK 时，
    # 不显式改就会按 GBK 写出去，而 Node 侧按 UTF-8 读 —— 中文全成乱码。
    # 这条只在真机撞得到（CI 走替身），所以必须写死在这里。
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="faster-whisper 转写，输出 JSON")
    parser.add_argument("audio", help="音频文件路径")
    parser.add_argument("--model", default="small", help="模型规格，如 tiny / base / small / medium")
    parser.add_argument("--language", default="zh", help="语言代码，默认 zh")
    parser.add_argument("--device", default="cpu", help="cpu / cuda —— cuda 快一个量级（实测 RTF 0.11 对 1.6）")
    parser.add_argument(
        "--compute-type",
        default="int8",
        help="cpu 上用 int8；cuda 上用 float16（int8 在 GPU 上反而慢）",
    )
    args = parser.parse_args()

    # 要在 import faster_whisper 之前 —— ctranslate2 是那时把 CUDA 库链进来的
    if args.device == "cuda":
        load_nvidia_dlls()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("没装 faster-whisper —— 先跑：pip install faster-whisper", file=sys.stderr)
        return 2

    try:
        audio = decode16k(args.audio)
    except Exception as e:  # 解不出来的原因很杂：容器坏 / 没有声轨 / 编码不支持
        print(f"解不出音频（{args.audio}）：{type(e).__name__}: {e}", file=sys.stderr)
        return 3
    if audio.size == 0:
        print(f"解出来是空的（{args.audio}）—— 这条没有可转的声轨？", file=sys.stderr)
        return 3

    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
    segments, info = model.transcribe(audio, language=args.language, vad_filter=True)

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