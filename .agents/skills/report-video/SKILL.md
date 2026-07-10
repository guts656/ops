---
name: report-video
description: Use this skill whenever the user wants to turn an HTML report, project briefing, stage report, or presentation-style webpage into a narrated video. It creates Chinese female voiceover with Windows TTS, captures the HTML as slide images, and uses ffmpeg to assemble an MP4. Trigger for requests like “做成视频”, “加配音”, “汇报视频”, “HTML 转视频”, or “下次直接调用这个流程”.
---

# Report Video Skill

This skill converts an ops-platform report into a narrated MP4 video. Prefer the humanized project-briefing flow: explain the user's actual ops-platform phase-one functions and operational value instead of reading the HTML/PPT literally.

## Default behavior

- Prefer natural Edge neural Chinese female voice: `zh-CN-XiaoxiaoNeural`.
- Fall back to Windows desktop Chinese female voice: `Microsoft Huihui Desktop`.
- Use ffmpeg from D drive first: `D:\tools\ffmpeg\ffmpeg-8.1.1-full_build\bin\ffmpeg.exe`.
- Keep the source HTML unchanged.
- Write generated artifacts under `report-video-output/` unless the user gives another folder.
- Produce:
  - `narration.txt` — narration script
  - `narration.wav` — voiceover
  - `slides/slide-XX.png` — captured visuals
  - `concat.txt` — ffmpeg concat list
  - final `.mp4`

## Workflow

1. Identify the source HTML file.
   - If the user refers to “一期汇报”, default to `运维平台建设一期汇报.html` in the project root.
   - If the user refers to the original/general report, default to `运维平台建设汇报报告.html`.
   - If ambiguous, ask which file to use.

2. For ops-platform phase reports, run the humanized project-briefing script. This creates video-specific slides and a natural explanation script instead of reading the HTML literally:

```bash
node .agents/skills/report-video/scripts/make_ops_briefing_video.cjs \
  --output "report-video-output/运维平台建设一期汇报-人性化讲解版.mp4" \
  --voice "zh-CN-XiaoxiaoNeural"
```

If the user explicitly asks to turn an arbitrary HTML page into a simple narrated page video, use the generic HTML capture script:

```bash
node .agents/skills/report-video/scripts/make_report_video.cjs \
  --html "运维平台建设一期汇报.html" \
  --output "report-video-output/运维平台建设一期汇报.mp4" \
  --voice "Microsoft Huihui Desktop"
```

3. Verify the result:

```bash
D:/tools/ffmpeg/ffmpeg-8.1.1-full_build/bin/ffprobe.exe -hide_banner "report-video-output/运维平台建设一期汇报.mp4"
```

4. Report the final MP4 path and the voice used.

## When adjusting narration

The generated narration should sound like a staged business/technical briefing, not a literal reading of every card. Keep it concise:

- opening: state this is phase-one construction report
- background: why platform is needed
- goals: unified entry, data ingestion, basic governance, future space
- architecture: portal, frontend, API, Agent/remote, PostgreSQL/Prisma
- capabilities: dashboard, host/Agent, alert center, log query, permissions/audit
- effects: unified entry, data sedimentation, troubleshooting efficiency, governance foundation
- next: monitoring polish, alert/log deepening, later automation and intelligence
- close: emphasize “do not cover everything at once; future topics are reserved”

## Troubleshooting

- If `ffmpeg` is not on PATH, use the D drive path above.
- If Windows TTS fails, check installed voices with:

```bash
powershell.exe -NoProfile -Command 'Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name + "|" + $_.VoiceInfo.Culture }'
```

- If Playwright browser capture fails, ensure project dependencies are installed and `@playwright/test` is available.
- If Chinese text appears garbled in ffmpeg logs, the video may still be fine; verify by opening the MP4.
