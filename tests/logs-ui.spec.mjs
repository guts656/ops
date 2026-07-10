import { chromium } from '@playwright/test'
import { prisma } from '../server/db/prisma.ts'
import { toAuthUser } from '../server/data/users.ts'
import { signToken } from '../server/utils/jwt.ts'

const appUrl = process.env.APP_URL || 'http://localhost:5175'

async function main() {
  const storedUser = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' }, include: { customPermissions: true } })
  const user = toAuthUser(storedUser)
  const token = signToken(user)
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
  await page.getByText('日志结果（10）').waitFor()
  await page.getByText('trc-pay-8f21').waitFor()

  await page.getByLabel('日志级别').click()
  await page.getByTitle('ERROR').click()
  await page.getByRole('button', { name: /查\s*询\s*日\s*志/ }).click()
  await page.getByText('日志结果（2）').waitFor()
  await page.getByText('trc-pay-77d2').waitFor()

  await page.getByPlaceholder('输入 Trace ID、错误码或消息关键字').fill('gateway')
  await page.getByRole('button', { name: /查\s*询\s*日\s*志/ }).click()
  await page.getByText('日志结果（0）').waitFor()

  await page.getByRole('button', { name: /重\s*置/ }).click()
  await page.getByText('日志结果（10）').waitFor()

  if (errors.length) throw new Error(`页面错误：${errors.join('\n')}`)
  await browser.close()
  await prisma.$disconnect()
  console.log('logs-ui-ok')
}

main().catch(async (error) => {
  await prisma.$disconnect()
  console.error(error)
  process.exit(1)
})
