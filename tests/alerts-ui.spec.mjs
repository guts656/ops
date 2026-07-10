import { chromium } from '@playwright/test'
import { prisma } from '../server/db/prisma.ts'
import { toAuthUser } from '../server/data/users.ts'
import { signToken } from '../server/utils/jwt.ts'

const appUrl = process.env.APP_URL || 'http://localhost:5175'
const apiUrl = process.env.API_URL || 'http://localhost:3001/api'

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
  }, {
    user,
    token,
  })

  await page.goto(`${appUrl}/alerts`, { waitUntil: 'networkidle' })
  await page.getByRole('main').getByRole('heading', { name: '告警中心' }).waitFor()
  await page.getByRole('main').getByText('告警列表').waitFor()

  const alertIds = await page.locator('.alert-list-item').evaluateAll((items) => items.map((item) => item.textContent || ''))
  if (!alertIds.length) throw new Error('告警列表为空')

  const target = await prisma.alert.findFirst({ orderBy: { createdAt: 'desc' } })
  if (!target) throw new Error('后端未返回可测试告警')
  await prisma.alert.update({ where: { id: target.id }, data: { status: '待处理', diagnosis: null, acknowledgedAt: null, resolvedAt: null } })
  await page.reload({ waitUntil: 'networkidle' })

  const row = page.locator('.alert-list-item').filter({ hasText: target.id }).first()
  const effectiveRow = await row.count() ? row : page.locator('.alert-list-item').filter({ hasText: target.service }).first()
  await effectiveRow.getByRole('button', { name: 'AI 诊断' }).click()
  await page.getByRole('dialog', { name: 'AI 诊断结果' }).waitFor()
  await page.getByText('AI 诊断结果：').waitFor()
  await page.keyboard.press('Escape')

  await effectiveRow.getByRole('button', { name: /确\s*认/ }).click()
  await page.waitForTimeout(500)
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.alert-list-item').filter({ hasText: target.service }).first().getByText('处理中').waitFor()

  const rowAfterAck = page.locator('.alert-list-item').filter({ hasText: target.service }).first()
  await rowAfterAck.getByRole('button', { name: /解\s*决/ }).click()
  await page.waitForTimeout(500)
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.alert-list-item').filter({ hasText: target.service }).first().getByText('已解决').waitFor()

  const persisted = await fetch(`${apiUrl}/alerts`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.json()).then((body) => body.data.find((alert) => alert.id === target.id))
  if (persisted.status !== '已解决' || !persisted.diagnosis || !persisted.acknowledgedAt || !persisted.resolvedAt) {
    throw new Error(`持久化校验失败：${JSON.stringify(persisted)}`)
  }
  if (errors.length) throw new Error(`页面错误：${errors.join('\n')}`)

  await browser.close()
  await prisma.$disconnect()
  console.log(`alerts-ui-ok ${target.id} ${persisted.status}`)
}

main().catch(async (error) => {
  await prisma.$disconnect()
  console.error(error)
  process.exit(1)
})
