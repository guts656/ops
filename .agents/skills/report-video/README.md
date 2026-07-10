# report-video skill

把本地 HTML 汇报文件生成带中文女声配音的 MP4 视频。

## 默认命令

```bash
node .claude/skills/report-video/scripts/make_report_video.cjs \
  --html "运维平台建设一期汇报.html" \
  --output "report-video-output/运维平台建设一期汇报.mp4" \
  --voice "Microsoft Huihui Desktop"
```

## 已验证环境

- 中文女声：Microsoft Huihui Desktop
- ffmpeg：D:\tools\ffmpeg\ffmpeg-8.1.1-full_build\bin\ffmpeg.exe
- 依赖：项目已有 `@playwright/test`

## 输出

- `report-video-output/narration.txt`
- `report-video-output/narration.wav`
- `report-video-output/slides/*.png`
- `report-video-output/运维平台建设一期汇报.mp4`
