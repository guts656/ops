import { chromium } from '@playwright/test'
import { prisma } from '../server/db/prisma.ts'
import { toAuthUser } from '../server/data/users.ts'
import { signToken } from '../server/utils/jwt.ts'

const appUrl = process.env.APP_URL || 'http://localhost:5175'

async function main() {
  const storedUser = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' }, include: { customPermissions: true } })
  const user = toAuthUser(storedUser)
  const token = signToken(user)
  const host = await prisma.host.findFirst({ where: { os: 'Linux' }, orderBy: { createdAt: 'desc' } })
  if (!host) throw new Error('没有可测试 Linux 主机')

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

  await page.goto(`${appUrl}/hosts/${host.id}`, { waitUntil: 'networkidle' })
  await page.getByRole('main').getByRole('heading', { name: host.hostname }).waitFor()
  await page.getByRole('button', { name: /拉\s*取\s*指\s*标/ }).waitFor()
  await page.getByRole('button', { name: /拉\s*取\s*指\s*标/ }).click()
  await page.getByRole('dialog', { name: '拉取主机指标凭据' }).waitFor()

  const unexpectedErrors = errors.filter((error) => !error.includes('[antd: Space] `direction` is deprecated'))
  if (unexpectedErrors.length) throw new Error(`页面错误：${unexpectedErrors.join('\n')}`)
  await browser.close()
  await prisma.$disconnect()
  console.log('host-pull-metrics-ui-ok')
}

main().catch(async (error) => {
  await prisma.$disconnect()
  console.error(error)
  process.exit(1)
})
