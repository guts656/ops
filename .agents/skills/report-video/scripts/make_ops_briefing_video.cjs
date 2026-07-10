#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { chromium } = require('@playwright/test')
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts')

const FFMPEG = 'D:/tools/ffmpeg/ffmpeg-8.1.1-full_build/bin/ffmpeg.exe'
const FFPROBE = 'D:/tools/ffmpeg/ffmpeg-8.1.1-full_build/bin/ffprobe.exe'
const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural'

function argValue(name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }) }
function run(cmd, args) {
  console.log('RUN:', cmd, args.join(' '))
  const r = spawnSync(cmd, args, { stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`${cmd} failed with ${r.status}`)
}
function capture(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`${cmd} failed with ${r.status}: ${r.stderr}`)
  return r.stdout
}

const slides = [
  {
    id: 'opening',
    kicker: 'OPS-PLATFORM · 阶段建设汇报',
    title: '从统一入口，到智能运维中枢',
    points: ['整体控制在 10 分钟左右', '先回顾一期底座，再说明二期深化', '最后讲后续建设路线和落地价值'],
    narration: '大家好，今天我汇报一下 ops-platform 运维平台的阶段性建设情况。上一版视频主要讲了一期底座，但内容偏简略，所以这次会说得更完整一些。整体结构分三部分：第一，为什么要建设这个平台，以及一期打下了什么基础；第二，二期准备围绕哪些项目继续深化；第三，后续怎样从统一运维入口逐步演进成智能运维中枢。整段视频尽量控制在十分钟左右，重点讲清楚建设逻辑、业务价值和后续计划。'
  },
  {
    id: 'why',
    kicker: '建设背景',
    title: '核心问题：工具不少，但入口分散、过程难沉淀',
    points: ['主机、服务、日志、告警分散查看', '排查依赖人工登录、经验判断和群消息同步', '故障处理过程缺少统一留痕和复盘依据'],
    narration: '先说建设背景。以前运维并不是完全没有工具，而是工具和信息入口比较分散。主机状态可能在一个地方，日志在另一个地方，告警又来自不同系统。出了问题以后，经常要先确认是哪台机器、哪个服务，再登录服务器翻日志，再在群里同步处理进展。短期看这种方式也能解决问题，但长期看有几个明显问题：排查路径长，处理过程依赖个人经验，信息难沉淀，后续复盘也缺少统一依据。ops-platform 的目标，就是把这些分散能力收拢到一个平台里。'
  },
  {
    id: 'phase1-goal',
    kicker: '一期定位',
    title: '一期先解决“看得见、接得上、管得住”',
    points: ['看得见：统一仪表盘、主机视图、告警入口', '接得上：Agent、服务、容器、日志进入平台', '管得住：权限、审计、告警处理基础先建立'],
    narration: '一期的定位不是一步到位做全自动运维，而是先把平台底座做稳。这里可以概括成三个关键词：看得见、接得上、管得住。看得见，是运维人员打开平台后，能看到主机、资源、服务、告警和日志的基本情况。接得上，是 Agent 上报、Windows 服务、Linux 主机、Docker 容器和日志数据能够进入平台，形成数据基础。管得住，是账号登录、角色权限、操作审计、告警确认和解决这些生产化能力先建立起来。只有底座稳定，后面做告警治理、批处理、自愈和 AI 才有基础。'
  },
  {
    id: 'dashboard',
    kicker: '一期能力 01',
    title: '统一仪表盘：给运维一个总入口',
    points: ['健康度、今日告警、服务数量、可用性集中展示', '资源水位、近期活动、异常趋势放在同一页面', '先让问题有一个统一入口可看、可下钻'],
    narration: '第一块能力是统一仪表盘。仪表盘的价值不是做一个好看的大屏，而是让运维人员打开平台以后，先有一个总体判断：今天有没有告警，服务上报是否正常，主机资源水位是否偏高，最近有没有批处理失败、慢查询或者异常活动。以前这些信息分散在多个地方，现在先集中到一个入口里。这样一来，值班人员不用一开始就登录服务器排查，而是可以先从平台总览里判断风险，再下钻到主机、日志或告警详情。'
  },
  {
    id: 'host-agent',
    kicker: '一期能力 02',
    title: '主机与 Agent：把真实运行数据接进来',
    points: ['Linux / Windows 主机统一纳管', 'Agent 心跳、CPU、内存、磁盘指标持续上报', 'Windows 服务、进程、Docker 容器逐步进入平台'],
    narration: '第二块能力是主机和 Agent。运维平台要有价值，首先要拿到真实数据。一期已经具备主机管理、Agent 心跳、CPU 内存磁盘指标、Windows 服务上报、Docker 容器上报等能力。这样平台维护的不只是一张静态主机清单，而是能看到这些主机当前是否在线、Agent 是否正常、资源水位是否有风险、关键服务和容器是否还在运行。对于 Windows 业务服务较多的环境，这一点尤其重要，因为很多问题要先确认服务状态，再判断是不是应用、系统或资源层面的异常。'
  },
  {
    id: 'alert-log-basic',
    kicker: '一期能力 03',
    title: '告警和日志：把发现问题与定位线索放到一起',
    points: ['告警集中展示、确认、解决、通知', '日志按主机、服务、级别、关键字检索', '从告警跳到日志线索，缩短排查路径'],
    narration: '第三块能力是告警和日志。一期先把告警中心和日志查询打通：告警可以集中展示，可以确认和解决；日志可以按主机、服务、关键字和级别检索。这个阶段重点不是把所有监控规则一次性做完，而是先让发现问题和定位线索出现在同一个平台里。比如看到某个服务告警后，可以继续按主机、服务和时间范围去查相关日志，而不是再切到服务器上手工翻文件。这个能力为二期的日志监控规则、告警降噪和自动处理打下了基础。'
  },
  {
    id: 'governance',
    kicker: '一期能力 04',
    title: '权限与审计：让平台具备生产化边界',
    points: ['登录认证、角色权限、菜单权限', '平台操作、主机操作、批处理执行留痕', '为后续高风险操作和自动化执行打基础'],
    narration: '第四块能力是权限和审计。运维平台不是个人脚本，后续一定会涉及主机操作、批量执行、规则调整甚至自愈动作，所以必须先有边界。一期已经建设了登录认证、角色权限、账号管理、平台操作审计和主机操作审计。这样后续能力增强以后，平台能回答三个关键问题：谁操作的，什么时候操作的，操作结果是什么。对于生产环境来说，这一点和功能本身一样重要，因为自动化能力越强，越需要权限、审批和审计来托底。'
  },
  {
    id: 'phase1-effect',
    kicker: '一期成效',
    title: '一期价值：把分散能力收拢成平台底座',
    points: ['入口统一：少切系统，先看全局再下钻', '数据沉淀：主机、服务、容器、日志、告警入库', '治理基础：权限、审计、通知、告警闭环开始形成'],
    narration: '从效果看，一期最大的价值，是把原来分散的运维能力收拢成平台底座。以前很多信息停留在服务器、脚本、聊天记录或者个人经验里，现在主机、服务、容器、日志、告警开始进入统一数据层。排查问题时，不再完全依赖人工记忆和临时沟通，而是可以从仪表盘看到异常，从告警中心确认事件，再到日志和主机详情里找线索。同时，权限、审计、通知这些治理能力也已经具备基础。也就是说，一期解决的是平台能不能承载后续建设的问题。'
  },
  {
    id: 'phase2-positioning',
    kicker: '二期定位',
    title: '二期重点：从“能看见”走向“能治理、能处置”',
    points: ['监控做深：日志规则、主机组、容器误报治理', '处置做实：批处理、服务操作、自愈计划', '分析增强：拓扑、慢查询、AI 诊断和巡检入口'],
    narration: '接下来讲二期项目说明。二期不是重新做一套系统，而是在一期底座上继续做深。可以把二期定位为：从能看见，走向能治理、能处置。第一类是监控质量增强，例如日志监控规则支持多主机和主机组，告警可以更准确地关联来源主机，Docker 容器重启以后要避免旧容器造成误报。第二类是自动化处置能力，例如批处理、Windows 和 Linux 主机操作、服务状态查看和自愈计划。第三类是分析增强，例如服务拓扑、慢查询分析、AI 诊断和智能巡检入口。二期的重点是让平台不只是展示数据，而是能支撑真实运维流程。'
  },
  {
    id: 'phase2-log-alert',
    kicker: '二期项目 01',
    title: '告警治理与日志监控深化',
    points: ['日志规则支持全部主机、单台、多台、主机组', '规则命中后进入告警中心，保留来源主机和样例', '继续完善去重、降噪、维护期抑制和通知策略'],
    narration: '二期第一项重点，是告警治理与日志监控深化。原来如果一条日志监控规则只能绑定单台主机，那么同一个业务部署在多台机器上，就要重复创建多条规则，维护成本很高。二期可以把日志规则扩展为全部主机、单台主机、多台主机和主机组四种范围，让一条规则覆盖一组业务主机。规则命中后，告警中心要记录真实来源主机、日志样例、关键字和统计窗口，这样值班人员看到告警时，不只是看到一个标题，而是知道是哪台机器、哪个服务、什么日志触发了告警。后续还要继续完善去重、降噪、维护期抑制和通知策略，减少无效告警对值班人员的打扰。'
  },
  {
    id: 'phase2-container-quality',
    kicker: '二期项目 02',
    title: '容器与服务监控质量提升',
    points: ['区分当前容器和历史容器，减少重启误报', '按逻辑身份识别 Compose / Swarm 容器', '服务异常、容器状态、主机资源形成关联线索'],
    narration: '二期第二项重点，是容器和服务监控质量提升。容器场景有一个常见问题：Docker 重启或重建后，新旧容器 ID 会变化，旧容器可能保留为 exited 或 missing，如果平台简单按容器 ID 判断，就容易误报服务异常。优化思路是引入容器生命周期和逻辑身份，例如根据 Compose 或 Swarm 的 labels、容器名称规范来判断它是不是同一个业务实例。新容器正常运行时，旧的同逻辑身份容器应标记为历史，而不是继续影响当前监控视图。这样既能保留历史记录用于追溯，又能降低容器重启带来的误报，让告警更接近真实业务风险。'
  },
  {
    id: 'phase2-automation',
    kicker: '二期项目 03',
    title: '批处理与自动化处置能力',
    points: ['批量上传文件、批量执行脚本，支持 Linux / Windows', '每台目标主机保留 stdout、stderr、退出码和执行状态', '自愈计划先走安全模式，再逐步审批执行'],
    narration: '二期第三项重点，是批处理和自动化处置能力。很多运维工作本质上是重复动作，例如多台主机上传配置文件、多台服务器执行检查脚本、批量采集诊断信息。如果每次都人工登录，效率低，而且过程难留痕。平台的批处理能力可以支持选择任务类型、目标系统、目标主机、目标目录、文件上传或脚本内容，Windows 侧按 PowerShell 执行，Linux 侧按 bash 执行。每台目标主机都要保留独立的 stdout、stderr、退出码和执行结果，失败时能定位是哪台机器、哪个步骤出问题。自愈计划方面建议先保持安全模式，先生成建议和执行记录，再逐步加入审批、冷却、回滚说明，最后对低风险场景开放可控执行。'
  },
  {
    id: 'phase2-topology-slowquery',
    kicker: '二期项目 04',
    title: '拓扑、慢查询与排障链路补齐',
    points: ['服务拓扑帮助判断故障影响面', '慢查询分析补充数据库性能视角', '告警、日志、主机、服务关系逐步串起来'],
    narration: '二期第四项重点，是拓扑、慢查询和排障链路补齐。告警和日志能告诉我们某个点出现异常，但实际排障还需要知道它影响哪些服务、依赖哪些主机、是否和数据库慢查询有关。服务拓扑的价值就是把主机、服务、调用关系和异常状态串起来，帮助判断故障影响面。慢查询分析则补充数据库性能视角，让平台不仅关注机器资源和应用日志，也能看到接口响应慢、SQL 执行慢这类业务体验问题。后续如果能把告警、日志、主机、服务拓扑和慢查询放到同一条排障链路里，运维人员就可以从一个告警出发，逐步看到影响范围、日志线索、资源状态和可能原因。'
  },
  {
    id: 'phase2-ai',
    kicker: '二期项目 05',
    title: '智能辅助：先辅助判断，再进入闭环',
    points: ['AI 助手、告警诊断、智能巡检先形成交互入口', '接入告警、日志、拓扑、主机和慢查询上下文', '形成建议、审批、执行、审计的可控闭环'],
    narration: '二期还需要把智能辅助能力讲清楚。这里不是一开始就让 AI 自动操作生产环境，而是先让 AI 做辅助判断。平台可以先保留 AI 助手、告警诊断、智能巡检和自愈建议这些入口，让用户用自然语言描述问题，平台结合告警、日志、拓扑、主机和慢查询上下文给出排查建议。后续再接入企业内部大模型或安全可控的大模型服务，建设运维知识库和 RAG 检索，让回答基于企业内部操作手册、故障案例和应急预案。最终目标不是让 AI 替代运维人员，而是形成建议、审批、执行、审计的闭环，让运维人员更快做出判断。'
  },
  {
    id: 'roadmap-1',
    kicker: '后续计划 01',
    title: '先把数据质量和平台稳定性继续做扎实',
    points: ['Agent 上报稳定性、异常重试、版本管理', '主机、服务、容器、日志数据质量持续校验', '告警、日志、容器、批处理增加回归测试'],
    narration: '后续计划可以分几步推进。第一步，先把数据质量和平台稳定性继续做扎实。因为运维平台的判断都依赖底层数据，如果 Agent 上报不稳定、心跳不准确、服务状态不及时，后面的告警、拓扑、AI 诊断都会受到影响。所以要持续完善 Agent 上报稳定性、异常重试、版本管理和采集质量校验。主机、服务、容器、日志这些基础数据也要区分当前状态和历史记录，避免误判。与此同时，告警、日志监控、容器生命周期、批处理执行都应该补充回归测试，保证每次优化以后不会破坏已有能力。'
  },
  {
    id: 'roadmap-2',
    kicker: '后续计划 02',
    title: '再建设知识库、RCA 和报告能力',
    points: ['沉淀故障案例、操作手册、应急预案、变更记录', '基于告警、日志、拓扑自动生成 RCA 分析', '生成巡检报告、故障复盘和管理汇报材料'],
    narration: '第二步，是建设知识库、RCA 和报告能力。平台积累了告警、日志、执行记录和审计信息以后，下一步就要把这些数据变成可复用经验。知识库可以沉淀故障案例、操作手册、应急预案和变更记录；RAG 检索可以让 AI 回答时引用企业内部知识，而不是只给通用建议。RCA 根因分析可以基于告警、日志、拓扑、主机指标和变更记录，生成初步原因判断和处理建议。报告能力则面向管理和复盘，例如自动生成巡检报告、日报周报、故障复盘、告警治理指标、重复告警 TOP 和 MTTR 趋势。这一层能力会让平台从工具逐步变成经验沉淀系统。'
  },
  {
    id: 'roadmap-3',
    kicker: '后续计划 03',
    title: '最后推进工作流编排和可控自愈',
    points: ['把巡检、诊断、审批、执行、验证串成流程', '低风险场景逐步开放自动执行', '所有动作保留审计、冷却、回滚和复盘信息'],
    narration: '第三步，是推进工作流编排和可控自愈。运维自动化不能只看执行命令，还要看流程是否安全。比较稳妥的路线是先把巡检、诊断、审批、执行和验证串成标准流程。例如告警触发后，先自动收集主机指标和相关日志，再生成诊断建议，然后由人员审批是否执行脚本，执行后再自动验证服务是否恢复。对于低风险场景，比如清理临时文件、重启非核心测试服务、采集诊断包，可以逐步开放自动执行；对于高风险场景，仍然保留人工审批。所有动作都要有审计记录、冷却时间、回滚说明和复盘材料。这样平台才能在安全边界内逐步提升自动化水平。'
  },
  {
    id: 'value',
    kicker: '整体价值',
    title: '平台演进目标：更高效、更稳定、更可追溯',
    points: ['从分散工具转向统一运维入口', '从被动排查转向主动监控和告警治理', '从人工经验转向规则化、自愈化和知识化'],
    narration: '把一期、二期和后续计划串起来看，ops-platform 的价值可以概括为三个转变。第一个转变，是从分散工具转向统一运维入口，减少系统切换和人工查找。第二个转变，是从被动排查转向主动监控和告警治理，通过日志规则、告警降噪、维护期抑制和通知策略，让问题更早暴露，也减少无效打扰。第三个转变，是从人工经验转向规则化、自愈化和知识化，把故障处理过程、执行结果、复盘结论沉淀到平台里。后续接入真实大模型、知识库、RCA 和工作流编排以后，平台可以逐步演进为企业生产环境里的智能运维中枢。'
  },
  {
    id: 'closing',
    kicker: '汇报总结',
    title: '一期打底，二期做深，后续智能化演进',
    points: ['一期：统一入口、数据接入、权限审计', '二期：告警日志深化、自动化处置、智能辅助', '后续：知识库、RCA、工作流、自愈和管理汇报'],
    narration: '最后总结一下。本次汇报比上一版更完整地说明了 ops-platform 的建设节奏。一期重点是把底座打牢：统一入口、主机和 Agent 接入、告警日志基础、权限审计和数据沉淀。二期重点是在这个底座上做深：告警治理、日志监控多主机规则、容器误报治理、批处理、自愈计划、拓扑排障、慢查询分析和智能辅助入口。后续再继续推进平台稳定性、知识库、RCA、报告生成、工作流编排和可控自愈。整体目标不是堆功能，而是让运维从分散排查走向统一治理，从人工经验走向可追溯、可复用、可逐步自动化的智能运维体系。我的汇报就到这里，谢谢大家。'
  },
]

function htmlForSlide(slide, index) {
  const pointHtml = slide.points.map((p, i) => `<div class="point"><span>${String(i + 1).padStart(2, '0')}</span>${p}</div>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{margin:0;width:1366px;height:768px;overflow:hidden;font-family:'Microsoft YaHei UI','PingFang SC',sans-serif;color:#eef7ff;background:#07111f;}
  .slide{position:relative;width:1366px;height:768px;padding:68px 82px;background:radial-gradient(circle at 12% 12%,rgba(53,217,255,.22),transparent 310px),radial-gradient(circle at 88% 18%,rgba(167,139,250,.18),transparent 300px),linear-gradient(135deg,#050a12,#08172a 48%,#0b2138);}
  .grid{position:absolute;inset:0;opacity:.07;background-image:linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px);background-size:42px 42px;mask-image:linear-gradient(to bottom,#000,transparent 86%)}
  .kicker{position:relative;display:inline-flex;padding:8px 14px;border:1px solid rgba(53,217,255,.35);border-radius:999px;background:rgba(53,217,255,.08);color:#baf3ff;letter-spacing:.14em;font-size:15px;font-weight:800;text-transform:uppercase;}
  h1{position:relative;margin:38px 0 22px;max-width:1080px;font-size:60px;line-height:1.08;letter-spacing:-.055em;color:transparent;background:linear-gradient(110deg,#fff,#bdf4ff 35%,#65d9ff 65%,#b79cff);-webkit-background-clip:text;background-clip:text;}
  .points{position:relative;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;max-width:1100px;margin-top:34px;}
  .point{min-height:82px;padding:20px 22px;border:1px solid rgba(255,255,255,.1);border-radius:22px;background:rgba(255,255,255,.055);box-shadow:0 16px 48px rgba(0,0,0,.18);font-size:23px;line-height:1.35;color:#d8e9f9;}
  .point span{display:block;margin-bottom:6px;color:#35d9ff;font-size:13px;font-weight:900;letter-spacing:.18em;}
  .index{position:absolute;right:70px;bottom:52px;color:rgba(255,255,255,.18);font-size:80px;font-weight:900;letter-spacing:-.08em;}
  .footer{position:absolute;left:82px;bottom:58px;color:#7f96ae;font-size:15px;letter-spacing:.08em;}
  </style></head><body><div class="slide"><div class="grid"></div><div class="kicker">${slide.kicker}</div><h1>${slide.title}</h1><div class="points">${pointHtml}</div><div class="footer">ops-platform staged briefing · detailed edition</div><div class="index">${String(index + 1).padStart(2, '0')}</div></div></body></html>`
}

async function synthesizeEdge(text, outputMp3, voice) {
  const tts = new MsEdgeTTS()
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)
  const result = tts.toStream(text)
  const readable = result.audioStream || result
  await new Promise((resolve, reject) => {
    const write = fs.createWriteStream(outputMp3)
    readable.pipe(write)
    readable.on('error', reject)
    write.on('finish', resolve)
    write.on('error', reject)
  })
}

function ffprobeDuration(file) {
  const out = capture(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file])
  return Number(JSON.parse(out).format.duration)
}

async function renderSlides(outDir) {
  const slideDir = path.join(outDir, 'detailed-slides')
  ensureDir(slideDir)
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 })
  const images = []
  for (let i = 0; i < slides.length; i++) {
    const html = htmlForSlide(slides[i], i)
    const htmlPath = path.join(slideDir, `slide-${String(i + 1).padStart(2, '0')}.html`)
    const pngPath = path.join(slideDir, `slide-${String(i + 1).padStart(2, '0')}.png`)
    fs.writeFileSync(htmlPath, html, 'utf8')
    await page.goto('file:///' + htmlPath.replace(/\\/g, '/'))
    await page.screenshot({ path: pngPath, fullPage: false })
    images.push(pngPath)
  }
  await browser.close()
  return images
}

function writeConcat(images, concatPath, secondsPerSlide) {
  let txt = ''
  for (const img of images) {
    txt += `file '${path.resolve(img).replace(/'/g, `'\\''`)}'\n`
    txt += `duration ${secondsPerSlide.toFixed(3)}\n`
  }
  txt += `file '${path.resolve(images[images.length - 1]).replace(/'/g, `'\\''`)}'\n`
  fs.writeFileSync(concatPath, txt, 'utf8')
}

async function main() {
  const output = path.resolve(argValue('--output', 'report-video-output/运维平台建设阶段汇报-10分钟详细版.mp4'))
  const voice = argValue('--voice', DEFAULT_VOICE)
  const outDir = path.dirname(output)
  ensureDir(outDir)
  const narration = slides.map(s => s.narration).join('\n\n')
  const narrationTxt = path.join(outDir, 'detailed-narration.txt')
  const audioMp3 = path.join(outDir, 'detailed-narration.mp3')
  const concatTxt = path.join(outDir, 'detailed-concat.txt')
  const silentVideo = path.join(outDir, 'detailed-slides-only.mp4')
  fs.writeFileSync(narrationTxt, narration, 'utf8')
  console.log('Narration:', narrationTxt)
  await synthesizeEdge(narration, audioMp3, voice)
  const audioSeconds = ffprobeDuration(audioMp3)
  console.log('Audio seconds:', audioSeconds.toFixed(2))
  const images = await renderSlides(outDir)
  const secondsPerSlide = Math.max(5, audioSeconds / images.length)
  writeConcat(images, concatTxt, secondsPerSlide)
  run(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', concatTxt, '-vf', 'scale=1366:768:force_original_aspect_ratio=decrease,pad=1366:768:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', silentVideo])
  run(FFMPEG, ['-y', '-i', silentVideo, '-i', audioMp3, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', output])
  console.log('DONE:', output)
}

main().catch(err => { console.error(err); process.exit(1) })
