#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { pathToFileURL } = require('url')
const { chromium } = require('@playwright/test')

const DEFAULT_FFMPEG = 'D:/tools/ffmpeg/ffmpeg-8.1.1-full_build/bin/ffmpeg.exe'
const DEFAULT_FFPROBE = 'D:/tools/ffmpeg/ffmpeg-8.1.1-full_build/bin/ffprobe.exe'
const DEFAULT_VOICE = 'Microsoft Huihui Desktop'

function argValue(name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

function run(cmd, args, options = {}) {
  console.log('RUN:', cmd, args.join(' '))
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...options })
  if (result.status !== 0) throw new Error(`${cmd} failed with exit ${result.status}`)
}

function runCapture(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...options })
  if (result.status !== 0) {
    process.stderr.write(result.stderr || '')
    throw new Error(`${cmd} failed with exit ${result.status}`)
  }
  return result.stdout
}

function stripTags(value) {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractTitle(html) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (h1) return stripTags(h1[1])
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return title ? stripTags(title[1]) : '运维平台建设汇报'
}

function extractSections(html) {
  const sections = []
  const re = /<section\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/section>/gi
  let m
  while ((m = re.exec(html))) {
    const h2 = m[2].match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)
    sections.push({ id: m[1], title: h2 ? stripTags(h2[1]) : m[1] })
  }
  return sections
}

function buildNarration(title, sections) {
  const ids = new Set(sections.map(s => s.id))
  const lines = []
  lines.push(`大家好，今天汇报的是《${title}》。本次重点聚焦一期建设成果，不会一次性展开全部高级能力，后续会按照专题继续汇报。`)
  if (ids.has('background')) lines.push('首先是建设背景。随着主机、服务、容器、日志和告警对象不断增多，传统分散查看和人工排查方式效率较低，也不利于统一留痕。因此一期优先建设统一入口和基础运维数据底座。')
  if (ids.has('goal')) lines.push('一期目标可以概括为四个关键词：看得见、接得上、管得住、留空间。也就是先把仪表盘、主机接入、基础告警、日志查询和权限审计做起来，为后续治理和自动化留下扩展空间。')
  if (ids.has('architecture')) lines.push('从架构上看，平台采用前后端分离设计。前端提供统一运维门户，后端通过接口承接鉴权、主机、告警、日志和审计能力，数据侧使用 PostgreSQL 和 Prisma，主机侧通过 Agent、SSH 和 WinRM 接入。')
  if (ids.has('capabilities')) lines.push('一期已经完成的核心能力包括：统一仪表盘、主机和 Agent 接入、告警中心基础、日志查询基础，以及权限和审计能力。这里重点是先形成可用的运维入口，而不是一次性把所有高级能力讲完。')
  if (ids.has('effect')) lines.push('阶段性成效主要体现在四个方面：入口统一，数据开始沉淀，排查路径缩短，治理基础建立。平台已经具备继续扩展告警治理、拓扑排障、自动化和智能辅助的基础。')
  if (ids.has('next')) lines.push('下一阶段会围绕现有基础继续打磨，包括 Agent 和基础监控稳定性、告警和日志监控深化，以及自动化和智能辅助能力的分批推进。')
  if (ids.has('reserve')) lines.push('后续汇报会保留三个专题：第一是告警治理与日志监控，第二是拓扑与自动化运维，第三是智能辅助、自愈和慢查询治理。这样可以保证每次汇报都有重点、有进展。')
  if (ids.has('summary')) lines.push('总结一下，ops-platform 一期建设完成了从分散排查到统一运维入口的基础跨越。本次先汇报底座能力，后续再分批展开更深入的治理、自动化和智能化能力。谢谢大家。')
  return lines.join('\n')
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function synthesize(textPath, wavPath, voice, rate) {
  const psPath = path.join(path.dirname(wavPath), 'synthesize.ps1')
  fs.writeFileSync(psPath, `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { $s.SelectVoice($env:TTS_VOICE) } catch { }
$s.Rate = [int]$env:TTS_RATE
$s.Volume = 100
$s.SetOutputToWaveFile($env:TTS_WAV)
$text = Get-Content -LiteralPath $env:TTS_TEXT -Raw -Encoding UTF8
$s.Speak($text)
$s.Dispose()
`, 'utf8')
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psPath], {
    stdio: 'inherit',
    env: { ...process.env, TTS_VOICE: voice, TTS_RATE: String(rate), TTS_WAV: wavPath, TTS_TEXT: textPath },
  })
  if (result.status !== 0) throw new Error(`PowerShell TTS failed with exit ${result.status}`)
}

function duration(ffprobe, wavPath) {
  const out = runCapture(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', wavPath])
  return Number(JSON.parse(out).format.duration)
}

async function captureSlides(htmlPath, slideDir, sections) {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 })
  await page.goto(pathToFileURL(htmlPath).href)
  await page.waitForLoadState('load')
  const items = [{ id: 'top' }, ...sections]
  const slides = []
  for (let i = 0; i < items.length; i++) {
    const id = items[i].id
    await page.evaluate((sectionId) => document.getElementById(sectionId)?.scrollIntoView({ behavior: 'instant', block: 'start' }), id)
    await page.waitForTimeout(250)
    const file = path.join(slideDir, `slide-${String(i + 1).padStart(2, '0')}.png`)
    await page.screenshot({ path: file, fullPage: false })
    slides.push(file)
  }
  await browser.close()
  return slides
}

function writeConcat(slides, concatPath, secondsPerSlide) {
  let txt = ''
  for (const slide of slides) {
    txt += `file '${path.resolve(slide).replace(/'/g, `'\\''`)}'\n`
    txt += `duration ${secondsPerSlide.toFixed(3)}\n`
  }
  txt += `file '${path.resolve(slides[slides.length - 1]).replace(/'/g, `'\\''`)}'\n`
  fs.writeFileSync(concatPath, txt, 'utf8')
}

async function main() {
  const html = path.resolve(argValue('--html'))
  const output = path.resolve(argValue('--output'))
  const voice = argValue('--voice', DEFAULT_VOICE)
  const rate = Number(argValue('--rate', '0'))
  const ffmpeg = path.resolve(argValue('--ffmpeg', DEFAULT_FFMPEG))
  const ffprobe = path.resolve(argValue('--ffprobe', DEFAULT_FFPROBE))
  if (!fs.existsSync(html)) throw new Error(`HTML not found: ${html}`)
  if (!fs.existsSync(ffmpeg)) throw new Error(`ffmpeg not found: ${ffmpeg}`)
  if (!fs.existsSync(ffprobe)) throw new Error(`ffprobe not found: ${ffprobe}`)

  const outDir = path.dirname(output)
  const slideDir = path.join(outDir, 'slides')
  ensureDir(slideDir)
  for (const f of fs.readdirSync(slideDir)) if (f.endsWith('.png')) fs.unlinkSync(path.join(slideDir, f))

  const htmlText = fs.readFileSync(html, 'utf8')
  const title = extractTitle(htmlText)
  const sections = extractSections(htmlText)
  const narration = buildNarration(title, sections)
  const narrationTxt = path.join(outDir, 'narration.txt')
  const narrationWav = path.join(outDir, 'narration.wav')
  const concatTxt = path.join(outDir, 'concat.txt')
  const silentVideo = path.join(outDir, 'slides-only.mp4')
  ensureDir(outDir)
  fs.writeFileSync(narrationTxt, narration, 'utf8')
  console.log('Narration:', narrationTxt)

  synthesize(narrationTxt, narrationWav, voice, rate)
  const audioSeconds = duration(ffprobe, narrationWav)
  console.log('Audio seconds:', audioSeconds.toFixed(2))

  const slides = await captureSlides(html, slideDir, sections)
  const secondsPerSlide = Math.max(4, audioSeconds / slides.length)
  writeConcat(slides, concatTxt, secondsPerSlide)

  run(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', concatTxt, '-vf', 'scale=1366:768:force_original_aspect_ratio=decrease,pad=1366:768:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', silentVideo])
  run(ffmpeg, ['-y', '-i', silentVideo, '-i', narrationWav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', output])
  console.log('DONE:', output)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
