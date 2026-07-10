import { chromium } from '@playwright/test'

const baseURL = process.env.OP_TEST_BASE_URL || 'http://localhost:5174'
const credentials = {
  username: process.env.OP_TEST_USERNAME || 'admin',
  password: process.env.OP_TEST_PASSWORD || 'admin123',
}

const routes = [
  ['仪表盘', '/'],
  ['告警中心', '/alerts'],
  ['主机管理', '/hosts'],
  ['日志查询', '/logs'],
  ['日志监控', '/log-monitoring'],
  ['批处理', '/batch-jobs'],
  ['自愈规则', '/self-healing'],
  ['审计日志中心', '/audit-logs'],
  ['账号权限', '/accounts'],
  ['AI 助手', '/ai'],
  ['服务拓扑', '/topology'],
  ['告警自动处理', '/alert-handling'],
  ['慢查询分析', '/slow-query'],
  ['智能巡检', '/inspection'],
  ['设置', '/settings'],
]

const issues = []
const observations = []

function pushIssue(type, where, detail) {
  issues.push({ type, where, detail })
}

async function waitSettled(page) {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(800)
}

async function checkRender(page, where) {
  const renderError = await page.getByText('页面渲染异常').count().catch(() => 0)
  if (renderError) pushIssue('render-error', where, '页面出现“页面渲染异常”错误边界')
  const alerts = await page.locator('.ant-alert-error').allTextContents().catch(() => [])
  for (const text of alerts) pushIssue('error-alert', where, text.replace(/\s+/g, ' ').trim())
}

async function clickIfVisible(page, locator, description) {
  const count = await locator.count().catch(() => 0)
  if (!count) return false
  const first = locator.first()
  if (!(await first.isVisible().catch(() => false))) return false
  await first.click()
  await waitSettled(page)
  observations.push(description)
  return true
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
const page = await context.newPage()

page.on('console', (msg) => {
  const text = msg.text()
  if (['error', 'warning'].includes(msg.type())) pushIssue(`console-${msg.type()}`, page.url(), text)
})
page.on('pageerror', (error) => pushIssue('page-error', page.url(), error.stack || error.message))
page.on('response', (response) => {
  const url = response.url()
  if (url.includes('/api/') && response.status() >= 400) pushIssue('api-error', url, `${response.status()} ${response.statusText()}`)
})

try {
  await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('请输入用户名').fill(credentials.username)
  await page.getByPlaceholder('请输入密码').fill(credentials.password)
  await page.getByRole('button', { name: '进入运维后台' }).click()
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10000 })
  await waitSettled(page)
  observations.push('登录成功')

  for (const [name, path] of routes) {
    await page.goto(`${baseURL}${path}`, { waitUntil: 'domcontentloaded' })
    await waitSettled(page)
    await checkRender(page, name)
    const bodyText = await page.locator('body').innerText().catch(() => '')
    if (!bodyText.includes(name.replace('★ ', '')) && name !== 'AI 助手') {
      observations.push(`${name}: 页面可打开，但未在正文中直接识别到模块标题`)
    } else {
      observations.push(`${name}: 页面打开正常`)
    }
  }

  // 主机管理：进入第一台主机详情，检查 Agent 时间区域。
  await page.goto(`${baseURL}/hosts`, { waitUntil: 'domcontentloaded' })
  await waitSettled(page)
  if (await clickIfVisible(page, page.getByRole('button', { name: '详情' }), '主机管理：点击第一条详情')) {
    await checkRender(page, '主机详情')
    const agentStatusCard = await page.getByText('Agent 状态').count().catch(() => 0)
    if (!agentStatusCard) pushIssue('ui-missing', '主机详情', '未找到 Agent 状态卡片')
  }

  // 批处理：打开日志弹窗、切换页签，验证刚改的执行结果和原日志都还在。
  await page.goto(`${baseURL}/batch-jobs`, { waitUntil: 'domcontentloaded' })
  await waitSettled(page)
  if (await clickIfVisible(page, page.getByRole('button', { name: '日志' }), '批处理：打开第一条日志弹窗')) {
    await checkRender(page, '批处理日志弹窗')
    if (!(await page.getByText('执行结果').first().isVisible().catch(() => false))) pushIssue('ui-missing', '批处理日志弹窗', '未显示“执行结果”页签/区域')
    if (!(await page.getByText('主机明细/日志').first().isVisible().catch(() => false))) pushIssue('ui-missing', '批处理日志弹窗', '原“主机明细/日志”页签缺失')
    await clickIfVisible(page, page.getByText('主机明细/日志'), '批处理：切换到主机明细/日志')
    await checkRender(page, '批处理主机明细/日志页签')
    await page.keyboard.press('Escape')
    await waitSettled(page)
  } else {
    observations.push('批处理：暂无可点击的日志记录')
  }

  // 批处理：打开新建弹窗，切换脚本执行模式，不提交。
  if (await clickIfVisible(page, page.getByRole('button', { name: '新建批处理' }), '批处理：打开新建弹窗')) {
    await clickIfVisible(page, page.getByRole('radio', { name: '批量执行脚本' }), '批处理：切换批量执行脚本')
    await checkRender(page, '批处理新建弹窗')
    if (!(await page.getByLabel('脚本内容').count().catch(() => 0))) pushIssue('ui-missing', '批处理新建弹窗', '切换脚本模式后未找到脚本内容输入框')
    await page.keyboard.press('Escape')
    await waitSettled(page)
  }

  // 日志监控：打开日志规则新建弹窗，不提交。
  await page.goto(`${baseURL}/log-monitoring`, { waitUntil: 'domcontentloaded' })
  await waitSettled(page)
  if (await clickIfVisible(page, page.getByRole('button', { name: '新建监控规则' }), '日志监控：打开新建规则弹窗')) {
    await checkRender(page, '日志监控新建弹窗')
    const selfHealingCard = await page.getByText('异常自愈绑定').count().catch(() => 0)
    if (!selfHealingCard) pushIssue('ui-missing', '日志监控新建弹窗', '未找到异常自愈绑定卡片')
    await page.keyboard.press('Escape')
    await waitSettled(page)
  }

  // CGI/URL 监控：切换页签，打开新建 URL 监控弹窗。
  await page.goto(`${baseURL}/log-monitoring`, { waitUntil: 'domcontentloaded' })
  await waitSettled(page)
  await clickIfVisible(page, page.getByText('CGI/URL 监控'), '日志监控：切换 CGI/URL 监控页签')
  if (await clickIfVisible(page, page.getByRole('button', { name: '新建URL监控' }), 'CGI/URL：打开新建 URL 监控弹窗')) {
    await checkRender(page, 'CGI/URL 新建弹窗')
    const targetHostText = await page.getByText('自愈目标主机').count().catch(() => 0)
    if (!targetHostText) pushIssue('ui-missing', 'CGI/URL 新建弹窗', '异常自愈绑定里未找到“自愈目标主机”配置项（可能需先启用绑定后出现）')
    await page.keyboard.press('Escape')
    await waitSettled(page)
  }

  // 自愈规则页基础交互：打开历史/规则数据后检查无渲染错误。
  await page.goto(`${baseURL}/self-healing`, { waitUntil: 'domcontentloaded' })
  await waitSettled(page)
  await checkRender(page, '自愈规则')

  // 截图留档。
  await page.screenshot({ path: 'tests/manual-full-smoke-final.png', fullPage: true })
} finally {
  await browser.close()
}

console.log(JSON.stringify({ baseURL, observations, issues }, null, 2))
if (issues.some((issue) => ['render-error', 'page-error'].includes(issue.type))) process.exitCode = 1
