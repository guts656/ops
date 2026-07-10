#!/usr/bin/env python3
import argparse
import json
import math
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote

DEFAULT_FFMPEG = Path(r"D:\tools\ffmpeg\ffmpeg-8.1.1-full_build\bin\ffmpeg.exe")
DEFAULT_FFPROBE = Path(r"D:\tools\ffmpeg\ffmpeg-8.1.1-full_build\bin\ffprobe.exe")
DEFAULT_VOICE = "Microsoft Huihui Desktop"


def run(cmd, cwd=None):
    print("RUN:", " ".join(str(x) for x in cmd))
    return subprocess.run(cmd, cwd=cwd, check=True)


def ps_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def strip_tags(value: str) -> str:
    value = re.sub(r"<script[\s\S]*?</script>", "", value, flags=re.I)
    value = re.sub(r"<style[\s\S]*?</style>", "", value, flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def extract_title(html: str) -> str:
    m = re.search(r"<h1[^>]*>([\s\S]*?)</h1>", html, flags=re.I)
    if m:
        return strip_tags(m.group(1))
    m = re.search(r"<title[^>]*>([\s\S]*?)</title>", html, flags=re.I)
    return strip_tags(m.group(1)) if m else "运维平台建设汇报"


def extract_sections(html: str):
    sections = []
    for m in re.finditer(r"<section\s+id=\"([^\"]+)\"[^>]*>([\s\S]*?)</section>", html, flags=re.I):
        sid, body = m.group(1), m.group(2)
        h = re.search(r"<h2[^>]*>([\s\S]*?)</h2>", body, flags=re.I)
        title = strip_tags(h.group(1)) if h else sid
        subtitle = ""
        p = re.search(r"<p\s+class=\"subtitle\"[^>]*>([\s\S]*?)</p>", body, flags=re.I)
        if p:
            subtitle = strip_tags(p.group(1))
        sections.append({"id": sid, "title": title, "subtitle": subtitle})
    return sections


def build_narration(title: str, sections):
    by_id = {s["id"]: s for s in sections}
    lines = []
    lines.append(f"大家好，今天汇报的是《{title}》。本次重点聚焦一期建设成果，不会一次性展开全部高级能力，后续会按照专题继续汇报。")
    if "background" in by_id:
        lines.append("首先是建设背景。随着主机、服务、容器、日志和告警对象不断增多，传统分散查看和人工排查方式效率较低，也不利于统一留痕。因此一期优先建设统一入口和基础运维数据底座。")
    if "goal" in by_id:
        lines.append("一期目标可以概括为四个关键词：看得见、接得上、管得住、留空间。也就是先把仪表盘、主机接入、基础告警、日志查询和权限审计做起来，为后续治理和自动化留下扩展空间。")
    if "architecture" in by_id:
        lines.append("从架构上看，平台采用前后端分离设计。前端提供统一运维门户，后端通过 Express API 承接鉴权、主机、告警、日志和审计能力，数据侧使用 PostgreSQL 和 Prisma，主机侧通过 Agent、SSH 和 WinRM 接入。")
    if "capabilities" in by_id:
        lines.append("一期已经完成的核心能力包括：统一仪表盘、主机和 Agent 接入、告警中心基础、日志查询基础，以及权限和审计能力。这里重点是先形成可用的运维入口，而不是一次性把所有高级能力讲完。")
    if "effect" in by_id:
        lines.append("阶段性成效主要体现在四个方面：入口统一，数据开始沉淀，排查路径缩短，治理基础建立。平台已经具备继续扩展告警治理、拓扑排障、自动化和智能辅助的基础。")
    if "next" in by_id:
        lines.append("下一阶段会围绕现有基础继续打磨，包括 Agent 和基础监控稳定性、告警和日志监控深化，以及自动化和智能辅助能力的分批推进。")
    if "reserve" in by_id:
        lines.append("后续汇报会保留三个专题：第一是告警治理与日志监控，第二是拓扑与自动化运维，第三是智能辅助、自愈和慢查询治理。这样可以保证每次汇报都有重点、有进展。")
    if "summary" in by_id:
        lines.append("总结一下，ops-platform 一期建设完成了从分散排查到统一运维入口的基础跨越。本次先汇报底座能力，后续再分批展开更深入的治理、自动化和智能化能力。谢谢大家。")
    return "\n".join(lines)


def synthesize_wav(text_path: Path, wav_path: Path, voice: str, rate: int):
    script = f"""
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {{ $s.SelectVoice({ps_quote(voice)}) }} catch {{ }}
$s.Rate = {rate}
$s.Volume = 100
$s.SetOutputToWaveFile({ps_quote(str(wav_path))})
$text = Get-Content -LiteralPath {ps_quote(str(text_path))} -Raw -Encoding UTF8
$s.Speak($text)
$s.Dispose()
"""
    subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], check=True)


def get_audio_duration(ffprobe: Path, wav_path: Path) -> float:
    result = subprocess.run([
        str(ffprobe), "-v", "error", "-show_entries", "format=duration", "-of", "json", str(wav_path)
    ], check=True, capture_output=True, text=True)
    data = json.loads(result.stdout)
    return float(data["format"]["duration"])


def capture_slides(html_path: Path, slide_dir: Path, sections):
    script = slide_dir / "capture_slides.cjs"
    file_url = html_path.resolve().as_uri()
    items = [{"id": "top", "name": "top"}] + [{"id": s["id"], "name": s["id"]} for s in sections]
    script.write_text(f"""
const {{ chromium }} = require('@playwright/test')
;(async () => {{
  const browser = await chromium.launch({{ headless: true }})
  const page = await browser.newPage({{ viewport: {{ width: 1366, height: 768 }}, deviceScaleFactor: 1 }})
  await page.goto({json.dumps(file_url)})
  await page.waitForLoadState('load')
  const items = {json.dumps(items, ensure_ascii=False)}
  for (let i = 0; i < items.length; i++) {{
    const item = items[i]
    await page.evaluate((id) => {{ document.getElementById(id)?.scrollIntoView({{ behavior: 'instant', block: 'start' }}) }}, item.id)
    await page.waitForTimeout(250)
    await page.screenshot({{ path: {json.dumps(str(slide_dir / 'PLACEHOLDER'))}.replace('PLACEHOLDER', `slide-${{String(i+1).padStart(2,'0')}}.png`), fullPage: false }})
  }}
  await browser.close()
}})().catch((error) => {{ console.error(error); process.exit(1) }})
""", encoding="utf-8")
    subprocess.run(["node", str(script)], cwd=html_path.parent, check=True)
    return sorted(slide_dir.glob("slide-*.png"))


def make_concat(slides, concat_path: Path, seconds_per_slide: float):
    with concat_path.open("w", encoding="utf-8") as f:
      for slide in slides:
          safe = str(slide.resolve()).replace("'", "'\\''")
          f.write(f"file '{safe}'\n")
          f.write(f"duration {seconds_per_slide:.3f}\n")
      if slides:
          safe = str(slides[-1].resolve()).replace("'", "'\\''")
          f.write(f"file '{safe}'\n")


def main():
    parser = argparse.ArgumentParser(description="Convert an HTML report into a narrated MP4 video.")
    parser.add_argument("--html", required=True, help="Source HTML report path")
    parser.add_argument("--output", required=True, help="Output MP4 path")
    parser.add_argument("--voice", default=DEFAULT_VOICE, help="Windows TTS voice name")
    parser.add_argument("--rate", type=int, default=0, help="Windows TTS speaking rate (-10..10)")
    parser.add_argument("--ffmpeg", default=str(DEFAULT_FFMPEG), help="ffmpeg executable path")
    parser.add_argument("--ffprobe", default=str(DEFAULT_FFPROBE), help="ffprobe executable path")
    args = parser.parse_args()

    html_path = Path(args.html).resolve()
    output_path = Path(args.output).resolve()
    ffmpeg = Path(args.ffmpeg)
    ffprobe = Path(args.ffprobe)
    if not html_path.exists():
        raise SystemExit(f"HTML not found: {html_path}")
    if not ffmpeg.exists():
        raise SystemExit(f"ffmpeg not found: {ffmpeg}")
    if not ffprobe.exists():
        raise SystemExit(f"ffprobe not found: {ffprobe}")

    work_dir = output_path.parent
    slide_dir = work_dir / "slides"
    work_dir.mkdir(parents=True, exist_ok=True)
    slide_dir.mkdir(parents=True, exist_ok=True)

    html = html_path.read_text(encoding="utf-8")
    title = extract_title(html)
    sections = extract_sections(html)
    narration = build_narration(title, sections)

    narration_txt = work_dir / "narration.txt"
    narration_wav = work_dir / "narration.wav"
    concat_txt = work_dir / "concat.txt"
    narration_txt.write_text(narration, encoding="utf-8")
    print(f"Narration written: {narration_txt}")

    synthesize_wav(narration_txt, narration_wav, args.voice, args.rate)
    duration = get_audio_duration(ffprobe, narration_wav)
    print(f"Audio duration: {duration:.2f}s")

    for old in slide_dir.glob("slide-*.png"):
        old.unlink()
    slides = capture_slides(html_path, slide_dir, sections)
    if not slides:
        raise SystemExit("No slides captured")
    seconds_per_slide = max(4.0, duration / len(slides))
    make_concat(slides, concat_txt, seconds_per_slide)

    silent_video = work_dir / "slides-only.mp4"
    run([
        str(ffmpeg), "-y", "-f", "concat", "-safe", "0", "-i", str(concat_txt),
        "-vf", "scale=1366:768:force_original_aspect_ratio=decrease,pad=1366:768:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", str(silent_video)
    ])
    run([
        str(ffmpeg), "-y", "-i", str(silent_video), "-i", str(narration_wav),
        "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", str(output_path)
    ])
    print(f"DONE: {output_path}")


if __name__ == "__main__":
    main()
