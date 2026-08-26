import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
let retryRequests = 0

await page.addInitScript(() => {
  localStorage.setItem('ops-platform.auth.session', JSON.stringify({
    token: 'test-token',
    user: {
      id: 'test-user',
      username: 'tester',
      displayName: '测试用户',
      role: 'sre',
      title: 'SRE',
      enabled: true,
      tokenVersion: 1,
      permissions: ['batch:view', 'batch:execute'],
    },
  }))
})

const sourceJob = {
  id: 'job-source',
  name: '脚本批处理',
  type: 'run_script',
  status: 'partial',
  operator: '测试用户',
  script: 'Write-Output test',
  startedAt: '2026-08-26 11:00:00',
  completedAt: '2026-08-26 11:01:00',
  summary: '完成 1/2 台主机，失败 1',
  totalTargets: 2,
  successTargets: 1,
  failedTargets: 1,
  targets: [
    {
      id: 'target-success',
      jobId: 'job-source',
      hostId: 'host-success',
      hostIp: '10.0.0.1',
      hostname: 'win-1',
      status: 'success',
      stdout: 'ok',
      stderr: '',
      summary: '成功',
      startedAt: '2026-08-26 11:00:00',
      completedAt: '2026-08-26 11:00:30',
    },
    {
      id: 'target-failed',
      jobId: 'job-source',
      hostId: 'host-failed',
      hostIp: '10.0.0.2',
      hostname: 'win-2',
      status: 'failed',
      exitCode: 125,
      stdout: '',
      stderr: 'unknown',
      summary: 'API 服务重启导致执行中断，远端执行结果未知',
      startedAt: '2026-08-26 11:00:00',
      completedAt: '2026-08-26 11:01:00',
    },
  ],
}

await page.route(/^http:\/\/127\.0\.0\.1:5173\/api\//, async (route) => {
  const request = route.request()
  const pathname = new URL(request.url()).pathname
  if (pathname === '/api/batch-jobs' && request.method() === 'GET') {
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [sourceJob] }) })
  }
  if (pathname === '/api/hosts' && request.method() === 'GET') {
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [] }) })
  }
  if (pathname === '/api/batch-jobs/job-source/rerun-failed' && request.method() === 'POST') {
    retryRequests += 1
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          ...sourceJob,
          id: 'job-retry',
          name: '脚本批处理（失败重跑）',
          status: 'running',
          retryOfJobId: 'job-source',
          totalTargets: 1,
          successTargets: 0,
          failedTargets: 0,
          targets: [{ ...sourceJob.targets[1], id: 'retry-target', jobId: 'job-retry', status: 'running' }],
        },
      }),
    })
  }
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [] }) })
})

try {
  await page.goto('http://127.0.0.1:5173/batch-jobs')
  const rerunButton = page.getByRole('button', { name: /重跑失败主机/ }).first()
  await rerunButton.waitFor()

  await rerunButton.click()
  await page.getByText(/可能已经产生部分副作用/).waitFor()
  await page.getByRole('button', { name: /取\s*消/ }).click()
  assert.equal(retryRequests, 0, 'cancel should not submit a retry')

  await rerunButton.click()
  await page.getByRole('button', { name: '确认重跑' }).click()
  await page.getByText('已提交 1 台失败主机重跑').waitFor()
  assert.equal(retryRequests, 1, 'confirmation should submit exactly one retry')
  console.log('batch-job-recovery-ui-ok')
} finally {
  await browser.close()
}
