import net from 'node:net'
import type { IpushMonitorStage, IpushProbeResult } from '../types/ipushMonitor'

export interface IpushProbeConfig {
  targetHost: string
  port: number
  systemCode: string
  serviceCode: string
  username: string
  password: string
  expectedGreeting: string
  expectedLoginResult: string
  connectTimeoutMs: number
  responseTimeoutMs: number
}

function compactResponse(value: string) {
  return value
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r/g, '')
    .slice(0, 2000)
}

function redactProbeText(value: string, config: Pick<IpushProbeConfig, 'systemCode' | 'serviceCode' | 'username' | 'password'>) {
  let redacted = compactResponse(value)
  redacted = redacted.replace(/xlogin[^\n]*/gi, 'xlogin ******')

  const secrets = Array.from(new Set([config.username, config.password].filter(Boolean)))
    .sort((left, right) => right.length - left.length)
  for (const secret of secrets) redacted = redacted.split(secret).join('******')
  return redacted
}

export function buildIpushLoginCommand(config: Pick<IpushProbeConfig, 'systemCode' | 'serviceCode' | 'username' | 'password'>) {
  return `xlogin ${config.systemCode} ${config.serviceCode} ${config.username} ${config.password}\r\n`
}

export function probeIpush(config: IpushProbeConfig): Promise<IpushProbeResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    const socket = net.createConnection({ host: config.targetHost, port: config.port })
    socket.setNoDelay(true)

    let stage: IpushMonitorStage = 'connect'
    let stageResponse = ''
    let responseSnippet = ''
    let settled = false
    let timer: NodeJS.Timeout | undefined

    const finish = (ok: boolean, errorMessage?: string) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      socket.destroy()
      resolve({
        ok,
        reachable: stage !== 'connect',
        stage: ok ? 'healthy' : stage,
        latencyMs: Date.now() - startedAt,
        responseSnippet: redactProbeText(responseSnippet, config),
        errorMessage: errorMessage ? redactProbeText(errorMessage, config) : undefined,
      })
    }

    const armTimeout = (timeoutMs: number) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const message = stage === 'connect'
          ? `TCP 连接超时（${timeoutMs}ms）`
          : stage === 'greeting'
            ? `已连接，但未在 ${timeoutMs}ms 内收到 ${config.expectedGreeting}`
            : `已发送 xlogin，但未在 ${timeoutMs}ms 内收到 ${config.expectedLoginResult}`
        finish(false, message)
      }, timeoutMs)
    }

    armTimeout(config.connectTimeoutMs)

    socket.once('connect', () => {
      stage = 'greeting'
      armTimeout(config.responseTimeoutMs)
    })

    socket.on('data', (chunk) => {
      const text = chunk.toString('utf8')
      responseSnippet = compactResponse(responseSnippet + text)
      stageResponse = compactResponse(stageResponse + text)

      if (stage === 'greeting' && stageResponse.includes(config.expectedGreeting)) {
        stage = 'login'
        stageResponse = ''
        socket.write(buildIpushLoginCommand(config), 'utf8')
        armTimeout(config.responseTimeoutMs)
        return
      }

      if (stage === 'login') {
        if (stageResponse.includes(config.expectedLoginResult)) {
          finish(true)
          return
        }
        if (stageResponse.includes('xaucode')) finish(false, `登录返回异常：${compactResponse(stageResponse).slice(0, 300)}`)
      }
    })

    socket.once('error', (error) => {
      finish(false, stage === 'connect' ? `TCP 连接失败：${error.message}` : `iPush 会话异常：${error.message}`)
    })

    socket.once('close', () => {
      if (settled) return
      const message = stage === 'connect'
        ? 'TCP 连接在建立前关闭'
        : stage === 'greeting'
          ? `连接已关闭，未收到 ${config.expectedGreeting}`
          : `登录连接已关闭，未收到 ${config.expectedLoginResult}`
      finish(false, message)
    })
  })
}
