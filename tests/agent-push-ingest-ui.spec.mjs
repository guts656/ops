import { chromium } from '@playwright/test'
import { prisma } from '../server/db/prisma.ts'
import { toAuthUser } from '../server/data/users.ts'
import { hashAgentToken } from '../server/utils/agentToken.ts'
import { signToken } from '../server/utils/jwt.ts'

const appUrl = process.env.APP_URL || 'http://localhost:5173'
const apiUrl = process.env.API_URL || 'http://localhost:3001/api'
const agentToken = `test-agent-${Date.now()}`

async function postAgent(hostId, path, body) {
  const response = await fetch(`${apiUrl}/agent/hosts/${hostId}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${path} failed: ${response.status} ${await response.text()}`)
}

async function main() {
  const storedUser = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' }, include: { customPermissions: true } })
  const user = toAuthUser(storedUser)
  const token = signToken(user)
  const now = Date.now()
  const host = await prisma.host.create({
    data: {
      id: `host-agent-smoke-${now}`,
      ip: `10.255.${now % 200}.${now % 250}`,
      hostname: `agent-smoke-${now}`,
      os: 'Linux',
      osVersion: 'Smoke Linux',
      cpu: 0,
      memory: 0,
      disk: 0,
      status: '在线',
      group: '测试资源池',
      tags: ['smoke'],
      agentVersion: 'smoke',
      agentStatus: '正常',
      agentInstalledAt: new Date().toLocaleString('zh-CN', { hour12: false }),
      lastHeartbeat: new Date().toLocaleString('zh-CN', { hour12: false }),
      sshPort: 22,
      owner: 'smoke',
      changeNo: 'SMOKE',
      agentTokenHash: hashAgentToken(agentToken),
    },
  })
  const serviceName = `agent-smoke-${Date.now()}.service`
  const logMessage = `agent push smoke log ${Date.now()}`
  const eventMessage = `agent push smoke event ${Date.now()}`

  await postAgent(host.id, 'logs', { logs: [{ service: serviceName, level: 'INFO', message: logMessage, source: 'smoke' }] })
  await postAgent(host.id, 'services', { services: [{ name: serviceName, status: 'running', protocol: 'systemd', source: 'smoke' }] })
  await postAgent(host.id, 'service-events', { events: [{ service: serviceName, eventType: 'smoke_event', level: 'INFO', message: eventMessage, source: 'smoke' }] })

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto(appUrl, { waitUntil: 'domcontentloaded' })
  await page.evaluate(({ user, token }) => {
    window.localStorage.setItem('ops-platform.auth.session', JSON.stringify({ user, token }))
  }, { user, token })

  await page.goto(`${appUrl}/logs`, { waitUntil: 'networkidle' })
  await page.getByRole('main').getByRole('heading', { name: '日志查询' }).waitFor()
  await page.getByPlaceholder('输入 Trace ID、错误码或消息关键字').fill(logMessage)
  await page.getByRole('button', { name: /查\s*询\s*日\s*志/ }).click()
  await page.getByText(logMessage).waitFor()

  await page.goto(`${appUrl}/hosts/${host.id}`, { waitUntil: 'networkidle' })
  await page.getByRole('main').getByRole('heading', { name: host.hostname }).waitFor()
  await page.getByText('Agent 上报服务').waitFor()
  await page.getByRole('row', { name: new RegExp(`${serviceName}.*running`) }).waitFor()
  await page.getByText('Agent 服务事件').waitFor()
  await page.getByText(eventMessage).waitFor()

  const unexpectedErrors = errors.filter((error) => !error.includes('[antd: message] Static function can not consume context'))
  if (unexpectedErrors.length) throw new Error(`页面错误：${unexpectedErrors.join('\n')}`)
  await browser.close()
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.$disconnect()
  console.log('agent-push-ingest-ui-ok')
}

main().catch(async (error) => {
  await prisma.host.deleteMany({ where: { id: { startsWith: 'host-agent-smoke-' } } })
  await prisma.$disconnect()
  console.error(error)
  process.exit(1)
})
